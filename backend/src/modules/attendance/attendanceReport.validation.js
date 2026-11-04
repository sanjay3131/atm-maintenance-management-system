import { z } from "zod";
import { isValidAttendanceDate } from "./attendance.validation.js";
import {
  MAX_ATTENDANCE_REPORT_DAYS,
  MAX_ATTENDANCE_REPORT_EMPLOYEES,
} from "./attendanceReport.service.js";
import { toAsiaKolkataDateKey } from "../employees/employeeDates.js";

const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
const OFFSET_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const dateOnlySchema = z
  .string()
  .refine(isValidAttendanceDate, "Date must be a valid YYYY-MM-DD calendar date");

const positiveInteger = (fallback, maximum = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .regex(/^\d+$/, "Must be a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(1).max(maximum))
    .optional()
    .transform((value) => value ?? fallback);

const utcDay = (dateKey) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.floor(date.getTime() / DAY_MS);
};

const lastDayOfMonth = (year, month) => {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, 0);
  return date.toISOString().slice(0, 10);
};

const expectedPeriodEnd = (periodStart, periodEnd, asOfDate) => {
  if (asOfDate < periodStart) return null;
  return asOfDate < periodEnd ? asOfDate : periodEnd;
};

const isValidOffsetTimestamp = (value) => {
  const match = OFFSET_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;

  const [, year, month, day, , offset] = match;
  if (!isValidAttendanceDate(`${year}-${month}-${day}`)) return false;
  if ((offset.startsWith("+14:") || offset.startsWith("-14:")) && !offset.endsWith(":00")) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
};

const asOfSchema = z
  .string()
  .refine(
    isValidOffsetTimestamp,
    "Timestamp must be valid ISO-8601 with an explicit timezone offset",
  )
  .transform((value) => new Date(value))
  .refine(
    (value) => value.getTime() <= Date.now(),
    "asOf cannot be in the future",
  );

const reportDateRange = (query, context) => {
  if (query.fromDate > query.toDate) {
    context.addIssue({
      code: "custom",
      path: ["fromDate"],
      message: "fromDate must be on or before toDate",
    });
    return;
  }

  if (
    utcDay(query.toDate) - utcDay(query.fromDate) + 1 >
    MAX_ATTENDANCE_REPORT_DAYS
  ) {
    context.addIssue({
      code: "custom",
      path: ["toDate"],
      message: `Date range cannot exceed ${MAX_ATTENDANCE_REPORT_DAYS} calendar days`,
    });
  }
};

const reportPeriodRange = (query, context) => {
  const { periodType, fromDate, toDate } = query;
  if (
    periodType === "custom" ||
    !isValidAttendanceDate(fromDate) ||
    !isValidAttendanceDate(toDate)
  ) {
    return;
  }

  if (periodType === "week") {
    const weekday = new Date(utcDay(fromDate) * DAY_MS).getUTCDay();
    if (weekday !== 1) {
      context.addIssue({
        code: "custom",
        path: ["fromDate"],
        message: "Weekly periods must start on Monday",
      });
    }
    if (utcDay(toDate) - utcDay(fromDate) > 6) {
      context.addIssue({
        code: "custom",
        path: ["toDate"],
        message: "Weekly periods cannot extend beyond Sunday",
      });
    }
    return;
  }

  if (periodType === "month") {
    const [year, month] = fromDate.split("-").map(Number);
    const monthStart = `${fromDate.slice(0, 7)}-01`;
    const monthEnd = lastDayOfMonth(year, month);
    if (fromDate !== monthStart) {
      context.addIssue({
        code: "custom",
        path: ["fromDate"],
        message: "Monthly periods must start on the first day of a month",
      });
    }
    if (fromDate.slice(0, 7) !== toDate.slice(0, 7)) {
      context.addIssue({
        code: "custom",
        path: ["toDate"],
        message: "Monthly periods must stay within one calendar month",
      });
    }
    if (query.asOf instanceof Date) {
      const expectedEnd = expectedPeriodEnd(
        monthStart,
        monthEnd,
        toAsiaKolkataDateKey(query.asOf),
      );
      if (expectedEnd === null || toDate !== expectedEnd) {
        context.addIssue({
          code: "custom",
          path: ["toDate"],
          message:
            "Monthly periods must end at the calendar month end or the asOf business-date cutoff",
        });
      }
    }
    return;
  }

  const yearStart = `${fromDate.slice(0, 4)}-01-01`;
  const yearEnd = `${fromDate.slice(0, 4)}-12-31`;
  if (fromDate !== yearStart) {
    context.addIssue({
      code: "custom",
      path: ["fromDate"],
      message: "Yearly periods must start on January 1",
    });
  }
  if (fromDate.slice(0, 4) !== toDate.slice(0, 4)) {
    context.addIssue({
      code: "custom",
      path: ["toDate"],
      message: "Yearly periods must stay within one calendar year",
    });
  }
  if (query.asOf instanceof Date) {
    const expectedEnd = expectedPeriodEnd(
      yearStart,
      yearEnd,
      toAsiaKolkataDateKey(query.asOf),
    );
    if (expectedEnd === null || toDate !== expectedEnd) {
      context.addIssue({
        code: "custom",
        path: ["toDate"],
        message:
          "Yearly periods must end at the calendar year end or the asOf business-date cutoff",
      });
    }
  }
};

const reportScopeShape = {
  fromDate: dateOnlySchema,
  toDate: dateOnlySchema,
  employeeId: z.string().regex(OBJECT_ID_PATTERN, "Invalid ID").optional(),
};

export const attendanceReportQuerySchema = z
  .object({
    ...reportScopeShape,
    page: positiveInteger(1),
    limit: positiveInteger(25, MAX_ATTENDANCE_REPORT_EMPLOYEES),
    asOf: asOfSchema.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (!Number.isSafeInteger((query.page - 1) * query.limit)) {
      context.addIssue({
        code: "custom",
        path: ["page"],
        message: "Page offset is outside the supported range",
      });
    }
    reportDateRange(query, context);
  });

export const attendanceReportExportQuerySchema = z
  .object({
    ...reportScopeShape,
    asOf: asOfSchema,
    periodType: z.enum(["week", "month", "year", "custom"]),
  })
  .strict()
  .superRefine((query, context) => {
    reportDateRange(query, context);
    reportPeriodRange(query, context);
  });
