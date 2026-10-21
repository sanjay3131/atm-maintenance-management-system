import PDFDocument from "pdfkit";
import AdmZip from "adm-zip";
import AMC from "../amc/amc.model.js";
import AMCPhoto from "../amcPhotos/amcPhoto.model.js";
import ApiError from "../../utils/ApiError.js";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_FETCH_TIMEOUT_MS = 15_000;

const safeFilenamePart = (value, fallback) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80) || fallback;

const getAMCVisitDate = (amc) => {
  for (const value of [amc.visitDate, amc.completedAt]) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const year = Number(amc.year);
  const month = Number(amc.month);
  if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
    return new Date(Date.UTC(year, month - 1, 1));
  }

  throw new ApiError(422, "AMC visit date and period are unavailable");
};

const getAMCVisitDateString = (amc) => {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(getAMCVisitDate(amc));
  const part = (type) => parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const getImageFormat = (buffer) => {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpg";
  }
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
};

const getCloudinaryPhotoURL = (rawURL, convertToJpeg = false) => {
  let url;
  try {
    url = new URL(rawURL);
  } catch {
    throw new ApiError(502, "Photo evidence has an invalid storage address");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "res.cloudinary.com" ||
    url.port ||
    url.username ||
    url.password ||
    !url.pathname.includes("/image/upload/")
  ) {
    throw new ApiError(502, "Photo evidence uses an unsupported storage address");
  }

  if (convertToJpeg) {
    url.pathname = url.pathname.replace(
      "/image/upload/",
      "/image/upload/f_jpg/",
    );
  }
  return url;
};

