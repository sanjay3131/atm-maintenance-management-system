import assert from "node:assert/strict";
import test from "node:test";
import Attendance from "../src/modules/attendance/attendance.model.js";
import AttendanceStatusOverride from "../src/modules/attendance/attendanceStatusOverride.model.js";
import PublicHoliday from "../src/modules/holidays/publicHoliday.model.js";
import {
  calculateAttendanceReports,
  MAX_ATTENDANCE_REPORT_DAYS,
  MAX_ATTENDANCE_REPORT_EMPLOYEES,
} from "../src/modules/attendance/attendanceReport.service.js";
import {
  resolveAttendanceStatus,
} from "../src/modules/attendance/attendanceStatus.js";
import { getAttendanceRecord } from "../src/modules/attendance/attendance.service.js";
import { toAsiaKolkataDateKey } from "../src/modules/employees/employeeDates.js";

const employeeId1 = "64b000000000000000000001";
const employeeId2 = "64b000000000000000000002";
const sixHours = 6 * 60 * 60 * 1000;
const asOf = new Date("2025-01-05T23:00:00.000Z");

const makeEmployee = (id, values = {}) => ({
  _id: id,
  joiningDate: new Date("2024-01-01T00:00:00.000Z"),
  effectiveExitDate: null,
  status: "active",
  ...values,
});

const makeAttendance = (employeeId, attendanceDate, values = {}) => ({
  _id: `${employeeId}-${attendanceDate}`,
  employeeId,
  attendanceDate,
  checkInAt: new Date(`${attendanceDate}T03:00:00.000Z`),
  checkOutAt: new Date(`${attendanceDate}T09:00:00.000Z`),
  checkOutSource: "employee",
  ...values,
});

const withModelMocks = async (
  {
    holidays = [],
    attendance = [],
    overrides = [],
    attendanceQueryError = null,
    attendanceQueryDelayMs = 0,
  } = {},
  callback,
) => {
  const originals = [
    [PublicHoliday, "find", PublicHoliday.find],
    [Attendance, "find", Attendance.find],
    [AttendanceStatusOverride, "find", AttendanceStatusOverride.find],
  ];
  const calls = [];
  calls.queryTimeouts = [];
  const makeQuery = (modelName, rows) => ({
    select() {
      return this;
    },
    maxTimeMS(maxTimeMS) {
      calls.queryTimeouts.push({ modelName, maxTimeMS });
      return this;
    },
    then(resolve, reject) {
      const result = Promise.resolve().then(async () => {
        if (
          modelName === "Attendance.find" &&
          attendanceQueryDelayMs > 0
        ) {
          await new Promise((complete) =>
            setTimeout(complete, attendanceQueryDelayMs),
          );
        }
        if (modelName === "Attendance.find" && attendanceQueryError) {
          throw attendanceQueryError;
        }
        return rows;
      });
      return result.then(resolve, reject);
    },
  });
  PublicHoliday.find = (filter) => {
    calls.push({ modelName: "PublicHoliday.find", filter });
    const rows = holidays.filter(
      ({ date }) => date >= filter.date.$gte && date <= filter.date.$lte,
    );
    return makeQuery("PublicHoliday.find", rows);
  };
  Attendance.find = (filter) => {
    calls.push({ modelName: "Attendance.find", filter });
    const employeeIds = new Set(filter.employeeId.$in.map(String));
    const rows = attendance.filter(
      (record) =>
        employeeIds.has(String(record.employeeId)) &&
        record.attendanceDate >= filter.attendanceDate.$gte &&
        record.attendanceDate <= filter.attendanceDate.$lte,
    );
    return makeQuery("Attendance.find", rows);
  };
  AttendanceStatusOverride.find = (filter) => {
    calls.push({ modelName: "AttendanceStatusOverride.find", filter });
    const employeeIds = new Set(filter.employeeId.$in.map(String));
    const rows = overrides.filter(
      (override) =>
        employeeIds.has(String(override.employeeId)) &&
        override.attendanceDate >= filter.attendanceDate.$gte &&
        override.attendanceDate <= filter.attendanceDate.$lte,
    );
    return makeQuery("AttendanceStatusOverride.find", rows);
  };

  try {
    await callback(calls);
  } finally {
    for (const [model, method, original] of originals.reverse()) {
      model[method] = original;
    }
  }
};

