import { z } from "zod";
import ApiError from "../../utils/ApiError.js";
import asyncHandler from "../../utils/asyncHandler.js";

const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid MongoDB ObjectId");

const createEmployeeSchema = z.object({
  designation: z.string().trim().min(2, "Designation is required"),
  department: z.string().trim().min(2, "Department is required"),
  joiningDate: z.preprocess(
    (value) => {
      if (typeof value === "string" && value.trim() !== "") {
        return new Date(value);
      }
      return value;
    },
    z.date({ invalid_type_error: "Joining date must be a valid date" }),
  ),
  employmentType: z.enum(["full-time", "part-time", "contract"], {
    errorMap: () => ({
      message: "Employment type must be 'full-time', 'part-time' or 'contract'",
    }),
  }),
  districtIds: z.array(objectIdSchema),
  assignedAtmIds: z.array(objectIdSchema),
  salary: z
    .number({ invalid_type_error: "Salary must be a number" })
    .nonnegative("Salary must be zero or greater")
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

// update employee schema
const updateEmployeeSchema = z.object({
  designation: z.string().trim().min(2, "Designation is required").optional(),
  department: z.string().trim().min(2, "Department is required").optional(),
  joiningDate: z.preprocess(
    (value) => {
      if (typeof value === "string" && value.trim() !== "") {
        return new Date(value);
      }
      return value;
    },
    z
      .date({ invalid_type_error: "Joining date must be a valid date" })
      .optional(),
  ),
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
});

export { createEmployeeSchema, updateEmployeeSchema, validateRequest };
