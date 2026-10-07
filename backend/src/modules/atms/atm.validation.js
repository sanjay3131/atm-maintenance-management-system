import { z } from "zod";
import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";

const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");

export const createAtmSchema = z.object({
  bankId: z.string().trim().min(1, "Bank ID is required"),
  customerId: z.string().trim().min(1, "Customer ID is required"),
  districtId: objectIdSchema,
  regionId: objectIdSchema.nullable(),
  locationName: z.string().trim().min(1, "Location name is required"),
  address: z.string().trim().min(1, "Address is required"),
  installationType: z.enum(["ONSITE", "OFFSITE"], {
    errorMap: () => ({
      message: "Installation type must be either ONSITE or OFFSITE",
    }),
  }),

  location: z
    .object({
      type: z.literal("Point"),
      coordinates: z
        .array(z.number())
        .length(
          2,
          "Coordinates must be an array of two numbers [longitude, latitude]",
        ),
    })
    .optional(),
  status: z
    .enum(["ACTIVE", "INACTIVE", "UNDER_MAINTENANCE", "REMOVED"], {
      errorMap: () => ({ message: "Status must be either ACTIVE or INACTIVE" }),
    })
    .optional(),

  assignedEmployeeId: z
    .array(objectIdSchema)
    .max(1, "An ATM can have only one assigned employee")
    .optional(),
});
// update atm schema
export const updateAtmSchema = z.object({
  bankId: z.string().trim().min(1, "Bank ID is required").optional(),
  customerId: z.string().trim().min(1, "Customer ID is required").optional(),
  districtId: objectIdSchema.optional(),
  regionId: objectIdSchema.nullable().optional(),
  locationName: z
    .string()
    .trim()
    .min(1, "Location name is required")
    .optional(),
  address: z.string().trim().min(1, "Address is required").optional(),
  installationType: z
    .enum(["ONSITE", "OFFSITE"], {
      errorMap: () => ({
        message: "Installation type must be either ONSITE or OFFSITE",
      }),
    })
    .optional(),
  location: z
    .object({
      type: z.literal("Point"),
      coordinates: z
        .array(z.number())
        .length(
          2,
          "Coordinates must be an array of two numbers [longitude, latitude]",
        ),
    })
    .optional(),
  status: z
    .enum(["ACTIVE", "INACTIVE", "UNDER_MAINTENANCE", "REMOVED"], {
      errorMap: () => ({ message: "Status must be either ACTIVE or INACTIVE" }),
    })
    .optional(),
  assignedEmployeeId: z
    .array(objectIdSchema)
    .max(1, "An ATM can have only one assigned employee")
    .optional(),
});

export const assignATMEmployeeSchema = z.object({
  employeeId: objectIdSchema.nullable(),
});
export const validateRequest = (schema) => {
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
