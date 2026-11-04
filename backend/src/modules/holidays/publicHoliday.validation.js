import { z } from "zod";
import { isValidAttendanceDate } from "../attendance/attendance.validation.js";

const dateSchema = z
  .string()
  .refine(isValidAttendanceDate, "Date must be a valid YYYY-MM-DD calendar date");

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid ID");
const paginationValue = (fallback, max) =>
  z
    .string()
    .regex(/^\d+$/, "Must be a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(1).max(max))
    .optional()
    .transform((value) => value ?? fallback);

const validateRange = (query, context) => {
  if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
    context.addIssue({
      code: "custom",
      path: ["fromDate"],
      message: "fromDate must be on or before toDate",
    });
  }
};

export const publicHolidayIdParamsSchema = z
  .object({ holidayId: objectIdSchema })
  .strict();

export const publicHolidayListQuerySchema = z
  .object({
    fromDate: dateSchema.optional(),
    toDate: dateSchema.optional(),
    page: paginationValue(1, Number.MAX_SAFE_INTEGER),
    limit: paginationValue(20, 100),
  })
  .strict()
  .superRefine(validateRange);

export const createPublicHolidaySchema = z
  .object({
    date: dateSchema,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000).optional(),
  })
  .strict();

export const updatePublicHolidaySchema = z
  .object({
    date: dateSchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one holiday field must be updated",
  });
