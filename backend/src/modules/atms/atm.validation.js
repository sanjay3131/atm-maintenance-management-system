import { z } from "zod";
import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";

const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");

const uniqueObjectIds = (ids) => [
  ...new Map(
    ids.map((id) => [id.toLowerCase(), id.toLowerCase()]),
  ).values(),
];

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

  assignedEmployeeId: z.array(objectIdSchema).transform(uniqueObjectIds).optional(),
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
  assignedEmployeeId: z.array(objectIdSchema).transform(uniqueObjectIds).optional(),
});

export const assignATMEmployeeSchema = z.object({
  employeeId: objectIdSchema.nullable(),
});

export const setATMAMCResponsibleEmployeeSchema = z.object({
  employeeId: objectIdSchema.nullable(),
});

export const submitATMLocationRequestSchema = z.object({
  atmId: objectIdSchema,
  locationTaskId: objectIdSchema.optional(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(50).optional(),
  inputSource: z.enum(["GPS", "MANUAL"]),
  amcId: objectIdSchema.optional(),
}).superRefine((request, context) => {
  if (request.inputSource === "GPS" && request.accuracy === undefined) {
    context.addIssue({
      code: "custom",
      path: ["accuracy"],
      message: "GPS submissions require accuracy metadata",
    });
  }
  if (request.locationTaskId && request.amcId) {
    context.addIssue({
      code: "custom",
      path: ["amcId"],
      message: "Location-task submissions cannot be linked to an AMC",
    });
  }
});

export const atmLocationRequestParamsSchema = z.object({
  requestId: objectIdSchema,
});

export const atmLocationRequestListQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  atmId: objectIdSchema.optional(),
  search: z.string().trim().max(200).optional(),
  districtId: objectIdSchema.optional(),
  regionId: objectIdSchema.optional(),
  employeeId: objectIdSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const atmIdParamsSchema = z.object({
  id: objectIdSchema,
});

export const locationTaskIdParamsSchema = z.object({
  taskId: objectIdSchema,
});

export const createATMLocationTasksSchema = z.object({
  tasks: z
    .array(
      z.object({
        atmId: objectIdSchema,
        employeeId: objectIdSchema,
        taskType: z.enum(["INITIAL_COLLECTION", "LOCATION_CORRECTION"]),
        correctionReason: z.string().trim().min(1).max(1000).optional(),
        assignmentReason: z.string().trim().max(1000).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const listATMLocationTasksQuerySchema = z.object({
  status: z
    .enum([
      "ASSIGNED",
      "IN_PROGRESS",
      "ON_HOLD",
      "PENDING_REVIEW",
      "REJECTED",
      "COMPLETED",
      "CANCELLED",
    ])
    .optional(),
  taskType: z.enum(["INITIAL_COLLECTION", "LOCATION_CORRECTION"]).optional(),
  atmId: objectIdSchema.optional(),
  assignedEmployeeId: objectIdSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const reassignATMLocationTaskSchema = z.object({
  employeeId: objectIdSchema,
  reason: z.string().trim().min(1).max(1000).optional(),
});

export const reopenATMLocationTaskSchema = z.object({
  employeeId: objectIdSchema,
  reason: z.string().trim().min(1).max(1000),
});

export const cancelATMLocationTaskSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export const rejectATMLocationRequestSchema = z.object({
  reason: z.string().trim().min(1, "Rejection reason is required").max(1000),
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