const readPhotoResponse = async (response) => {
  const contentLength = Number(response.headers.get("content-length"));
  if (contentLength > MAX_PHOTO_BYTES) {
    throw new Error("Photo exceeds the download size limit");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Photo storage returned an empty response");

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PHOTO_BYTES) {
        await reader.cancel();
        throw new Error("Photo exceeds the download size limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
};

const fetchAMCPhoto = async (photo, index, total, convertToJpeg = false) => {
  try {
    const url = getCloudinaryPhotoURL(photo.url, convertToJpeg);
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(PHOTO_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("Photo storage returned an error");

    const buffer = await readPhotoResponse(response);
    const format = getImageFormat(buffer);
    if (!format || buffer.length > MAX_PHOTO_BYTES) {
      throw new Error("Photo is corrupt or has an unsupported format");
    }
    if (convertToJpeg && format === "webp") {
      throw new Error("Photo conversion was not supported by storage");
    }

    return { buffer, format };
  } catch {
    throw new ApiError(
      502,
      `Photo evidence ${index + 1} of ${total} could not be retrieved or decoded. The download was not generated.`,
    );
  }
};

/**
 * Generate AMC Audit PDF
 */
export const generateAMCPDF = async (
  amcId,
  { customerSafe = false, supervisorSafe = false, embedPhotos = false } = {},
) => {
  let amcQuery = AMC.findById(amcId);
  if (supervisorSafe) {
    amcQuery = amcQuery
      .select(
        "amcId atmId bankId districtId employeeId month year visitDate completedAt status checklist",
      )
      .populate("atmId", "atmId locationName")
      .populate("employeeId", "firstName lastName");
  } else {
    amcQuery = amcQuery.populate(
      "atmId",
      "atmId locationName bankId address location locationConfigured",
    );
  }
  if (!customerSafe && !supervisorSafe) {
    amcQuery = amcQuery.populate(
      "employeeId",
      "firstName lastName email phoneNumber",
    );
    if (embedPhotos) {
      amcQuery = amcQuery.populate("customerId", "customerName");
    }
  }
  const amc = await amcQuery
    .populate("bankId", "bankName")
    .populate("districtId", "districtName");

  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  const doc = new PDFDocument({ margin: 50 });
  const buffers = [];
  doc.on("data", (chunk) => buffers.push(chunk));
  const photosQuery = AMCPhoto.find({ amcId, isExpired: false });
  if (supervisorSafe) photosQuery.select("_id");
  else if (embedPhotos) photosQuery.select("_id url mimeType uploadedAt");
  const photos = await photosQuery.sort({ uploadedAt: 1 });
  const photoBuffers = embedPhotos
    ? await Promise.all(
        photos.map((photo, index) =>
          fetchAMCPhoto(photo, index, photos.length, true),
        ),
      )
    : [];

  doc.fontSize(20).text("AMC Audit Report");
  doc.moveDown(0.6);
  doc.fontSize(12);
  const atm = amc.atmId && typeof amc.atmId === "object" ? amc.atmId : {};
  const employee =
    amc.employeeId && typeof amc.employeeId === "object"
      ? amc.employeeId
      : {};
  const customer =
    amc.customerId && typeof amc.customerId === "object"
      ? amc.customerId
      : {};
  const displayDateTime = (value) =>
    value
      ? new Intl.DateTimeFormat("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Kolkata",
        }).format(new Date(value))
      : "Not recorded";

  doc.text(`AMC ID: ${amc.amcId || "N/A"}`);
  doc.text(`ATM: ${atm.atmId || "N/A"}`);
  doc.text(`Location: ${atm.locationName || "N/A"}`);
  doc.text(`Address: ${atm.address || "N/A"}`);
  doc.text(`Bank: ${amc.bankId?.bankName || "N/A"}`);
  doc.text(`Customer: ${customer.customerName || "N/A"}`);
  doc.text(`District: ${amc.districtId?.districtName || "N/A"}`);
  if (!customerSafe) {
    doc.text(
      `Employee: ${[employee.firstName, employee.lastName].filter(Boolean).join(" ") || "N/A"}`,
    );
  }
  doc.text(`Month: ${amc.month}/${amc.year}`);
  doc.text(`Deadline: ${displayDateTime(amc.deadlineDate)}`);
  doc.text(`Visit started: ${displayDateTime(amc.visitDate)}`);
  doc.text(`Completed: ${displayDateTime(amc.completedAt)}`);
  if (!customerSafe && !supervisorSafe) {
    doc.text(`Visit GPS validation: ${amc.gpsValidated ? "Passed" : "Not validated"}`);
    if (amc.gpsDistance !== null && amc.gpsDistance !== undefined) {
      doc.text(`GPS distance from ATM: ${amc.gpsDistance}m`);
    }
  }
  doc.text(`Checklist completion: ${amc.checklistCompleted ? "Complete" : "Incomplete"}`);
  doc.text(`Status: ${amc.status || "N/A"}`);
  doc.moveDown();

  doc.fontSize(14).text("Checklist", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11);

  if (!amc.checklist?.length) {
    doc.text("No checklist responses recorded.");
  }
  for (const item of amc.checklist || []) {
    const status =
      item.response === "Good" ||
      item.response === "Working" ||
      item.response === "Done"
        ? "✓"
        : "✗";
    doc.text(
      item.response
        ? `${status} ${item.item || "Checklist item"}: ${item.response}`
        : `${item.item || "Checklist item"}: No response`,
    );
    if (item.remarks) {
      doc.text(`   Remarks: ${item.remarks}`, { indent: 20 });
    }
  }
  doc.moveDown(0.6);
  if (amc.employeeRemarks) {
    doc.fontSize(14).text("Employee remarks", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).text(amc.employeeRemarks);
    doc.moveDown(0.6);
  }
  doc.fontSize(14).text("Photographs", { underline: true });
  doc.moveDown(0.5);
  doc.text(`Total Photos: ${photos.length}`);

  if (supervisorSafe || customerSafe) {
    if (photos.length > 0) {
      doc.text(
        supervisorSafe
          ? "Photo evidence is available in the Supervisor Portal."
          : "Photo evidence is available.",
      );
    }
  } else if (embedPhotos) {
    if (photos.length === 0) {
      doc.text("No photo evidence is available for this AMC.");
    }
    const pageBottom = () =>
      doc.page.height - doc.page.margins.bottom;
    for (let index = 0; index < photoBuffers.length; index++) {
      doc.addPage();
      doc.fontSize(12).text(`Photograph ${index + 1} of ${photoBuffers.length}`);
      const imageY = doc.y + 12;
      const imageHeight = pageBottom() - imageY;
      try {
        doc.image(photoBuffers[index].buffer, doc.page.margins.left, imageY, {
          fit: [doc.page.width - doc.page.margins.left - doc.page.margins.right, imageHeight],
          align: "center",
          valign: "center",
        });
      } catch {
        throw new ApiError(
          422,
          `Photo evidence ${index + 1} of ${photos.length} could not be embedded. The report was not generated.`,
        );
      }
    }
  } else {
    doc.text(
      photos.length
        ? "Photo evidence is available in the AMC details view."
        : "No photo evidence is available for this AMC.",
    );
  }

  return new Promise((resolve, reject) => {
    doc.on("error", reject);
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(buffers);
      const filename = embedPhotos
        ? `${safeFilenamePart(atm.atmId, "ATM")}_${getAMCVisitDateString(amc)}_AMC_Report.pdf`
        : `${amc.amcId}_report.pdf`;
      resolve({
        buffer: pdfBuffer,
        filename,
      });
    });
    doc.end();
  });
};