const calculate = (values, mocks, callback) =>
  withModelMocks(mocks, async (calls) => {
    const report = await calculateAttendanceReports({
      employees: values.employees ?? [makeEmployee(employeeId1)],
      fromDate: values.fromDate,
      toDate: values.toDate,
      asOf: values.asOf ?? asOf,
    });
    await callback(report, calls);
  });

test("weekly inclusive date range includes Sunday and all seven calendar days", async () => {
  await calculate(
    {
      fromDate: "2025-01-06",
      toDate: "2025-01-12",
      asOf: new Date("2025-01-13T00:00:00.000Z"),
    },
    {},
    (report) => {
      const { summary, dailyDetails } = report.employees[0];
      assert.equal(summary.eligibleWorkingDays, 7);
      assert.deepEqual(
        dailyDetails.map(({ attendanceDate }) => attendanceDate),
        [
          "2025-01-06",
          "2025-01-07",
          "2025-01-08",
          "2025-01-09",
          "2025-01-10",
          "2025-01-11",
          "2025-01-12",
        ],
      );
      assert.equal(dailyDetails.at(-1).attendanceDate, "2025-01-12");
    },
  );
});

test("month/year boundaries and leap day use date-only calendar iteration", async () => {
  await calculate(
    {
      fromDate: "2024-12-31",
      toDate: "2025-01-02",
      asOf: new Date("2025-01-03T00:00:00.000Z"),
    },
    {},
    (report) => {
      assert.deepEqual(
        report.employees[0].dailyDetails.map(({ attendanceDate }) => attendanceDate),
        ["2024-12-31", "2025-01-01", "2025-01-02"],
      );
    },
  );
  await calculate(
    {
      fromDate: "2024-02-28",
      toDate: "2024-03-01",
      asOf: new Date("2024-03-02T00:00:00.000Z"),
    },
    {},
    (report) => {
      assert.deepEqual(
        report.employees[0].dailyDetails.map(({ attendanceDate }) => attendanceDate),
        ["2024-02-28", "2024-02-29", "2024-03-01"],
      );
    },
  );
});

test("year 0001 dates are interpreted literally", async () => {
  await calculate(
    {
      employees: [
        makeEmployee(employeeId1, {
          joiningDate: new Date("0001-01-01T00:00:00.000Z"),
        }),
      ],
      fromDate: "0001-01-01",
      toDate: "0001-01-01",
      asOf: new Date("0001-01-02T00:00:00.000Z"),
    },
    {},
    (report) => {
      assert.equal(report.period.calculatedThroughDate, "0001-01-01");
      assert.equal(report.employees[0].summary.eligibleWorkingDays, 1);
      assert.deepEqual(
        report.employees[0].dailyDetails.map(({ attendanceDate }) => attendanceDate),
        ["0001-01-01"],
      );
    },
  );
});

test("Asia/Kolkata date keys preserve four-digit years below 0100", () => {
  assert.equal(
    toAsiaKolkataDateKey(new Date("0001-01-01T20:30:00.000Z")),
    "0001-01-02",
  );
  assert.equal(
    toAsiaKolkataDateKey(new Date("0099-12-31T18:29:59.999Z")),
    "0099-12-31",
  );
  assert.equal(
    toAsiaKolkataDateKey(new Date("0100-01-01T18:30:00.000Z")),
    "0100-01-02",
  );
});

