import { z } from "zod";
import ApiError from "../../utils/ApiError.js";
import asyncHandler from "../../utils/asyncHandler.js";
import {
  effectiveExitDateSchema,
  isExitDateOnOrAfterJoiningDate,
  joiningDateSchema,
} from "./employeeDates.js";

const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");

const positiveQueryInteger = (fallback, maximum = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .regex(/^\d+$/, "Must be a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(1).max(maximum))
    .optional()
    .transform((value) => value ?? fallback);

export const employeeOptionsQuerySchema = z
  .object({
    search: z.string().trim().max(100, "Search is too long").optional().default(""),
    page: positiveQueryInteger(1),
    limit: positiveQueryInteger(20, 50),
    activeOnly: z.enum(["true", "false"]).optional(),
  })
  .strict()
  .superRefine(({ page, limit }, context) => {
    if (!Number.isSafeInteger((page - 1) * limit)) {
      context.addIssue({
        code: "custom",
        path: ["page"],
        message: "Page offset is outside the supported range",
      });
    }
  });

const employeeUserIdParamsSchema = z.object({ userId: objectIdSchema });
const employeeIdParamsSchema = z.object({ employeeId: objectIdSchema });

const createEmployeeSchema = z.object({
  designation: z.string().trim().min(2, "Designation is required"),
  department: z.string().trim().min(2, "Department is required"),
  joiningDate: joiningDateSchema,
  effectiveExitDate: effectiveExitDateSchema,
  employmentType: z.enum(["full-time", "part-time", "contract"], {
    errorMap: () => ({
      message: "Employment type must be 'full-time', 'part-time' or 'contract'",
    }),
  }),
  districtIds: z.array(objectIdSchema),
  assignedAtmIds: z.array(objectIdSchema).optional(),
  regionIds: z.array(objectIdSchema).optional(),
  supervisorId: objectIdSchema.nullable().optional(),
  salary: z
    .number({ invalid_type_error: "Salary must be a number" })
    .nonnegative("Salary must be zero or greater")
    .optional(),
}).superRefine((values, context) => {
  if (
    values.effectiveExitDate &&
    values.joiningDate &&
    !isExitDateOnOrAfterJoiningDate(
      values.joiningDate,
      values.effectiveExitDate,
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["effectiveExitDate"],
      message: "effectiveExitDate must be on or after joiningDate",
    });
  }
});

const validateRequest = (schema, source = "body") => {
  return asyncHandler(async (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        path: issue.path.join(".") || source,
        message: issue.message,
      }));

      return next(new ApiError(400, "Validation failed", errors));
    }

    req[source] = result.data;
    next();
  });
};

// update employee schema
const updateEmployeeSchema = z
  .object({
    designation: z.string().trim().min(2, "Designation is required").optional(),
    department: z.string().trim().min(2, "Department is required").optional(),
    joiningDate: joiningDateSchema.optional(),
    effectiveExitDate: effectiveExitDateSchema,
    employmentType: z
      .enum(["full-time", "part-time", "contract"], {
        errorMap: () => ({
          message:
            "Employment type must be 'full-time', 'part-time' or 'contract'",
        }),
      })
      .optional(),
    districtIds: z.array(objectIdSchema).optional(),
    assignedAtmIds: z.array(objectIdSchema).optional(),
    regionIds: z.array(objectIdSchema).optional(),
    supervisorId: objectIdSchema.nullable().optional(),
    status: z
      .enum(["active", "inactive", "on_leave", "resigned"], {
        errorMap: () => ({
          message:
            "Status must be 'active', 'inactive', 'on_leave' or 'resigned'",
        }),
      })
      .optional(),
    salary: z
      .number({ invalid_type_error: "Salary must be a number" })
      .nonnegative("Salary must be zero or greater")
      .optional(),
  })
  .strict()
  .superRefine((values, context) => {
    if (
      values.effectiveExitDate &&
      values.joiningDate &&
      !isExitDateOnOrAfterJoiningDate(
        values.joiningDate,
        values.effectiveExitDate,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveExitDate"],
        message: "effectiveExitDate must be on or after joiningDate",
      });
    }
  });

const assignATMsSchema = z.object({
  assignedAtmIds: z
    .array(objectIdSchema)
    .min(1, "At least one ATM ID must be provided"),
});

const assignDistrictsSchema = z.object({
  districtIds: z
    .array(objectIdSchema)
    .min(1, "At least one district ID must be provided"),
});

export {
  createEmployeeSchema,
  employeeUserIdParamsSchema,
  employeeIdParamsSchema,
  updateEmployeeSchema,
  validateRequest,
  assignATMsSchema,
  assignDistrictsSchema,
};
