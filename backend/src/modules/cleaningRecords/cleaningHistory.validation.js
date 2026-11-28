import { z } from "zod";

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid ID");
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HISTORY_OFFSET = 10_000;

const dateOnly = z
  .string()
  .regex(DATE_PATTERN, "Use YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Invalid calendar date");

const page = z
  .string()
  .regex(/^\d+$/, "Must be a positive integer")
  .transform(Number)
  .pipe(z.number().int().min(1).max(MAX_HISTORY_OFFSET + 1))
  .optional()
  .transform((value) => value ?? 1);

const limit = z
  .string()
  .regex(/^\d+$/, "Must be a positive integer")
  .transform(Number)
  .pipe(z.number().int().min(1).max(100))
  .optional()
  .transform((value) => value ?? 25);

export const cleaningHistoryParamsSchema = z
  .object({ planId: objectId })
  .strict();

export const cleaningHistoryQuerySchema = z
  .object({
    page,
    limit,
    fromDate: dateOnly.optional(),
    toDate: dateOnly.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      query.fromDate &&
      query.toDate &&
      query.fromDate > query.toDate
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fromDate"],
        message: "fromDate must be on or before toDate",
      });
    }

    if ((query.page - 1) * query.limit > MAX_HISTORY_OFFSET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["page"],
        message: `History offset cannot exceed ${MAX_HISTORY_OFFSET}`,
      });
    }
  });