test("inclusive report range crosses year 0099 into 0100 with correct keys", async () => {
  await calculate(
    {
      employees: [
        makeEmployee(employeeId1, {
          joiningDate: new Date("0099-12-31T00:00:00.000Z"),
        }),
      ],
      fromDate: "0099-12-31",
      toDate: "0100-01-01",
      asOf: new Date("0100-01-02T00:00:00.000Z"),
    },
    {},
    (report) => {
      assert.equal(report.employees[0].summary.eligibleWorkingDays, 2);
      assert.deepEqual(
        report.employees[0].dailyDetails.map(({ attendanceDate }) => attendanceDate),
        ["0099-12-31", "0100-01-01"],
      );
    },
  );
});

test("early-year asOf excludes later dates in the Asia/Kolkata business period", async () => {
  await calculate(
    {
      employees: [
        makeEmployee(employeeId1, {
          joiningDate: new Date("0001-01-01T00:00:00.000Z"),
        }),
      ],
      fromDate: "0001-01-01",
      toDate: "0001-01-03",
      asOf: new Date("0001-01-01T20:30:00.000Z"),
    },
    {},
    (report, calls) => {
      assert.equal(report.period.calculatedThroughDate, "0001-01-02");
      assert.equal(report.employees[0].summary.eligibleWorkingDays, 2);
      assert.deepEqual(
        report.employees[0].dailyDetails.map(({ attendanceDate }) => attendanceDate),
        ["0001-01-01", "0001-01-02"],
      );
      assert.equal(
        calls.find(({ modelName }) => modelName === "Attendance.find").filter
          .attendanceDate.$lte,
        "0001-01-02",
      );
    },
  );
});

test("holiday, employment boundaries, and inactive history determine eligibility", async () => {
  await calculate(
    {
      employees: [
        makeEmployee(employeeId1, {
          joiningDate: new Date("2025-01-02T00:00:00.000Z"),
          effectiveExitDate: new Date("2025-01-04T00:00:00.000Z"),
          status: "resigned",
        }),
      ],
      fromDate: "2025-01-01",
      toDate: "2025-01-05",
      asOf: new Date("2025-01-06T00:00:00.000Z"),
    },
    { holidays: [{ date: "2025-01-03" }] },
    (report) => {
      const employeeReport = report.employees[0];
      assert.equal(employeeReport.summary.eligibleWorkingDays, 2);
      assert.deepEqual(
        employeeReport.dailyDetails.map(({ attendanceDate }) => attendanceDate),
        ["2025-01-02", "2025-01-04"],
      );
      assert.equal(employeeReport.summary.notRecordedDays, 2);
    },
  );
});

test("on-leave employees remain eligible for historical working days", async () => {
  await calculate(
    {
      employees: [makeEmployee(employeeId1, { status: "on_leave" })],
      fromDate: "2025-01-04",
      toDate: "2025-01-04",
    },
    {},
    (report) => {
      assert.equal(report.employees[0].summary.eligibleWorkingDays, 1);
      assert.equal(report.employees[0].summary.notRecordedDays, 1);
      assert.deepEqual(
        report.employees[0].dailyDetails.map(({ attendanceDate }) => attendanceDate),
        ["2025-01-04"],
      );
    },
  );
});

test("missing records stay Not Recorded; only explicit overrides set Present or Absent", async () => {
  await calculate(
    {
      fromDate: "2025-01-04",
      toDate: "2025-01-06",
    },
    {
      attendance: [
        makeAttendance(employeeId1, "2025-01-05", {
          checkOutAt: null,
          checkOutSource: null,
        }),
        makeAttendance(employeeId1, "2025-01-04"),
      ],
      overrides: [
        {
          employeeId: employeeId1,
          attendanceDate: "2025-01-04",
          status: "absent",
        },
        {
          employeeId: employeeId1,
          attendanceDate: "2025-01-05",
          status: "present",
        },
      ],
    },
    (report) => {
      const { summary, dailyDetails } = report.employees[0];
      assert.equal(summary.absentDays, 1);
      assert.equal(summary.presentDays, 1);
      assert.equal(summary.incompleteDays, 0);
      assert.equal(summary.notRecordedDays, 1);
      assert.equal(dailyDetails[0].statusOrigin, "admin_override");
      assert.equal(dailyDetails[1].statusOrigin, "admin_override");
      assert.equal(dailyDetails[2].status, "not_recorded");
      assert.equal(dailyDetails[0].workedDurationMs, sixHours);
      assert.equal(dailyDetails[1].workedDurationMs, 20 * 60 * 60 * 1000);
    },
  );
});

