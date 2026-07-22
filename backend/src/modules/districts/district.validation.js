import { z } from "zod";
import ApiError from "../../utils/ApiError.js";
import asyncHandler from "../../utils/asyncHandler.js";

const createDistrictSchema = z.object({
  districtName: z
    .string({ required_error: "District name is required" })
    .trim()
    .min(2, "District name must be at least 2 characters")
    .max(100, "District name must not exceed 100 characters"),
  pinCode: z
    .string({ required_error: "Pin code is required" })
    .trim()
    .min(3, "Pin code must be at least 3 characters")
    .max(10, "Pin code must not exceed 10 characters"),
  state: z
    .string({ required_error: "State is required" })
    .trim()
    .min(2, "State must be at least 2 characters"),
  isActive: z.boolean().optional(),
});

const updateDistrictSchema = z.object({
  districtName: z
    .string()
    .trim()
    .min(2, "District name must be at least 2 characters")
    .max(100, "District name must not exceed 100 characters")
    .optional(),
  pinCode: z
    .string()
    .trim()
    .min(3, "Pin code must be at least 3 characters")
    .max(10, "Pin code must not exceed 10 characters")
    .optional(),
  state: z
    .string()
    .trim()
    .min(2, "State must be at least 2 characters")
    .optional(),
  isActive: z.boolean().optional(),
});

const validateRequest = (schema) => {
  return asyncHandler(async (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        path: issue.path.join(".") || "body",
        message: issue.message,
      }));

      return next(new ApiError(400, "Validation failed", errors));
    }

    req.body = result.data;
    next();
  });
};

export { createDistrictSchema, updateDistrictSchema, validateRequest };
