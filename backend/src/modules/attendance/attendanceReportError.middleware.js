const EXPORT_TIMEOUT_MESSAGES = new Set([
  "Attendance export exceeded its time limit",
  "Attendance report database query exceeded its time limit",
]);

export const handleAttendanceReportError = (error, req, res, next) => {
  const isExportTimeout =
    error?.statusCode === 504 && EXPORT_TIMEOUT_MESSAGES.has(error.message);
  const statusCode = isExportTimeout
    ? 504
    : Number.isInteger(error?.statusCode) &&
        error.statusCode >= 400 &&
        error.statusCode < 500
      ? error.statusCode
      : 500;

  if (statusCode === 500) {
    console.error("[Attendance Report] Request failed:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      errors: [],
    });
  }

  return res.status(statusCode).json({
    success: false,
    message: isExportTimeout ? error.message : error.message || "Request failed",
    errors: Array.isArray(error.errors) ? error.errors : [],
  });
};