test("authoritative six-hour rule distinguishes exact threshold from just below", async () => {
  await calculate(
    {
      fromDate: "2025-01-04",
      toDate: "2025-01-05",
    },
    {
      attendance: [
        makeAttendance(employeeId1, "2025-01-04", {
          checkOutAt: new Date(
            new Date("2025-01-04T03:00:00.000Z").getTime() + sixHours - 1,
          ),
        }),
        makeAttendance(employeeId1, "2025-01-05"),
      ],
    },
    (report) => {
      assert.equal(report.employees[0].dailyDetails[0].status, "incomplete");
      assert.equal(report.employees[0].dailyDetails[1].status, "present");
    },
  );
});

test("open duration is provisional; persisted system checkout is finalized", async () => {
  const openCheckIn = new Date("2025-01-04T03:00:00.000Z");
  const systemCheckIn = new Date("2025-01-04T00:00:00.000Z");
  const systemCheckOut = new Date(systemCheckIn.getTime() + 12 * 60 * 60 * 1000);
  await calculate(
    {
      employees: [makeEmployee(employeeId1), makeEmployee(employeeId2)],
      fromDate: "2025-01-04",
      toDate: "2025-01-05",
      asOf: new Date("2025-01-05T03:00:00.000Z"),
    },
    {
      attendance: [
        makeAttendance(employeeId1, "2025-01-04", {
          checkInAt: openCheckIn,
          checkOutAt: null,
          checkOutSource: null,
        }),
        makeAttendance(employeeId2, "2025-01-04", {
          checkInAt: systemCheckIn,
          checkOutAt: systemCheckOut,
          checkOutSource: "system",
          checkOutRecordedBy: null,
        }),
      ],
    },
    (report) => {
      const { summary, dailyDetails } = report.employees[0];
      const systemReport = report.employees[1];
      assert.equal(dailyDetails[0].checkoutState, "not_checked_out");
      assert.equal(dailyDetails[0].checkOutAt, null);
      assert.equal(dailyDetails[0].durationIsProvisional, true);
      assert.equal(dailyDetails[0].workedDurationMs, 24 * 60 * 60 * 1000);
      assert.equal(systemReport.dailyDetails[0].checkOutAt, systemCheckOut);
      assert.equal(systemReport.dailyDetails[0].checkOutSource, "system");
      assert.equal(systemReport.dailyDetails[0].attendanceDate, "2025-01-04");
      assert.equal(systemReport.dailyDetails[0].durationIsProvisional, false);
      assert.equal(summary.provisionalWorkedDurationMs, 24 * 60 * 60 * 1000);
      assert.equal(summary.finalizedWorkedDurationMs, 0);
      assert.equal(systemReport.summary.finalizedWorkedDurationMs, 12 * 60 * 60 * 1000);
      assert.equal(
        summary.workedDurationMs + systemReport.summary.workedDurationMs,
        summary.provisionalWorkedDurationMs +
          systemReport.summary.finalizedWorkedDurationMs,
      );
    },
  );
});

test("system checkout with a human recorder is rejected", async () => {
  await withModelMocks(
    {
      attendance: [
        makeAttendance(employeeId1, "2025-01-04", {
          checkOutSource: "system",
          checkOutRecordedBy: "64b000000000000000000099",
        }),
      ],
    },
    async () => {
      await assert.rejects(
        calculateAttendanceReports({
          employees: [makeEmployee(employeeId1)],
          fromDate: "2025-01-04",
          toDate: "2025-01-04",
          asOf,
        }),
        /System attendance checkout cannot have a human recorder/,
      );
    },
  );
});

