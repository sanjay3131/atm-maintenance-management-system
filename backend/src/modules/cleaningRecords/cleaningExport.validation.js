import mongoose from "mongoose";
import { z } from "zod";

export const MAX_CLEANING_EXPORT_DAYS = 366;

const isDateOnly = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const dateOnly = z.string().refine(isDateOnly, {
  message: "Date must be a valid YYYY-MM-DD calendar date",
});
const objectId = z.string().refine(mongoose.isValidObjectId, {
  message: "Must be a valid MongoDB ID",
});

export const cleaningExportQuerySchema = z
  .object({
    fromDate: dateOnly,
    toDate: dateOnly,
    bankId: objectId.optional(),
    regionId: objectId.optional(),
    districtId: objectId.optional(),
    maintenanceType: z.enum(["DAILY_CLEANING", "WEEKLY_MOPPING"]).optional(),
    employeeId: objectId.optional(),
    monitoringStatus: z
      .enum([
        "GREEN",
        "RED",
        "GRACE_PERIOD",
        "NO_HISTORY",
        "CONFIGURATION_REQUIRED",
      ])
      .optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (!isDateOnly(query.fromDate) || !isDateOnly(query.toDate)) return;

    const from = new Date(`${query.fromDate}T00:00:00.000Z`).getTime();
    const to = new Date(`${query.toDate}T00:00:00.000Z`).getTime();
    if (from > to) {
      context.addIssue({
        code: "custom",
        path: ["toDate"],
        message: "toDate must be on or after fromDate",
      });
      return;
    }

    const days = (to - from) / 86_400_000 + 1;
    if (days > MAX_CLEANING_EXPORT_DAYS) {
      context.addIssue({
        code: "custom",
        path: ["toDate"],
        message: `Date range cannot exceed ${MAX_CLEANING_EXPORT_DAYS} days`,
      });
    }
  });
