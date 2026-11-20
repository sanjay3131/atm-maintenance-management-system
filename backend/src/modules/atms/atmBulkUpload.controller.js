import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import { previewAtmBulkUpload } from "./atmBulkUpload.service.js";
import { importAtmBulkUpload } from "./atmBulkUploadImport.service.js";

const safeClientErrorStatuses = new Set([400, 401, 403, 413]);
const safeImportErrorStatuses = new Set([400, 401, 403, 409, 413, 503]);
const MAX_IDEMPOTENCY_KEY_BYTES = 256;
const uploadLimitErrors = {
  LIMIT_FILE_SIZE: {
    statusCode: 413,
    message: "The uploaded file exceeds the 5 MiB limit.",
  },
  LIMIT_FILE_COUNT: {
    statusCode: 413,
    message: "Upload exactly one XLSX file.",
  },
  LIMIT_FIELD_COUNT: {
    statusCode: 413,
    message: "The upload may not contain extra form fields.",
  },
  LIMIT_PART_COUNT: {
    statusCode: 413,
    message: "The upload may contain only one file part.",
  },
  LIMIT_UNEXPECTED_FILE: {
    statusCode: 400,
    message: "Upload the workbook in the 'file' field.",
  },
};

export const previewATMUpload = asyncHandler(async (req, res) => {
  if (!Buffer.isBuffer(req.file?.buffer)) {
    throw new ApiError(400, "An XLSX file is required in the 'file' field.");
  }

  const data = await previewAtmBulkUpload(req.file.buffer);
  return res
    .status(200)
    .json(new ApiResponse(200, data, "ATM upload preview generated"));
});

export const importATMUpload = asyncHandler(async (req, res) => {
  const idempotencyKey = req.get("Idempotency-Key");
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim().length === 0 ||
    Buffer.byteLength(idempotencyKey, "utf8") > MAX_IDEMPOTENCY_KEY_BYTES
  ) {
    throw new ApiError(
      400,
      "A nonempty Idempotency-Key header of at most 256 bytes is required.",
    );
  }
  if (!Buffer.isBuffer(req.file?.buffer)) {
    throw new ApiError(400, "An XLSX file is required in the 'file' field.");
  }

  const data = await importAtmBulkUpload({
    buffer: req.file.buffer,
    actorId: req.user._id,
    idempotencyKey,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, data, "ATM upload imported"));
});

export const handleATMUploadPreviewError = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const uploadLimitError = uploadLimitErrors[error?.code];
  if (uploadLimitError) {
    return res
      .status(uploadLimitError.statusCode)
      .json({
        success: false,
        message: uploadLimitError.message,
        errors: [],
      });
  }

  if (
    error instanceof ApiError &&
    safeClientErrorStatuses.has(error.statusCode)
  ) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      errors: [],
    });
  }

  console.error("ATM bulk-upload preview failed:", error);
  return res.status(500).json({
    success: false,
    message: "Unable to process ATM upload preview.",
    errors: [],
  });
};

export const handleATMUploadImportError = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const uploadLimitError = uploadLimitErrors[error?.code];
  if (uploadLimitError) {
    return res.status(uploadLimitError.statusCode).json({
      success: false,
      message: uploadLimitError.message,
      errors: [],
    });
  }

  if (
    error instanceof ApiError &&
    safeImportErrorStatuses.has(error.statusCode)
  ) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      errors: error.errors ?? [],
    });
  }

  console.error("ATM bulk-upload import failed:", error);
  return res.status(500).json({
    success: false,
    message: "Unable to import ATM upload.",
    errors: [],
  });
};
