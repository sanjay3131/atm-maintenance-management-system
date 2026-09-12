import PDFDocument from "pdfkit";
import AdmZip from "adm-zip";
import AMC from "../amc/amc.model.js";
import AMCPhoto from "../amcPhotos/amcPhoto.model.js";
import ApiError from "../../utils/ApiError.js";

/**
 * Generate AMC Audit PDF
 */
export const generateAMCPDF = async (amcId) => {
  const amc = await AMC.findById(amcId)
    .populate(
      "atmId",
      "atmId locationName bankId address location locationConfigured",
    )
    .populate("employeeId", "firstName lastName email phoneNumber")
    .populate("bankId", "bankName")
    .populate("districtId", "districtName");

  if (!amc) throw new ApiError(404, "AMC not found");

  const doc = new PDFDocument({ margin: 50 });
  const buffers = [];

  doc.on("data", (chunk) => buffers.push(chunk));

  // Header
  doc.fontSize(20).text("AMC Audit Report", 50, 50);
  doc.moveDown();

  // Meta
  doc.fontSize(12);
  doc.text(`AMC ID: ${amc.amcId}`);
  doc.text(
    `ATM: ${amc.atmId?.atmId || "N/A"} — ${amc.atmId?.locationName || ""}`,
  );
  doc.text(`Bank: ${amc.bankId?.bankName || "N/A"}`);
  doc.text(`District: ${amc.districtId?.districtName || "N/A"}`);
  doc.text(
    `Employee: ${amc.employeeId?.firstName || ""} ${amc.employeeId?.lastName || ""}`,
  );
  doc.text(`Month: ${amc.month}/${amc.year}`);
  doc.text(
    `Visit Date: ${amc.visitDate ? new Date(amc.visitDate).toLocaleDateString("en-IN") : "N/A"}`,
  );
  doc.text(
    `Completed: ${amc.completedAt ? new Date(amc.completedAt).toLocaleDateString("en-IN") : "N/A"}`,
  );
  doc.text(
    `GPS Distance: ${amc.gpsDistance !== null ? `${amc.gpsDistance}m` : "N/A"}`,
  );
  doc.text(`Status: ${amc.status}`);
  doc.moveDown();

  // Checklist
  doc.fontSize(14).text("Checklist", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11);

  for (const item of amc.checklist || []) {
    const status =
      item.response === "Good" ||
      item.response === "Working" ||
      item.response === "Done"
        ? "✓"
        : "✗";
    doc.text(`${status} ${item.item}: ${item.response}`);
    if (item.remarks) {
      doc.text(`   Remarks: ${item.remarks}`, { indent: 20 });
    }
  }

  doc.moveDown();

  // Photos
  doc.fontSize(14).text("Photographs", { underline: true });
  doc.moveDown(0.5);

  const photos = await AMCPhoto.find({ amcId, isExpired: false }).sort({
    uploadedAt: 1,
  });
  doc.text(`Total Photos: ${photos.length}`);

  // Note: Embedding photos in PDF requires downloading images. For simplicity, we list URLs.
  // In production, fetch images and embed with doc.image().
  photos.forEach((photo, i) => {
    doc.text(
      `${i + 1}. ${photo.originalName || `Photo ${i + 1}`} — ${photo.url}`,
    );
  });

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(buffers);
      resolve({ buffer: pdfBuffer, filename: `${amc.amcId}_report.pdf` });
    });
  });
};

/**
 * Generate ZIP of AMC photos
 */
export const generateAMCPhotoZip = async (amcId) => {
  const amc = await AMC.findById(amcId).populate("atmId", "atmId");
  if (!amc) throw new ApiError(404, "AMC not found");

  const photos = await AMCPhoto.find({ amcId, isExpired: false }).sort({
    uploadedAt: 1,
  });
  if (photos.length === 0) throw new ApiError(404, "No photos found");

  const zip = new AdmZip();
  const folderName = `${amc.atmId?.atmId || "ATM"}_${amc.year}-${String(amc.month).padStart(2, "0")}_AMC`;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    try {
      const response = await fetch(photo.url);
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = photo.mimeType?.split("/")[1] || "jpg";
      zip.addFile(
        `${folderName}/${amc.atmId?.atmId}_${amc.year}-${String(amc.month).padStart(2, "0")}_${String(i + 1).padStart(2, "0")}.${ext}`,
        buffer,
      );
    } catch (err) {
      console.error(`Failed to fetch photo ${photo._id}:`, err.message);
    }
  }

  const zipBuffer = zip.toBuffer();
  return { buffer: zipBuffer, filename: `${folderName}.zip` };
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
