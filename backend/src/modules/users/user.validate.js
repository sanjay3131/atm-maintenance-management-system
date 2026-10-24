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
  role: z.enum(
    ["user", "admin", "superAdmin", "employee", "customer", "supervisor"],
    {
      errorMap: () => ({
        message:
          "Invalid user type. Must be 'user', 'admin', 'superAdmin', 'employee', 'customer' or 'supervisor'",
      }),
    },
  ),
});

const changeUserStatusSchema = z
  .object({
    status: z
      .enum(["active", "inactive", "blocked"], {
        errorMap: () => ({
          message: "Invalid status. Must be 'active', 'inactive' or 'blocked'",
        }),
      })
      .optional(),
  })
  .strict();
const createEmployeeUserSchema = z.object({
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

const createSupervisorSchema = z
  .object({
    firstName: z.string().trim().min(2, "First name must be at least 2 characters"),
    lastName: z.string().trim().min(1).optional().or(z.literal("")),
    email: z.string().trim().email("Please enter a valid email").toLowerCase(),
    password: z.string().min(8, "Password must be at least 8 characters"),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^[0-9+\-()\s]{8,20}$/, "Please enter a valid phone number"),
  })
  .strict();

const updateSupervisorSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(2, "First name must be at least 2 characters")
      .optional(),
    lastName: z.string().trim().min(1).optional().or(z.literal("")),
    email: z.string().trim().email("Please enter a valid email").toLowerCase().optional(),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^[0-9+\-()\s]{8,20}$/, "Please enter a valid phone number")
      .optional(),
  })
  .strict()
  .refine((values) => Object.keys(values).length > 0, {
    message: "At least one supervisor field must be provided",
  });

const supervisorManagementQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const supervisorIdParamsSchema = z
  .object({ id: z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid supervisor ID") })
  .strict();

const supervisorStatusSchema = z
  .object({ status: z.enum(["active", "inactive"]) })
  .strict();

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
  createEmployeeUserSchema,
  createSupervisorSchema,
  updateSupervisorSchema,
  supervisorManagementQuerySchema,
  supervisorIdParamsSchema,
  supervisorStatusSchema,
  validateRequest,
};
