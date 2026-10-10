import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";

export const validateRequest = (schema, source = "body") => {
  return asyncHandler(async (req, res, next) => {
    if (!["body", "query", "params"].includes(source)) {
      throw new Error(`Unsupported validation source: ${source}`);
    }
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        path: issue.path.join(".") || source,
        message: issue.message,
      }));

      return next(new ApiError(400, "Validation failed", errors));
    }

    if (source === "body") {
      req.body = result.data;
    } else {
      req[`validated${source[0].toUpperCase()}${source.slice(1)}`] = result.data;
    }
    next();
  });
};