test("future dates after Asia/Kolkata asOf business date are excluded", async () => {
  await calculate(
    {
      fromDate: "2025-01-01",
      toDate: "2025-01-03",
      asOf: new Date("2025-01-02T18:29:59.999Z"),
    },
    {
      attendance: [makeAttendance(employeeId1, "2025-01-03")],
      overrides: [
        {
          employeeId: employeeId1,
          attendanceDate: "2025-01-03",
          status: "absent",
        },
      ],
    },
    (report, calls) => {
      const { summary, dailyDetails } = report.employees[0];
      assert.equal(report.period.calculatedThroughDate, "2025-01-02");
      assert.equal(summary.eligibleWorkingDays, 2);
      assert.equal(summary.absentDays, 0);
      assert.equal(summary.notRecordedDays, 2);
      assert.deepEqual(
        dailyDetails.map(({ attendanceDate }) => attendanceDate),
        ["2025-01-01", "2025-01-02"],
      );
      assert.equal(
        calls.find(({ modelName }) => modelName === "Attendance.find").filter
          .attendanceDate.$lte,
        "2025-01-02",
      );
    },
  );
});

test("percentage rounds to two decimals and zero eligible days returns null", async () => {
  await calculate(
    {
      fromDate: "2025-01-03",
      toDate: "2025-01-05",
    },
    {
      attendance: [makeAttendance(employeeId1, "2025-01-03")],
    },
    (report) => {
      assert.equal(
        report.employees[0].summary.attendancePercentage,
        33.33,
      );
    },
  );
  await calculate(
    {
      fromDate: "2025-01-06",
      toDate: "2025-01-06",
      asOf: new Date("2025-01-05T12:00:00.000Z"),
    },
    {},
    (report) => {
      assert.equal(report.employees[0].summary.eligibleWorkingDays, 0);
      assert.equal(report.employees[0].summary.attendancePercentage, null);
      assert.deepEqual(report.employees[0].dailyDetails, []);
      assert.equal(report.period.calculatedThroughDate, null);
    },
  );
});

test("multi-employee and individual paths share calculations with three bounded queries", async () => {
  const employees = [
    makeEmployee(employeeId1),
    makeEmployee(employeeId2, { status: "inactive" }),
  ];
  const mocks = {
    attendance: [makeAttendance(employeeId1, "2025-01-04")],
    overrides: [
      {
        employeeId: employeeId2,
        attendanceDate: "2025-01-04",
        status: "absent",
      },
    ],
  };
  let multiReport;
  await calculate(
    { employees, fromDate: "2025-01-04", toDate: "2025-01-05" },
    mocks,
    (report, calls) => {
      multiReport = report;
      assert.equal(calls.length, 3);
      assert.deepEqual(
        calls.map(({ modelName }) => modelName),
        [
          "PublicHoliday.find",
          "Attendance.find",
          "AttendanceStatusOverride.find",
        ],
      );
      assert.equal(
        calls.find(({ modelName }) => modelName === "Attendance.find").filter
          .employeeId.$in.length,
        2,
      );
      assert.equal(
        calls.find(({ modelName }) => modelName === "AttendanceStatusOverride.find")
          .filter.employeeId.$in.length,
        2,
      );
    },
  );
  await calculate(
    {
      employees: [employees[0]],
      fromDate: "2025-01-04",
      toDate: "2025-01-05",
    },
    mocks,
    (report) => {
      assert.deepEqual(report.employees[0], multiReport.employees[0]);
    },
  );
});

