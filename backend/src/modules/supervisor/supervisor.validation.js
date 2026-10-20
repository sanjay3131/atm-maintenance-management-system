import { z } from "zod";
import { JOB_STATUS } from "../../utils/jobStatus.js";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid ID");
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Date must be a valid calendar date");
const positiveInteger = (fallback, maximum) =>
  z
    .string()
    .regex(/^\d+$/, "Must be a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(1).max(maximum))
    .optional()
    .transform((value) => value ?? fallback);

export const supervisorEmployeeParamsSchema = z
  .object({ employeeId: objectIdSchema })
  .strict();

export const supervisorJobParamsSchema = z
  .object({ jobId: objectIdSchema })
  .strict();

export const supervisorAmcParamsSchema = z
  .object({ amcId: objectIdSchema })
  .strict();

export const amcIdParamsSchema = z
  .object({ id: objectIdSchema })
  .strict();

const paginationFields = {
  page: positiveInteger(1, 100_000),
  limit: positiveInteger(20, 100),
};

const dateRangeFields = {
  fromDate: dateSchema.optional(),
  toDate: dateSchema.optional(),
};

const validateDateRange = (query, context) => {
  if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
    context.addIssue({
      code: "custom",
      path: ["fromDate"],
      message: "fromDate must be on or before toDate",
    });
  }
};

export const supervisorEmployeeListQuerySchema = z
  .object({
    ...paginationFields,
    search: z.string().trim().max(100).optional(),
  })
  .strict();

export const supervisorAttendanceQuerySchema = z
  .object({ ...paginationFields, ...dateRangeFields })
  .strict()
  .superRefine(validateDateRange);

export const supervisorJobQuerySchema = z
  .object({
    ...paginationFields,
    search: z.string().trim().max(100).optional(),
    status: z
      .string()
      .refine((value) => Object.values(JOB_STATUS).includes(value), {
        message: "Invalid job status",
      })
      .optional(),
    ...dateRangeFields,
  })
  .strict()
  .superRefine(validateDateRange);

export const supervisorAmcQuerySchema = z
  .object({
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(1).max(9999).optional(),
    ...paginationFields,
    limit: positiveInteger(20, 100),
  })
  .strict();

export const supervisorDashboardQuerySchema = z
  .object({ date: dateSchema.optional() })
  .strict();
