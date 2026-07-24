import { z } from "zod";
import ApiError from "../../utils/ApiError.js";
import asyncHandler from "../../utils/asyncHandler.js";

const createRegionSchema = z.object({
  districtId: z
    .string({ required_error: "District ID is required" })
    .trim()
    .min(1, "District ID is required"),
  name: z
    .string({ required_error: "Region name is required" })
    .trim()
    .min(2, "Region name must be at least 2 characters")
    .max(100, "Region name must not exceed 100 characters"),
  code: z
    .string()
    .trim()
    .max(20, "Region code must not exceed 20 characters")
    .optional(),
  description: z
    .string()
    .trim()
    .max(500, "Description must not exceed 500 characters")
    .optional(),
  isActive: z.boolean().optional(),
});

const updateRegionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Region name must be at least 2 characters")
    .max(100, "Region name must not exceed 100 characters")
    .optional(),
  code: z
    .string()
    .trim()
    .max(20, "Region code must not exceed 20 characters")
    .optional(),
  description: z
    .string()
    .trim()
    .max(500, "Description must not exceed 500 characters")
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

export { createRegionSchema, updateRegionSchema, validateRequest };