test("employee IDs are normalized to MongoDB ObjectId casing", async () => {
  await calculate(
    {
      employees: [makeEmployee(employeeId1.toUpperCase())],
      fromDate: "2025-01-04",
      toDate: "2025-01-04",
    },
    { attendance: [makeAttendance(employeeId1, "2025-01-04")] },
    (report, calls) => {
      assert.equal(report.employees[0].employeeId, employeeId1);
      assert.deepEqual(
        calls.find(({ modelName }) => modelName === "Attendance.find").filter
          .employeeId.$in,
        [employeeId1],
      );
    },
  );
});

test("database query failures propagate to the caller", async () => {
  const queryError = new Error("attendance query failed");
  await withModelMocks(
    { attendanceQueryError: queryError },
    async () => {
      await assert.rejects(
        calculateAttendanceReports({
          employees: [makeEmployee(employeeId1)],
          fromDate: "2025-01-04",
          toDate: "2025-01-04",
          asOf,
        }),
        (error) => error === queryError,
      );
    },
  );
});

test("export report queries use the remaining deadline and surface slow-query timeouts", async () => {
  const queryError = Object.assign(new Error("execution expired"), { code: 50 });
  await withModelMocks(
    { attendanceQueryError: queryError },
    async (calls) => {
      await assert.rejects(
        calculateAttendanceReports({
          employees: [makeEmployee(employeeId1)],
          fromDate: "2025-01-04",
          toDate: "2025-01-04",
          asOf,
          deadline: Date.now() + 10_000,
        }),
        {
          statusCode: 504,
          message: "Attendance report database query exceeded its time limit",
        },
      );
      const queryCalls = calls.queryTimeouts;
      assert.equal(queryCalls.length, 3);
      assert.ok(queryCalls.every(({ maxTimeMS }) => maxTimeMS > 0 && maxTimeMS <= 10_000));
    },
  );
});

test("report calculation rejects a query that returns after its export deadline", async () => {
  await withModelMocks(
    { attendanceQueryDelayMs: 30 },
    async () => {
      await assert.rejects(
        calculateAttendanceReports({
          employees: [makeEmployee(employeeId1)],
          fromDate: "2025-01-04",
          toDate: "2025-01-04",
          asOf,
          deadline: Date.now() + 5,
        }),
        {
          statusCode: 504,
          message: "Attendance export exceeded its time limit",
        },
      );
    },
  );
});

test("duplicate and invalid attendance, overrides, and holidays fail explicitly", async () => {
  const duplicateRecord = makeAttendance(employeeId1, "2025-01-04");
  await withModelMocks(
    {
      attendance: [duplicateRecord, { ...duplicateRecord }],
    },
    async () => {
      await assert.rejects(
        calculateAttendanceReports({
          employees: [makeEmployee(employeeId1)],
          fromDate: "2025-01-04",
          toDate: "2025-01-04",
          asOf,
        }),
        /Duplicate attendance record/,
      );
    },
  );
  await withModelMocks(
    {
      overrides: [
        {
          employeeId: employeeId1,
          attendanceDate: "2025-01-04",
          status: "absent",
        },
        {
          employeeId: employeeId1,
          attendanceDate: "2025-01-04",
          status: "present",
        },
      ],
    },
    async () => {
      await assert.rejects(
        calculateAttendanceReports({
          employees: [makeEmployee(employeeId1)],
          fromDate: "2025-01-04",
          toDate: "2025-01-04",
          asOf,
        }),
        /Duplicate attendance override/,
      );
    },
  );
  await withModelMocks(
    {
      attendance: [
        makeAttendance(employeeId1, "2025-01-04", {
          checkInAt: new Date(Number.NaN),
        }),
      ],
    },
    async () => {
      await assert.rejects(
        calculateAttendanceReports({
          employees: [makeEmployee(employeeId1)],
          fromDate: "2025-01-04",
          toDate: "2025-01-04",
          asOf,
        }),
        /checkInAt must be a valid Date/,
      );
    },
  );
  await withModelMocks(
    {
      attendance: [
        makeAttendance(employeeId1, "2025-01-04", {
          checkOutSource: "unknown",
        }),
      ],
    },
    async () => {
      await assert.rejects(
        calculateAttendanceReports({
          employees: [makeEmployee(employeeId1)],
          fromDate: "2025-01-04",
          toDate: "2025-01-04",
          asOf,
        }),
        /checkOutSource is invalid/,
      );
    },
  );
  await withModelMocks(
    { holidays: [{ date: "2025-02-30" }] },
    async () => {
      await assert.rejects(
        calculateAttendanceReports({
          employees: [makeEmployee(employeeId1)],
          fromDate: "2025-02-28",
          toDate: "2025-03-01",
          asOf: new Date("2025-03-02T00:00:00.000Z"),
        }),
        /invalid date/,
      );
    },
  );
  await withModelMocks(
    {
      holidays: [
        { date: "2025-01-04" },
        { date: "2025-01-04" },
      ],
    },
    async () => {
      await assert.rejects(
        calculateAttendanceReports({
          employees: [makeEmployee(employeeId1)],
          fromDate: "2025-01-04",
          toDate: "2025-01-04",
          asOf,
        }),
        /Duplicate public holiday date/,
      );
    },
  );
});

