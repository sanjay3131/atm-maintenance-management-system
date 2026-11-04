import assert from "node:assert/strict";
import test from "node:test";
import {
  getAttendanceReportPeriodRange,
  getCurrentBusinessDate,
  getCurrentMonthAttendanceRange,
  isValidAttendanceReportDate,
  navigateAttendanceReportPeriod,
  validateAttendanceReportDateRange,
} from "../src/features/attendance/attendanceReport.utils.ts";

test("uses the Asia/Kolkata calendar date across UTC midnight boundaries", () => {
  assert.equal(getCurrentBusinessDate(new Date("2026-11-04T18:29:59.999Z")), "2026-11-04");
  assert.equal(getCurrentBusinessDate(new Date("2026-11-04T18:30:00.000Z")), "2026-11-05");
});

test("defaults to the current business month through business today", () => {
  assert.deepEqual(
    getCurrentMonthAttendanceRange(new Date("2024-02-29T18:29:59.999Z")),
    { fromDate: "2024-02-01", toDate: "2024-02-29" },
  );
});

test("weekly ranges begin Monday and end Sunday", () => {
  assert.deepEqual(
    getAttendanceReportPeriodRange(
      "week",
      "2024-01-03",
      new Date("2024-02-01T00:00:00.000Z"),
    ),
    { fromDate: "2024-01-01", toDate: "2024-01-07" },
  );
});

test("weekly range at the end of year 9999 is rejected instead of emitting year 10000", () => {
  assert.throws(
    () =>
      getAttendanceReportPeriodRange(
        "week",
        "9999-12-31",
        new Date("2025-01-01T00:00:00.000Z"),
      ),
    RangeError,
  );
});

test("monthly ranges include month boundaries and leap day", () => {
  assert.deepEqual(
    getAttendanceReportPeriodRange(
      "month",
      "2024-02-15",
      new Date("2024-03-01T00:00:00.000Z"),
    ),
    { fromDate: "2024-02-01", toDate: "2024-02-29" },
  );
});

test("yearly ranges span January through December", () => {
  assert.deepEqual(
    getAttendanceReportPeriodRange(
      "year",
      "2023-08-20",
      new Date("2024-01-01T00:00:00.000Z"),
    ),
    { fromDate: "2023-01-01", toDate: "2023-12-31" },
  );
});

test("previous and next navigation preserve the selected period type", () => {
  const now = new Date("2025-06-15T00:00:00.000Z");
  assert.deepEqual(
    navigateAttendanceReportPeriod(
      { fromDate: "2024-01-01", toDate: "2024-01-07" },
      "week",
      1,
      now,
    ),
    { fromDate: "2024-01-08", toDate: "2024-01-14" },
  );
  assert.deepEqual(
    navigateAttendanceReportPeriod(
      { fromDate: "2024-01-01", toDate: "2024-01-31" },
      "month",
      -1,
      now,
    ),
    { fromDate: "2023-12-01", toDate: "2023-12-31" },
  );
  assert.deepEqual(
    navigateAttendanceReportPeriod(
      { fromDate: "2023-01-01", toDate: "2023-12-31" },
      "year",
      1,
      now,
    ),
    { fromDate: "2024-01-01", toDate: "2024-12-31" },
  );
});

test("period navigation rejects values outside the supported four-digit years", () => {
  const now = new Date("2025-06-15T00:00:00.000Z");

  assert.throws(
    () =>
      navigateAttendanceReportPeriod(
        { fromDate: "0001-01-01", toDate: "0001-12-31" },
        "year",
        -1,
        now,
      ),
    RangeError,
  );
  assert.throws(
    () =>
      navigateAttendanceReportPeriod(
        { fromDate: "9999-01-01", toDate: "9999-12-31" },
        "year",
        1,
        now,
      ),
    RangeError,
  );
});

test("period navigation remains valid near both supported year boundaries", () => {
  const now = new Date("2025-06-15T00:00:00.000Z");

  assert.deepEqual(
    navigateAttendanceReportPeriod(
      { fromDate: "0001-01-01", toDate: "0001-12-31" },
      "year",
      1,
      now,
    ),
    { fromDate: "0002-01-01", toDate: "0002-12-31" },
  );
  assert.deepEqual(
    navigateAttendanceReportPeriod(
      { fromDate: "9999-01-01", toDate: "9999-12-31" },
      "year",
      -1,
      now,
    ),
    { fromDate: "9998-01-01", toDate: "9998-12-31" },
  );
});

test("caps the current week, month, and year at the business date", () => {
  const now = new Date("2024-02-28T18:29:59.999Z");
  assert.deepEqual(getAttendanceReportPeriodRange("week", "2024-02-28", now), {
    fromDate: "2024-02-26",
    toDate: "2024-02-28",
  });
  assert.deepEqual(getAttendanceReportPeriodRange("month", "2024-02-01", now), {
    fromDate: "2024-02-01",
    toDate: "2024-02-28",
  });
  assert.deepEqual(getAttendanceReportPeriodRange("year", "2024-01-01", now), {
    fromDate: "2024-01-01",
    toDate: "2024-02-28",
  });
});

test("validates real calendar dates, ordering, and the inclusive 366-day limit", () => {
  assert.equal(isValidAttendanceReportDate("2024-02-29"), true);
  assert.equal(isValidAttendanceReportDate("2023-02-29"), false);
  assert.equal(isValidAttendanceReportDate("2024-2-09"), false);
  assert.deepEqual(
    validateAttendanceReportDateRange("2024-01-01", "2024-12-31"),
    { valid: true },
  );
  assert.deepEqual(
    validateAttendanceReportDateRange("2024-02-02", "2024-02-01"),
    { valid: false, reason: "reversed_range" },
  );
  assert.deepEqual(
    validateAttendanceReportDateRange("2023-01-01", "2024-01-02"),
    { valid: false, reason: "range_too_long" },
  );
  assert.deepEqual(
    validateAttendanceReportDateRange("2024-02-30", "2024-03-01"),
    { valid: false, reason: "invalid_date" },
  );
});
