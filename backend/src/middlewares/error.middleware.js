const errorMiddleware = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isCustomerReportRequest = /\/customers\/portal\/reports\//.test(
    req.originalUrl || req.url || "",
  );
  const hideCustomerReportError =
    isCustomerReportRequest && statusCode >= 500;
  const message = hideCustomerReportError
    ? "Unable to process customer report"
    : err.message || "Internal Server Error";

  res.status(statusCode).json({
    success: false,
    message,
    errors: hideCustomerReportError ? [] : err.errors || [],
    stack:
      !hideCustomerReportError && process.env.NODE_ENV === "development"
        ? err.stack
        : undefined,
  });
};

export default errorMiddleware;
