import ApiError from "../../utils/ApiError.js";

export const vehicleError = (statusCode, code, message, errors = []) => {
  const error = new ApiError(statusCode, message, errors);
  error.code = code;
  return error;
};

const DEFAULT_CODES = {
  400: "VALIDATION_ERROR",
  401: "AUTHENTICATION_REQUIRED",
  403: "PERMISSION_DENIED",
  404: "RESOURCE_NOT_FOUND",
  409: "STATE_CONFLICT",
};

export const vehicleErrorMiddleware = (error, req, res, next) => {
  const status =
    Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 600
      ? Number(error.statusCode)
      : 500;
  const code = error?.code || DEFAULT_CODES[status] || "INTERNAL_SERVER_ERROR";
  const message =
    status >= 500 ? "An unexpected error occurred" : error.message;

  if (status >= 500) {
    console.error("[Vehicle API] Request failed:", error);
  }

  return res.status(status).json({
    success: false,
    code,
    message,
    ...(error?.errors?.length ? { errors: error.errors } : {}),
  });
};
