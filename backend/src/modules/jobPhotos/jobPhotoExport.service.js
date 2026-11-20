import AdmZip from "adm-zip";
import PDFDocument from "pdfkit";
import ApiError from "../../utils/ApiError.js";
import JobPhoto from "./jobPhotos.model.js";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_FETCH_TIMEOUT_MS = 15_000;

const getJobExportBaseName = (job) =>
  String(job.jobId || job._id)
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 100) || String(job._id);

const getImageFormat = (buffer) => {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpg";
  }
  if (
    buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  ) {
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

const getCloudinaryPhotoURL = (rawURL, convertToJpeg) => {
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
  if (Number.isFinite(contentLength) && contentLength > MAX_PHOTO_BYTES) {
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

const fetchJobPhoto = async (photo, index, total, convertToJpeg = false) => {
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

const getJobPhotos = async (job) => {
  const beforeIds = job.beforePhotos || [];
  const afterIds = job.afterPhotos || [];
  const photoIds = [...beforeIds, ...afterIds];
  if (photoIds.length === 0) return { before: [], after: [] };

  const photos = await JobPhoto.find({
    _id: { $in: photoIds },
    jobId: job._id,
    isExpired: false,
    photoType: { $in: ["before", "after"] },
  }).select("_id photoType url");
  const photosById = new Map(
    photos.map((photo) => [String(photo._id), photo]),
  );
  const orderActivePhotos = (ids, photoType) =>
    ids
      .map((id) => photosById.get(String(id)))
      .filter((photo) => photo?.photoType === photoType);

  return {
    before: orderActivePhotos(beforeIds, "before"),
    after: orderActivePhotos(afterIds, "after"),
  };
};

export const generateJobPhotoZip = async (job) => {
  const photos = await getJobPhotos(job);
  const zip = new AdmZip();

  for (const [photoType, label] of [
    ["before", "Before"],
    ["after", "After"],
  ]) {
    const typedPhotos = photos[photoType];
    for (let index = 0; index < typedPhotos.length; index += 1) {
      const { buffer, format } = await fetchJobPhoto(
        typedPhotos[index],
        index,
        typedPhotos.length,
      );
      zip.addFile(`${label}_${index + 1}.${format}`, buffer);
    }
  }

  return {
    buffer: zip.toBuffer(),
    filename: `${getJobExportBaseName(job)}.zip`,
  };
};

export const generateJobPhotoPdf = async (job) => {
  const photos = await getJobPhotos(job);
  const photoCount = Math.max(photos.before.length, photos.after.length);
  const beforeBuffers = await Promise.all(
    photos.before.map((photo, index) =>
      fetchJobPhoto(photo, index, photos.before.length, true),
    ),
  );
  const afterBuffers = await Promise.all(
    photos.after.map((photo, index) =>
      fetchJobPhoto(photo, index, photos.after.length, true),
    ),
  );
  const jobDisplayId = String(job.jobId || job._id);
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: 36, bottom: 36, left: 36, right: 36 },
  });
  const buffers = [];
  doc.on("data", (chunk) => buffers.push(chunk));

  const pdfBuffer = new Promise((resolve, reject) => {
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    try {
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const margin = 36;
      const gutter = 24;
      const columnWidth = (pageWidth - margin * 2 - gutter) / 2;
      const imageTop = 100;
      const imageHeight = pageHeight - imageTop - margin;
      const beforeX = margin;
      const afterX = margin + columnWidth + gutter;

      if (photoCount === 0) {
        doc.fontSize(18).text(`Job ID: ${jobDisplayId}`, margin, 48, {
          width: pageWidth - margin * 2,
          align: "center",
        });
        doc.fontSize(12).text("No photos available.", margin, 100, {
          width: pageWidth - margin * 2,
          align: "center",
        });
      } else {
        for (let index = 0; index < photoCount; index += 1) {
          if (index > 0) doc.addPage();

          doc.fontSize(18).text(`Job ID: ${jobDisplayId}`, margin, 38, {
            width: pageWidth - margin * 2,
            align: "center",
          });
          doc.fontSize(12).text(`Before Photo ${index + 1}`, beforeX, 76, {
            width: columnWidth,
            align: "center",
          });
          doc.fontSize(12).text(`After Photo ${index + 1}`, afterX, 76, {
            width: columnWidth,
            align: "center",
          });

          if (beforeBuffers[index]) {
            doc.image(beforeBuffers[index].buffer, beforeX, imageTop, {
              fit: [columnWidth, imageHeight],
              align: "center",
              valign: "center",
            });
          }
          if (afterBuffers[index]) {
            doc.image(afterBuffers[index].buffer, afterX, imageTop, {
              fit: [columnWidth, imageHeight],
              align: "center",
              valign: "center",
            });
          }
        }
      }

      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });

  return {
    buffer: await pdfBuffer,
    filename: `${getJobExportBaseName(job)}.pdf`,
  };
};
