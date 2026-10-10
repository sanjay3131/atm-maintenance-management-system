import { z } from "zod";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFSET_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;

export const isValidAttendanceDate = (value) => {
  if (typeof value !== "string") return false;
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  return (
    year > 0 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const attendanceDateSchema = z
  .string()
  .refine(isValidAttendanceDate, "Date must be a valid YYYY-MM-DD calendar date");

const objectIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid ID");

const paginationValue = (fallback, max) =>
  z
    .string()
    .regex(/^\d+$/, "Must be a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(1).max(max))
    .optional()
    .transform((value) => value ?? fallback);

const attendanceListFields = {
  fromDate: attendanceDateSchema.optional(),
  toDate: attendanceDateSchema.optional(),
  page: paginationValue(1, Number.MAX_SAFE_INTEGER),
  limit: paginationValue(20, 100),
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

const offsetTimestampSchema = z
  .string()
  .refine((value) => {
    const match = OFFSET_DATETIME_PATTERN.exec(value);
    if (!match) return false;

    const [, yearValue, monthValue, dayValue, , offset] = match;
    if (
      !isValidAttendanceDate(
        `${yearValue}-${monthValue}-${dayValue}`,
      )
    ) {
      return false;
    }
    if (offset.startsWith("+14:") || offset.startsWith("-14:")) {
      return offset.endsWith(":00");
    }

    return Number.isFinite(Date.parse(value));
  }, "Timestamp must be valid ISO-8601 with an explicit timezone offset");

const emptyRequestSchema = z.object({}).strict();

const optionalEmptyRequestSchema = emptyRequestSchema
  .optional()
  .transform((body) => body ?? {});

export const selfCheckInSchema = optionalEmptyRequestSchema;
export const selfCheckOutSchema = optionalEmptyRequestSchema;

export const onBehalfCheckInSchema = z
  .object({
    checkInAt: offsetTimestampSchema.optional(),
  })
  .strict();

export const onBehalfCheckOutSchema = z
  .object({
    checkOutAt: offsetTimestampSchema.optional(),
  })
  .strict();

export const onBehalfAttendanceEntrySchema = z
  .object({
    checkInAt: offsetTimestampSchema,
    checkOutAt: offsetTimestampSchema.optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      entry.checkOutAt &&
      Date.parse(entry.checkOutAt) < Date.parse(entry.checkInAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["checkOutAt"],
        message: "Check-out must not be earlier than check-in",
      });
    }
  });

export const onBehalfAttendanceRecordSchema = z
  .object({
    checkInAt: offsetTimestampSchema.optional(),
    checkOutAt: offsetTimestampSchema.optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      entry.checkInAt &&
      entry.checkOutAt &&
      Date.parse(entry.checkOutAt) < Date.parse(entry.checkInAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["checkOutAt"],
        message: "Check-out must not be earlier than check-in",
      });
    }
  });

export const myAttendanceQuerySchema = z
  .object(attendanceListFields)
  .strict()
  .superRefine(validateDateRange);

export const attendanceRecordsQuerySchema = z
  .object({
    ...attendanceListFields,
    employeeId: objectIdSchema.optional(),
  })
  .strict()
  .superRefine(validateDateRange);

export const employeeIdParamsSchema = z
  .object({ employeeId: objectIdSchema })
  .strict();

export const attendanceIdParamsSchema = z
  .object({ id: objectIdSchema })
  .strict();

const correctionValuesSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    checkInAt: offsetTimestampSchema.optional(),
    checkOutAt: offsetTimestampSchema.nullable().optional(),
    attendanceDate: attendanceDateSchema.optional(),
  })
  .strict()
  .superRefine((correction, context) => {
    const hasRevisedValue =
      correction.checkInAt !== undefined ||
      correction.checkOutAt !== undefined ||
      correction.attendanceDate !== undefined;

    if (!hasRevisedValue) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "At least one attendance field must be corrected",
      });
    }

    if (
      correction.checkInAt &&
      correction.checkOutAt &&
      Date.parse(correction.checkOutAt) < Date.parse(correction.checkInAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["checkOutAt"],
        message: "Check-out must not be earlier than check-in",
      });
    }
  });

export const attendanceCorrectionSchema = correctionValuesSchema;
export const attendanceDateOnlySchema = attendanceDateSchema;
