export const handleAttendanceError = (error, req, res, next) => {
  const statusCode = Number.isInteger(error?.statusCode)
    ? error.statusCode
    : 500;

  if (statusCode < 500) {
    return next(error);
  }

  console.error("[Attendance] Request failed:", error);
  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
    errors: [],
  });
};
