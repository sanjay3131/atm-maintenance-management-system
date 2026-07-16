import { z } from "zod";
import ApiError from "../../utils/ApiError.js";
import asyncHandler from "../../utils/asyncHandler.js";

const updateUserSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(2, "First name must be at least 2 characters")
    .optional(),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .optional()
    .or(z.literal("")),
  email: z.string().trim().email("Please enter a valid email").optional(),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^[0-9+\-()\s]{8,20}$/, "Please enter a valid phone number")
    .optional(),
});

const assignRoleSchema = z.object({
  role: z.enum(["user", "admin", "superAdmin", "employee", "customer"], {
    errorMap: () => ({
      message:
        "Invalid user type. Must be 'user', 'admin', 'superAdmin', 'employee' or 'customer'",
    }),
  }),
});

const changeUserStatusSchema = z.object({
  status: z
    .enum(["active", "inactive", "blocked"], {
      errorMap: () => ({
        message: "Invalid status. Must be 'active', 'inactive' or 'blocked'",
      }),
    })
    .optional(),
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

export {
  updateUserSchema,
  assignRoleSchema,
  changeUserStatusSchema,
  validateRequest,
};
