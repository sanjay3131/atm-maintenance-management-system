import path from "node:path";
import multer from "multer";
import ApiError from "../../utils/ApiError.js";

export const MAX_ATM_BULK_UPLOAD_BYTES = 5 * 1024 * 1024;

const xlsxSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATM_BULK_UPLOAD_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
  },
  fileFilter(req, file, callback) {
    if (path.extname(file.originalname).toLowerCase() !== ".xlsx") {
      callback(new ApiError(400, "Only .xlsx files are supported."));
      return;
    }

    callback(null, true);
  },
});

const uploadFile = upload.single("file");

const uploadLimitMessages = {
  LIMIT_FILE_SIZE: "The uploaded file exceeds the 5 MiB limit.",
  LIMIT_FILE_COUNT: "Upload exactly one XLSX file.",
  LIMIT_FIELD_COUNT: "The upload may not contain extra form fields.",
  LIMIT_PART_COUNT: "The upload may contain only one file part.",
};

export const atmBulkUploadMiddleware = (req, res, next) => {
  uploadFile(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const message =
        uploadLimitMessages[error.code] ??
        (error.code === "LIMIT_UNEXPECTED_FILE"
          ? "Upload the workbook in the 'file' field."
          : "The XLSX upload could not be processed.");
      next(
        new ApiError(
          Object.hasOwn(uploadLimitMessages, error.code) ? 413 : 400,
          message,
        ),
      );
      return;
    }

    if (error) {
      next(error);
      return;
    }

    if (!req.file || !Buffer.isBuffer(req.file.buffer) || !req.file.buffer.length) {
      next(new ApiError(400, "An XLSX file is required in the 'file' field."));
      return;
    }

    if (
      req.file.buffer.length < xlsxSignature.length ||
      !req.file.buffer.subarray(0, xlsxSignature.length).equals(xlsxSignature)
    ) {
      next(new ApiError(400, "The uploaded file is not an XLSX archive."));
      return;
    }

    next();
  });
};

export default atmBulkUploadMiddleware;