test("invalid inputs and report ranges over 366 days are rejected", async () => {
  await assert.rejects(
    calculateAttendanceReports({
      employees: [],
      fromDate: "2025-02-30",
      toDate: "2025-03-01",
      asOf,
    }),
    /fromDate must be a valid/,
  );
  await assert.rejects(
    calculateAttendanceReports({
      employees: [],
      fromDate: "2025-01-02",
      toDate: "2025-01-01",
      asOf,
    }),
    /on or before/,
  );
  assert.equal(MAX_ATTENDANCE_REPORT_DAYS, 366);
  assert.equal(MAX_ATTENDANCE_REPORT_EMPLOYEES, 100);
  await assert.rejects(
    calculateAttendanceReports({
      employees: [],
      fromDate: "2024-01-01",
      toDate: "2025-01-01",
      asOf,
    }),
    /cannot exceed 366/,
  );
  await assert.rejects(
    calculateAttendanceReports({
      employees: Array.from(
        { length: MAX_ATTENDANCE_REPORT_EMPLOYEES + 1 },
        (_, index) =>
          makeEmployee((index + 1).toString(16).padStart(24, "0")),
      ),
      fromDate: "2025-01-01",
      toDate: "2025-01-01",
      asOf,
    }),
    /at most 100 employees/,
  );
});

test("shared resolver preserves existing enrichment output and supports recordless overrides", async () => {
  const record = makeAttendance(employeeId1, "2025-01-04", {
    _id: "64b000000000000000000003",
  });
  const resolved = resolveAttendanceStatus({
    record,
    override: null,
    asOf,
  });
  assert.deepEqual(resolved, {
    calculatedStatus: "present",
    workedDurationMs: sixHours,
    effectiveStatus: "present",
    statusOrigin: "recorded",
  });
  assert.deepEqual(
    resolveAttendanceStatus({
      record: null,
      override: { status: "absent" },
      asOf,
    }),
    {
      calculatedStatus: null,
      effectiveStatus: "absent",
      statusOrigin: "admin_override",
      workedDurationMs: null,
    },
  );

  const originalFindById = Attendance.findById;
  const originalFindOverrides = AttendanceStatusOverride.find;
  Attendance.findById = async () => record;
  AttendanceStatusOverride.find = () => ({
    select: async () => [],
  });
  try {
    const enriched = await getAttendanceRecord(
      record._id,
      { _id: employeeId1, userType: "admin" },
      asOf,
    );
    assert.equal(enriched.effectiveStatus, "present");
    assert.equal(enriched.statusOrigin, "recorded");
    assert.equal(enriched.workedDurationMs, sixHours);
    assert.equal(Object.hasOwn(enriched, "calculatedStatus"), false);
  } finally {
    Attendance.findById = originalFindById;
    AttendanceStatusOverride.find = originalFindOverrides;
  }
});
