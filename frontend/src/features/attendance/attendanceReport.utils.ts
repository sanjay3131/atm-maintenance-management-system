export const ATTENDANCE_REPORT_TIME_ZONE = "Asia/Kolkata";
export const MAX_ATTENDANCE_REPORT_DAYS = 366;

export type AttendanceReportPeriod = "week" | "month" | "year";

export interface AttendanceReportDateRange {
  fromDate: string;
  toDate: string;
}

export type AttendanceReportDateRangeValidation =
  | { valid: true }
  | {
      valid: false;
      reason: "invalid_date" | "reversed_range" | "range_too_long";
    };

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateKey(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatDateKey(date: Date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function requireDateKey(value: string) {
  const date = parseDateKey(value);
  if (!date) throw new RangeError("Expected a valid YYYY-MM-DD date");
  return date;
}

function getDatePartsInBusinessTimeZone(date: Date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new RangeError("Expected a valid date");
  }

  // Format the instant in the business zone before extracting its calendar date.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATTENDANCE_REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function daysFromDateKey(value: string) {
  return requireDateKey(value).getTime() / DAY_MS;
}

function addDays(date: Date, count: number) {
  return new Date(date.getTime() + count * DAY_MS);
}

function getPeriodBounds(period: AttendanceReportPeriod, anchor: Date) {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();

  if (period === "week") {
    const mondayOffset = (anchor.getUTCDay() + 6) % 7;
    const monday = addDays(anchor, -mondayOffset);
    return { start: monday, end: addDays(monday, 6) };
  }

  if (period === "month") {
    const start = new Date(0);
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCFullYear(year, month, 1);
    const end = new Date(0);
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCFullYear(year, month + 1, 0);
    return { start, end };
  }

  const start = new Date(0);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCFullYear(year, 0, 1);
  const end = new Date(0);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCFullYear(year, 11, 31);
  return { start, end };
}

export function isValidAttendanceReportDate(value: string) {
  return typeof value === "string" && parseDateKey(value) !== null;
}

export function getCurrentBusinessDate(now = new Date()) {
  const parts = getDatePartsInBusinessTimeZone(now);
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`;
}

export function getCurrentMonthAttendanceRange(
  now = new Date(),
): AttendanceReportDateRange {
  const today = requireDateKey(getCurrentBusinessDate(now));
  const start = new Date(0);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCFullYear(today.getUTCFullYear(), today.getUTCMonth(), 1);
  return { fromDate: formatDateKey(start), toDate: formatDateKey(today) };
}

export function getAttendanceReportPeriodRange(
  period: AttendanceReportPeriod,
  referenceDate: string,
  now = new Date(),
): AttendanceReportDateRange {
  const anchor = requireDateKey(referenceDate);
  const { start, end } = getPeriodBounds(period, anchor);
  const today = requireDateKey(getCurrentBusinessDate(now));
  const rangeEnd = start <= today && today <= end ? today : end;
  const fromDate = formatDateKey(start);
  const toDate = formatDateKey(rangeEnd);
  if (
    !isValidAttendanceReportDate(fromDate) ||
    !isValidAttendanceReportDate(toDate)
  ) {
    throw new RangeError(
      "Attendance report period must stay within years 0001–9999",
    );
  }
  return {
    fromDate,
    toDate,
  };
}

export function navigateAttendanceReportPeriod(
  currentRange: AttendanceReportDateRange,
  period: AttendanceReportPeriod,
  direction: -1 | 1,
  now = new Date(),
): AttendanceReportDateRange {
  const start = requireDateKey(currentRange.fromDate);
  let nextAnchor: Date;

  if (period === "week") {
    nextAnchor = addDays(start, direction * 7);
  } else if (period === "month") {
    nextAnchor = new Date(0);
    nextAnchor.setUTCHours(0, 0, 0, 0);
    nextAnchor.setUTCFullYear(
      start.getUTCFullYear(),
      start.getUTCMonth() + direction,
      1,
    );
  } else {
    nextAnchor = new Date(0);
    nextAnchor.setUTCHours(0, 0, 0, 0);
    nextAnchor.setUTCFullYear(start.getUTCFullYear() + direction, 0, 1);
  }

  const nextYear = nextAnchor.getUTCFullYear();
  if (nextYear < 1 || nextYear > 9999) {
    throw new RangeError("Attendance report navigation must stay within years 0001–9999");
  }

  return getAttendanceReportPeriodRange(
    period,
    formatDateKey(nextAnchor),
    now,
  );
}

export function validateAttendanceReportDateRange(
  fromDate: string,
  toDate: string,
): AttendanceReportDateRangeValidation {
  if (
    !isValidAttendanceReportDate(fromDate) ||
    !isValidAttendanceReportDate(toDate)
  ) {
    return { valid: false, reason: "invalid_date" };
  }
  if (fromDate > toDate) {
    return { valid: false, reason: "reversed_range" };
  }
  if (
    daysFromDateKey(toDate) - daysFromDateKey(fromDate) + 1 >
    MAX_ATTENDANCE_REPORT_DAYS
  ) {
    return { valid: false, reason: "range_too_long" };
  }
  return { valid: true };
}
