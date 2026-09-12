import { z } from "zod";
import ApiError from "../../utils/ApiError.js";
import asyncHandler from "../../utils/asyncHandler.js";

const registerSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(2, "First name must be at least 2 characters"),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .optional()
    .or(z.literal("")),
  email: z.string().trim().email("Please enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^[0-9+\-()\s]{8,20}$/, "Please enter a valid phone number"),
});

const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required").optional(),
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

export { registerSchema, loginSchema, refreshSchema, validateRequest };