/**
 * Generate ZIP of AMC photos
 */
export const generateAMCPhotoZip = async (amcId) => {
  const amc = await AMC.findById(amcId).populate("atmId", "atmId");
  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  const photos = await AMCPhoto.find({ amcId, isExpired: false }).sort({
    uploadedAt: 1,
  });
  if (photos.length === 0) throw new ApiError(404, "No photos found");

  const zip = new AdmZip();
  const atmName = safeFilenamePart(amc.atmId?.atmId, "ATM");
  const visitDate = getAMCVisitDateString(amc);

  for (let i = 0; i < photos.length; i++) {
    const { buffer, format } = await fetchAMCPhoto(
      photos[i],
      i,
      photos.length,
    );
    zip.addFile(
      `${atmName}_${visitDate}_Photo_${String(i + 1).padStart(2, "0")}.${format}`,
      buffer,
    );
  }

  const zipBuffer = zip.toBuffer();
  return {
    buffer: zipBuffer,
    filename: `${atmName}_${visitDate}_AMC_Photos.zip`,
  };
};

/**
 * Bulk ZIP for month
 */
export const generateBulkAMCZip = async (month, year, filters = {}) => {
  const amcs = await AMC.find({
    month,
    year,
    status: "COMPLETED",
    isDeleted: false,
    ...filters,
  }).populate("atmId", "atmId locationName");

  if (amcs.length === 0) throw new ApiError(404, "No completed AMCs found");

  const zip = new AdmZip();
  const monthFolder = `${year}-${String(month).padStart(2, "0")}_AMC`;

  for (const amc of amcs) {
    const photos = await AMCPhoto.find({
      amcId: amc._id,
      isExpired: false,
    }).sort({ uploadedAt: 1 });
    const atmFolder = `${monthFolder}/${amc.atmId?.atmId || amc._id}`;

    for (let i = 0; i < photos.length; i++) {
      try {
        const response = await fetch(photos[i].url);
        if (!response.ok) continue;
        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = photos[i].mimeType?.split("/")[1] || "jpg";
        zip.addFile(
          `${atmFolder}/${amc.atmId?.atmId}_${year}-${String(month).padStart(2, "0")}_${String(i + 1).padStart(2, "0")}.${ext}`,
          buffer,
        );
      } catch (err) {
        console.error(`Failed to fetch photo for AMC ${amc._id}:`, err.message);
      }
    }
  }

  return { buffer: zip.toBuffer(), filename: `${monthFolder}.zip` };
};
