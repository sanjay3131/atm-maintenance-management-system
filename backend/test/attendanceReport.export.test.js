import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter, once } from "node:events";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import Attendance from "../src/modules/attendance/attendance.model.js";
import AttendanceStatusOverride from "../src/modules/attendance/attendanceStatusOverride.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import PublicHoliday from "../src/modules/holidays/publicHoliday.model.js";
import attendanceRouter from "../src/modules/attendance/attendance.routes.js";
import {
  exportAttendanceReportPdf,
  exportAttendanceReportXlsx,
} from "../src/modules/attendance/attendanceReport.controller.js";
import { createCompleteAttendanceReport } from "../src/modules/attendance/attendanceReport.api.service.js";
import {
  ABANDONED_EXPORT_DIRECTORY_MAX_AGE_MS,
  cleanupAbandonedAttendanceExportDirectories,
  generateAttendanceReportExport,
} from "../src/modules/attendance/attendanceReport.export.service.js";
import { writeAttendanceWorkbook } from "../src/modules/attendance/attendanceReport.excel.js";
import {
  assertAttendancePdfSpoolLimit,
  MAX_ATTENDANCE_PDF_SPOOL_BYTES,
  writeAttendancePdf,
} from "../src/modules/attendance/attendanceReport.pdf.js";
import { attendanceReportExportQuerySchema } from "../src/modules/attendance/attendanceReport.validation.js";
import {
  assertAttendanceExportActive,
  createAttendanceExportByteLimit,
  MAX_ATTENDANCE_EXPORT_BYTES,
  MAX_ATTENDANCE_REPORT_QUERY_MS,
  MAX_ATTENDANCE_EXPORT_DURATION_MS,
  MAX_CONCURRENT_ATTENDANCE_EXPORTS,
  withAttendanceExportSlot,
} from "../src/modules/attendance/attendanceExport.safety.js";
import { handleAttendanceReportError } from "../src/modules/attendance/attendanceReportError.middleware.js";
import ApiError from "../src/utils/ApiError.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";

const asOf = new Date("2024-06-05T12:34:56.000Z");
const scope = {
  fromDate: "2024-06-01",
  toDate: "2024-06-05",
  periodType: "custom",
  asOf: asOf.toISOString(),
};

const makeEmployee = (index) => ({
  _id: index.toString(16).padStart(24, "0"),
  employeeCode: `EMP-${String(index).padStart(4, "0")}`,
  joiningDate: new Date("2020-01-01T00:00:00.000Z"),
  effectiveExitDate: null,
  userId: { firstName: `Employee ${index}`, lastName: "Tester" },
});

const emptyRows = () => ({
  select() {
    return this;
  },
  maxTimeMS() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve([]).then(resolve, reject);
  },
});

const withReportModelMocks = async (employeeRows, callback) => {
  const originals = [
    [Employee, "find", Employee.find],
    [Employee, "countDocuments", Employee.countDocuments],
    [PublicHoliday, "find", PublicHoliday.find],
    [Attendance, "find", Attendance.find],
    [AttendanceStatusOverride, "find", AttendanceStatusOverride.find],
  ];
  const calls = {
    employeeFilters: [],
    employeeQueryMaxTimeMs: [],
    calculatorAsOf: [],
  };
  Employee.countDocuments = (filter) => ({
    maxTimeMS(maxTimeMS) {
      calls.employeeQueryMaxTimeMs.push(maxTimeMS);
      return Promise.resolve(
        filter._id
          ? employeeRows.filter(
              (employee) => employee._id === String(filter._id),
            ).length
          : employeeRows.length,
      );
    },
  });
  Employee.find = (filter) => {
    const query = {
      projection: "",
      sortOrder: 1,
      limitValue: Infinity,
      select(value) {
        this.projection = value;
        return this;
      },
      populate() {
        return this;
      },
      sort(value) {
        this.sortOrder = value._id;
        return this;
      },
      limit(value) {
        this.limitValue = value;
        return this;
      },
      maxTimeMS(maxTimeMS) {
        calls.employeeQueryMaxTimeMs.push(maxTimeMS);
        return this;
      },
      then(resolve, reject) {
        calls.employeeFilters.push(filter);
        const selected = employeeRows
          .filter((employee) => {
            if (filter._id && typeof filter._id !== "object") {
              return employee._id === String(filter._id);
            }
            if (filter._id?.$gt && employee._id <= String(filter._id.$gt)) {
              return false;
            }
            if (filter._id?.$lte && employee._id > String(filter._id.$lte)) {
              return false;
            }
            return true;
          })
          .sort((left, right) =>
            this.sortOrder < 0
              ? right._id.localeCompare(left._id)
              : left._id.localeCompare(right._id),
          )
          .slice(0, this.limitValue);
        return Promise.resolve(selected).then(resolve, reject);
      },
    };
    return query;
  };
  PublicHoliday.find = () => emptyRows();
  Attendance.find = (filter) => {
    calls.calculatorAsOf.push(filter);
    return emptyRows();
  };
  AttendanceStatusOverride.find = () => emptyRows();

  try {
    return await callback(calls);
  } finally {
    for (const [model, method, original] of originals.reverse()) {
      model[method] = original;
    }
  }
};

const makeDailyDetail = (attendanceDate, status = "present") => ({
  attendanceDate,
  status,
  calculatedStatus: status === "present" ? "present" : null,
  statusOrigin: status === "present" ? "recorded" : "no_record",
  checkInAt: status === "present" ? "2024-06-03T03:30:00.000Z" : null,
  checkOutAt: status === "present" ? "2024-06-03T12:30:00.000Z" : null,
  checkoutState: status === "present" ? "checked_out" : "no_record",
  checkOutSource: status === "present" ? "system" : null,
  workedDurationMs: status === "present" ? 9 * 60 * 60 * 1000 : null,
  durationIsProvisional: false,
});

const makeReportEmployee = ({
  employeeCode = "EMP-042",
  employeeName = "தமிழ் பெயர்",
  employeeId = "64b000000000000000000001",
  dailyDetails = [makeDailyDetail("2024-06-03")],
  summaryOverrides = {},
} = {}) => ({
  employeeId,
  employeeCode,
  employeeName,
  summary: {
    eligibleWorkingDays: dailyDetails.length,
    presentDays: dailyDetails.filter(({ status }) => status === "present")
      .length,
    incompleteDays: 0,
    absentDays: 0,
    notRecordedDays: dailyDetails.filter(
      ({ status }) => status === "not_recorded",
    ).length,
    attendancePercentage: dailyDetails.length ? 100 : null,
    workedDurationMs: 9 * 60 * 60 * 1000,
    finalizedWorkedDurationMs: 9 * 60 * 60 * 1000,
    provisionalWorkedDurationMs: 0,
    ...summaryOverrides,
  },
  dailyDetails,
});

const makeReportPlan = (employees, { employeeId = null } = {}) => ({
  asOf,
  employeeId,
  period: {
    fromDate: scope.fromDate,
    toDate: scope.toDate,
    calculatedThroughDate: scope.toDate,
  },
  totalEmployees: employees.length,
  async *batches() {
    for (let index = 0; index < employees.length; index += 100) {
      yield {
        asOf,
        period: this.period,
        employees: employees.slice(index, index + 100),
      };
    }
  },
});

const extractPdfPages = (outputPath) =>
  execFileSync("pdftotext", ["-layout", outputPath, "-"], {
    encoding: "utf8",
  })
    .split("\f")
    .filter((page) => page.trim());

const getPdfSectionPages = (pages, heading) =>
  pages.filter((page) =>
    new RegExp(`^[\\t ]*${heading}[\\t ]*$`, "m").test(page),
  );

const assertPdfRowContainsValuesInOrder = (pages, rowLabel, values) => {
  const lines = pages.flatMap((page) =>
    page.split(/\r?\n/).map((line) => line.replace(/\s+/gu, " ").trim()),
  );
  const rows = lines.filter((line) => line.startsWith(`${rowLabel} `));
  const row = rows.find((line) => {
    let searchFrom = 0;
    for (const value of values) {
      const position = line.indexOf(value, searchFrom);
      if (position === -1) return false;
      searchFrom = position + value.length;
    }
    return true;
  });
  assert.ok(
    row,
    `PDF row starting with ${rowLabel} contains ${values.join(" / ")} in column order; rows: ${rows.join(" | ")}`,
  );
  return row;
};

const invokeAttendanceReportErrorHandler = (error) => {
  let statusCode;
  let body;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
  handleAttendanceReportError(error, {}, response, () => {});
  return { statusCode, body };
};

test("attendance export timeout errors retain HTTP 504 and a safe message", () => {
  for (const message of [
    "Attendance export exceeded its time limit",
    "Attendance report database query exceeded its time limit",
  ]) {
    assert.deepEqual(
      invokeAttendanceReportErrorHandler(new ApiError(504, message)),
      {
        statusCode: 504,
        body: { success: false, message, errors: [] },
      },
    );
  }
});

test("unexpected attendance report errors remain sanitized and client errors are preserved", () => {
  const originalConsoleError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args);
  try {
    assert.deepEqual(
      invokeAttendanceReportErrorHandler(
        new Error("private database connection detail"),
      ),
      {
        statusCode: 500,
        body: {
          success: false,
          message: "Internal Server Error",
          errors: [],
        },
      },
    );
    assert.equal(loggedErrors.length, 1);
    assert.deepEqual(
      invokeAttendanceReportErrorHandler(
        new ApiError(504, "private unexpected gateway failure"),
      ),
      {
        statusCode: 500,
        body: {
          success: false,
          message: "Internal Server Error",
          errors: [],
        },
      },
    );
    assert.equal(loggedErrors.length, 2);
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(
    invokeAttendanceReportErrorHandler(
      new ApiError(400, "Validation failed", [
        { path: "fromDate", message: "Invalid date" },
      ]),
    ),
    {
      statusCode: 400,
      body: {
        success: false,
        message: "Validation failed",
        errors: [{ path: "fromDate", message: "Invalid date" }],
      },
    },
  );
  assert.deepEqual(
    invokeAttendanceReportErrorHandler(new ApiError(413, "Report too large")),
    {
      statusCode: 413,
      body: { success: false, message: "Report too large", errors: [] },
    },
  );
});

test("export query requires exact asOf, a supported period, and report-only filters", () => {
  assert.equal(
    attendanceReportExportQuerySchema.safeParse(scope).success,
    true,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      ...scope,
      fromDate: "2024-06-03",
      toDate: "2024-06-09",
      periodType: "week",
    }).success,
    true,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      ...scope,
      periodType: "week",
    }).success,
    false,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      ...scope,
      fromDate: "2024-06-01",
      toDate: "2024-06-30",
      periodType: "month",
    }).success,
    false,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      fromDate: "2024-06-01",
      toDate: "2024-06-05",
      periodType: "month",
      asOf: "2024-06-05T12:34:56.000Z",
    }).success,
    true,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      fromDate: "2024-06-01",
      toDate: "2024-06-30",
      periodType: "month",
      asOf: "2024-07-01T00:00:00.000Z",
    }).success,
    true,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      fromDate: "2024-06-02",
      toDate: "2024-06-05",
      periodType: "month",
      asOf: "2024-06-05T12:34:56.000Z",
    }).success,
    false,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      fromDate: "2024-06-01",
      toDate: "2024-06-04",
      periodType: "month",
      asOf: "2024-06-05T12:34:56.000Z",
    }).success,
    false,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      ...scope,
      fromDate: "2024-01-01",
      toDate: "2024-12-31",
      periodType: "year",
    }).success,
    false,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      fromDate: "2024-01-01",
      toDate: "2024-06-05",
      periodType: "year",
      asOf: "2024-06-05T12:34:56.000Z",
    }).success,
    true,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      fromDate: "2024-01-01",
      toDate: "2024-12-31",
      periodType: "year",
      asOf: "2025-01-01T00:00:00.000Z",
    }).success,
    true,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      fromDate: "2024-01-02",
      toDate: "2024-06-05",
      periodType: "year",
      asOf: "2024-06-05T12:34:56.000Z",
    }).success,
    false,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      fromDate: "2024-01-01",
      toDate: "2024-06-04",
      periodType: "year",
      asOf: "2024-06-05T12:34:56.000Z",
    }).success,
    false,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      ...scope,
      periodType: "daily",
    }).success,
    false,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      fromDate: scope.fromDate,
      toDate: scope.toDate,
      periodType: "custom",
    }).success,
    false,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      ...scope,
      page: "1",
    }).success,
    false,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      ...scope,
      toDate: "2025-06-02",
    }).success,
    false,
  );
  assert.equal(
    attendanceReportExportQuerySchema.safeParse({
      ...scope,
      asOf: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }).success,
    false,
  );
});

test("export routes require authentication and admin-level roles", () => {
  for (const [routePath, format] of [
    ["/admin/reports/export.xlsx", "xlsx"],
    ["/admin/reports/export.pdf", "pdf"],
  ]) {
    const route = attendanceRouter.stack.find(
      (layer) => layer.route?.path === routePath && layer.route.methods.get,
    )?.route;
    assert.ok(route, `${format} route is registered`);
    assert.equal(route.stack[0].handle, verifyAccessToken);
    const authorize = route.stack[1].handle;
    for (const userType of ["admin", "superAdmin"]) {
      let continued = false;
      authorize({ user: { userType } }, {}, () => {
        continued = true;
      });
      assert.equal(continued, true);
    }
    for (const userType of ["employee", "supervisor", "customer"]) {
      assert.throws(() => authorize({ user: { userType } }, {}, () => {}), {
        statusCode: 403,
      });
    }
  }
});

test("authorized export handlers stream complete private attachments, including empty reports", async () => {
  await withReportModelMocks([], async () => {
    for (const [format, handler, contentType] of [
      [
        "xlsx",
        exportAttendanceReportXlsx,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      ["pdf", exportAttendanceReportPdf, "application/pdf"],
    ]) {
      class TestResponse extends Writable {
        headers = {};
        chunks = [];
        headersSent = false;

        _write(chunk, _encoding, callback) {
          this.chunks.push(Buffer.from(chunk));
          callback();
        }

        setHeader(name, value) {
          this.headers[name.toLowerCase()] = value;
          this.headersSent = true;
        }

        setTimeout() {}
      }

      const request = new EventEmitter();
      request.user = { _id: "admin-1" };
      request.validatedQuery = attendanceReportExportQuerySchema.parse(scope);
      const response = new TestResponse();
      const finished = once(response, "finish");
      const requestFailed = new Promise((_, reject) => {
        handler(request, response, reject);
      });
      await Promise.race([finished, requestFailed]);

      const bytes = Buffer.concat(response.chunks);
      assert.equal(response.headers["content-type"], contentType);
      assert.match(
        response.headers["content-disposition"],
        new RegExp(
          `^attachment; filename="attendance-report-${scope.fromDate}\\.${format}"$`,
        ),
      );
      assert.equal(Number(response.headers["content-length"]), bytes.length);
      assert.equal(response.headers["cache-control"], "private, no-store");

      if (format === "xlsx") {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes);
        assert.deepEqual(
          workbook.worksheets.map(({ name }) => name),
          ["Summary", "Daily Details", "Report Information"],
        );
      } else {
        assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      }
    }
  });
});

test("complete report batches every filtered employee in stable order with one exact asOf", async () => {
  const employees = Array.from({ length: 205 }, (_, index) =>
    makeEmployee(index + 1),
  );
  await withReportModelMocks(employees, async (calls) => {
    const plan = await createCompleteAttendanceReport({
      ...scope,
      asOf,
    });
    const reports = [];
    for await (const batch of plan.batches()) reports.push(batch);
    assert.equal(plan.totalEmployees, 205);
    assert.equal(calls.employeeQueryMaxTimeMs.length, 5);
    assert.ok(
      calls.employeeQueryMaxTimeMs.every(
        (maxTimeMS) =>
          maxTimeMS > 0 && maxTimeMS <= MAX_ATTENDANCE_REPORT_QUERY_MS,
      ),
    );
    assert.deepEqual(
      reports.map(({ employees: batch }) => batch.length),
      [100, 100, 5],
    );
    assert.deepEqual(
      reports.flatMap(({ employees: batch }) =>
        batch.map(({ employeeId }) => employeeId),
      ),
      employees.map(({ _id }) => _id),
    );
    assert.ok(
      reports.every(
        ({ asOf: batchAsOf }) => batchAsOf.getTime() === asOf.getTime(),
      ),
    );
    assert.ok(calls.employeeFilters[1]._id.$lte);
    assert.equal(calls.employeeFilters.at(-1)._id.$gt, employees[199]._id);
  });
});

test("employee scan queries are capped by the remaining export deadline", async () => {
  const employees = [makeEmployee(1)];
  await withReportModelMocks(employees, async (calls) => {
    const deadline = Date.now() + 5_000;
    const plan = await createCompleteAttendanceReport({
      ...scope,
      asOf,
      deadline,
    });
    const batches = [];
    for await (const batch of plan.batches()) batches.push(batch);
    assert.equal(batches.length, 1);
    assert.equal(calls.employeeQueryMaxTimeMs.length, 3);
    assert.ok(
      calls.employeeQueryMaxTimeMs.every(
        (maxTimeMS) => maxTimeMS > 0 && maxTimeMS <= 5_000,
      ),
    );
  });
});

test("empty and employee-specific exports preserve the supplied cutoff and exact Employee ID", async () => {
  await withReportModelMocks([], async () => {
    const plan = await createCompleteAttendanceReport({
      ...scope,
      asOf,
    });
    assert.equal(plan.totalEmployees, 0);
    assert.equal(plan.asOf.getTime(), asOf.getTime());
    assert.equal(plan.period.calculatedThroughDate, scope.toDate);
    const batches = [];
    for await (const batch of plan.batches()) batches.push(batch);
    assert.deepEqual(batches, []);
  });

  const selected = makeEmployee(42);
  await withReportModelMocks([selected], async () => {
    const plan = await createCompleteAttendanceReport({
      ...scope,
      employeeId: selected._id,
      asOf,
    });
    assert.equal(plan.totalEmployees, 1);
    const [batch] = await (async () => {
      const values = [];
      for await (const value of plan.batches()) values.push(value);
      return values;
    })();
    assert.equal(batch.employees[0].employeeId, selected._id);
    assert.equal(batch.employees[0].employeeCode, selected.employeeCode);
    assert.equal(batch.employees[0].employeeName, "Employee 42 Tester");
  });
});

test("export rejects more than the employee cap and enforces cancellation deadlines", async () => {
  assert.equal(MAX_ATTENDANCE_EXPORT_DURATION_MS, 120_000);
  await withReportModelMocks(
    Array.from({ length: 1_001 }, (_, index) => makeEmployee(index + 1)),
    async () => {
      await assert.rejects(createCompleteAttendanceReport({ ...scope, asOf }), {
        statusCode: 413,
      });
    },
  );
  assert.throws(
    () => assertAttendanceExportActive({ deadline: Date.now() - 1 }),
    { statusCode: 504 },
  );
  assert.throws(
    () =>
      assertAttendanceExportActive({
        signal: AbortSignal.abort(),
        deadline: Date.now() + 1_000,
      }),
    { statusCode: 499 },
  );
});

test("stale export cleanup removes only old directories from exited export processes", async () => {
  const tempDirectory = await mkdtemp(
    path.join(os.tmpdir(), "attendance-export-cleanup-test-"),
  );
  const now = Date.now();
  const stale = path.join(
    tempDirectory,
    "atm-attendance-export-2000000000-stale",
  );
  const active = path.join(
    tempDirectory,
    `atm-attendance-export-${process.pid}-active`,
  );
  const recent = path.join(
    tempDirectory,
    "atm-attendance-export-2000000000-recent",
  );
  const unrelated = path.join(tempDirectory, "unrelated-export-old");
  try {
    await Promise.all(
      [stale, active, recent, unrelated].map((directory) => mkdir(directory)),
    );
    const oldTime = new Date(
      now - ABANDONED_EXPORT_DIRECTORY_MAX_AGE_MS - 1000,
    );
    await Promise.all(
      [stale, active, unrelated].map((directory) =>
        utimes(directory, oldTime, oldTime),
      ),
    );

    const removed = await cleanupAbandonedAttendanceExportDirectories({
      tempDirectory,
      now,
      logger: { warn() {} },
    });
    assert.equal(removed, 1);
    await assert.rejects(access(stale), { code: "ENOENT" });
    await Promise.all([access(active), access(recent), access(unrelated)]);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("Excel workbook contains all three worksheets, totals, complete rows and safe text", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "attendance-xlsx-test-"),
  );
  const outputPath = path.join(directory, "report.xlsx");
  try {
    const employees = [
      makeReportEmployee({
        employeeCode: "=1+1",
        employeeName: "@Formula",
        dailyDetails: [
          makeDailyDetail("2024-06-03"),
          makeDailyDetail("2024-06-04", "not_recorded"),
        ],
      }),
      makeReportEmployee({
        employeeCode: "EMP-043",
        employeeName: "Second Employee",
        employeeId: "64b000000000000000000002",
        dailyDetails: [],
      }),
    ];
    await writeAttendanceWorkbook({
      reportPlan: makeReportPlan(employees),
      periodType: "custom",
      outputPath,
      deadline: Date.now() + 30_000,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
    assert.deepEqual(
      workbook.worksheets.map(({ name }) => name),
      ["Summary", "Daily Details", "Report Information"],
    );
    const summary = workbook.getWorksheet("Summary");
    assert.equal(summary.getCell("A1").value, "Attendance report");
    assert.equal(summary.getCell("A8").value, "Employee code");
    assert.equal(summary.getCell("A9").value, "'=1+1");
    assert.equal(summary.getCell("B9").value, "'@Formula");
    assert.equal(summary.getCell("A11").value, "Total");
    assert.equal(summary.getCell("D11").value, 1);
    assert.equal(
      workbook.getWorksheet("Daily Details").getCell("A2").value,
      "'=1+1",
    );
    assert.equal(
      workbook.getWorksheet("Daily Details").getCell("H2").value,
      "present",
    );
    assert.equal(
      workbook.getWorksheet("Daily Details").getCell("H3").value,
      "not_recorded",
    );
    assert.equal(workbook.getWorksheet("Daily Details").rowCount, 3);
    assert.equal(
      workbook.getWorksheet("Report Information").getCell("B9").value,
      "Asia/Kolkata",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("empty Excel export remains readable and keeps unavailable percentage null", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "attendance-empty-xlsx-"),
  );
  const outputPath = path.join(directory, "empty.xlsx");
  try {
    await writeAttendanceWorkbook({
      reportPlan: makeReportPlan([]),
      periodType: "year",
      outputPath,
      deadline: Date.now() + 30_000,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
    assert.equal(workbook.worksheets.length, 3);
    assert.equal(workbook.getWorksheet("Summary").getCell("H9").value, null);
    assert.equal(workbook.getWorksheet("Summary").getCell("A9").value, "Total");
    assert.equal(workbook.getWorksheet("Daily Details").rowCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PDF embeds the Tamil font and paginates daily rows with repeated headers", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "attendance-pdf-test-"),
  );
  const outputPath = path.join(directory, "report.pdf");
  const spoolPath = path.join(directory, "report.jsonl");
  try {
    const dailyDetails = Array.from({ length: 65 }, (_, index) =>
      makeDailyDetail(`2024-06-${String((index % 28) + 1).padStart(2, "0")}`),
    );
    await writeAttendancePdf({
      reportPlan: makeReportPlan([
        makeReportEmployee({
          employeeName: "தமிழ் பெயர் — Long employee name for page wrapping",
          dailyDetails,
        }),
      ]),
      periodType: "custom",
      outputPath,
      spoolPath,
      deadline: Date.now() + 30_000,
    });
    const bytes = await readFile(outputPath);
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");

    try {
      const info = execFileSync("pdfinfo", [outputPath], { encoding: "utf8" });
      const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      assert.ok(pages > 1, "long attendance details span multiple pages");
      const pagesText = extractPdfPages(outputPath);
      const fonts = execFileSync("pdffonts", [outputPath], {
        encoding: "utf8",
      });
      assert.match(fonts, /NotoSansTamil-Regular/);
      assert.equal(pagesText.length, pages, "extracted pages match pdfinfo");

      const pageNumbers = pagesText.map((page, index) => {
        const matches = [...page.matchAll(/^[\t ]*Page (\d+)[\t ]*$/gmu)];
        assert.equal(
          matches.length,
          1,
          `PDF page ${index + 1} has exactly one footer page number`,
        );
        return Number(matches[0][1]);
      });
      assert.deepEqual(
        pageNumbers,
        Array.from({ length: pages }, (_, index) => index + 1),
        "footer numbers are sequential with no duplicates or gaps",
      );

      const summaryPages = getPdfSectionPages(pagesText, "Summary");
      const dailyPages = getPdfSectionPages(pagesText, "Daily Details");
      const informationPages = getPdfSectionPages(
        pagesText,
        "Report Information",
      );
      assert.equal(summaryPages.length, 1);
      assert.ok(dailyPages.length > 1, "daily records span multiple pages");
      assert.equal(informationPages.length, 1);

      for (const page of dailyPages) {
        for (const header of [
          "Employee code",
          "Employee name",
          "Attendance date",
          "Day",
          "Check-in (Asia/Kolkata)",
          "Check-out (Asia/Kolkata)",
          "Worked hours",
          "Status",
          "Status origin",
          "Checkout state",
          "Checkout source",
          "Duration",
        ]) {
          assert.ok(
            page.includes(header),
            `Daily Details page repeats the ${header} header`,
          );
        }
      }

      for (const header of [
        "Employee code",
        "Employee name",
        "Eligible days",
        "Present days",
        "Incomplete days",
        "Absent days",
        "Not recorded days",
        "Attendance %",
        "Worked hours",
        "Finalized hours",
        "Provisional hours",
      ]) {
        assert.ok(
          summaryPages[0].includes(header),
          `Summary contains the ${header} header`,
        );
      }
      assert.ok(
        informationPages[0].includes("Field") &&
          informationPages[0].includes("Value"),
        "Report Information contains its own table headers",
      );
      for (const field of [
        "Report",
        "Period type",
        "Start date",
        "End date",
        "As of",
        "As of business date",
        "Calculated through date",
        "Timezone",
        "Employee filter",
        "Employees",
        "Generated at",
        "Export format",
        "Consistency",
      ]) {
        assert.ok(
          informationPages[0].includes(field),
          `Report Information contains the ${field} field`,
        );
      }
      assert.match(
        pagesText.join("\n"),
        /[\u0B80-\u0BFF]/u,
        "the text extractor emits Tamil characters",
      );
      assert.equal(
        dailyPages.some((page) => page.includes("No reportable day")),
        false,
      );
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip(
          "pdfinfo and pdftotext are required for rendered PDF inspection",
        );
        return;
      }
      throw error;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PDF preserves Excel row values, totals, all metadata and empty employee details", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "attendance-pdf-parity-"),
  );
  const outputPath = path.join(directory, "report.pdf");
  const spoolPath = path.join(directory, "report.jsonl");
  const generatedAt = new Date("2024-06-06T08:09:10.000Z");
  const employeeId = "64b000000000000000000001";
  const openDetail = {
    ...makeDailyDetail("2024-06-04"),
    checkOutAt: null,
    checkoutState: "open",
    checkOutSource: null,
    workedDurationMs: 60 * 60 * 1000,
    durationIsProvisional: true,
  };
  const employee = makeReportEmployee({
    employeeCode: "EMP-042",
    employeeName: "Asha Patel",
    dailyDetails: [makeDailyDetail("2024-06-03"), openDetail],
    summaryOverrides: {
      eligibleWorkingDays: 5,
      presentDays: 3,
      incompleteDays: 1,
      absentDays: 1,
      notRecordedDays: 0,
      attendancePercentage: 60,
      workedDurationMs: 9 * 60 * 60 * 1000,
      finalizedWorkedDurationMs: 8 * 60 * 60 * 1000,
      provisionalWorkedDurationMs: 60 * 60 * 1000,
    },
  });
  const employeeWithoutDetails = makeReportEmployee({
    employeeCode: "EMP-EMPTY",
    employeeName: "SingleName",
    dailyDetails: [],
    summaryOverrides: {
      eligibleWorkingDays: 2,
      presentDays: 0,
      incompleteDays: 0,
      absentDays: 1,
      notRecordedDays: 1,
      attendancePercentage: 0,
      workedDurationMs: 3 * 60 * 60 * 1000,
      finalizedWorkedDurationMs: 2 * 60 * 60 * 1000,
      provisionalWorkedDurationMs: 60 * 60 * 1000,
    },
  });

  try {
    await writeAttendancePdf({
      reportPlan: makeReportPlan([employee, employeeWithoutDetails], {
        employeeId,
      }),
      periodType: "custom",
      outputPath,
      spoolPath,
      deadline: Date.now() + 30_000,
      generatedAt,
    });

    const pages = extractPdfPages(outputPath);
    const summaryPages = getPdfSectionPages(pages, "Summary");
    const dailyPages = getPdfSectionPages(pages, "Daily Details");
    const informationPages = getPdfSectionPages(pages, "Report Information");
    assert.equal(summaryPages.length, 1, "summary is identified separately");
    assert.equal(
      dailyPages.length,
      1,
      "daily details are identified separately",
    );
    assert.equal(
      informationPages.length,
      1,
      "report information is identified separately",
    );
    const expectedDate = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date("2024-06-03T12:00:00.000Z"));
    const expectedSecondDate = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date("2024-06-04T12:00:00.000Z"));
    const expectedCheckIn = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date("2024-06-03T03:30:00.000Z"));
    const expectedCheckOut = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date("2024-06-03T12:30:00.000Z"));

    for (const [label, value] of [
      ["Report", "Attendance report"],
      ["Period type", "custom"],
      ["Start date", scope.fromDate],
      ["End date", scope.toDate],
      ["As of", asOf.toISOString()],
      ["As of business date", "2024-06-05"],
      ["Calculated through date", scope.toDate],
      ["Timezone", "Asia/Kolkata"],
      ["Employee filter", employeeId],
      ["Employees", "2"],
      ["Generated at", generatedAt.toISOString()],
      ["Export format", "PDF"],
      [
        "Consistency",
        "Fixed asOf; records are not read from a database snapshot.",
      ],
    ]) {
      assertPdfRowContainsValuesInOrder(informationPages, label, [
        label,
        value,
      ]);
    }

    for (const header of [
      "Employee code",
      "Employee name",
      "Eligible days",
      "Present days",
      "Incomplete days",
      "Absent days",
      "Not recorded days",
      "Attendance %",
      "Worked hours",
      "Finalized hours",
      "Provisional hours",
    ]) {
      assert.ok(
        summaryPages[0].includes(header),
        `Summary contains the ${header} header`,
      );
    }
    assertPdfRowContainsValuesInOrder(summaryPages, "EMP-042", [
      "EMP-042",
      "Asha Patel",
      "5",
      "3",
      "1",
      "1",
      "0",
      "60.00",
      "9.00",
      "8.00",
      "1.00",
    ]);
    assertPdfRowContainsValuesInOrder(summaryPages, "EMP-EMPTY", [
      "EMP-EMPTY",
      "SingleName",
      "2",
      "0",
      "0",
      "1",
      "1",
      "0.00",
      "3.00",
      "2.00",
      "1.00",
    ]);
    assertPdfRowContainsValuesInOrder(summaryPages, "Total", [
      "Total",
      "2 employees",
      "7",
      "3",
      "1",
      "2",
      "1",
      "42.86",
      "12.00",
      "10.00",
      "2.00",
    ]);

    for (const header of [
      "Employee code",
      "Employee name",
      "Attendance date",
      "Day",
      "Check-in (Asia/Kolkata)",
      "Check-out (Asia/Kolkata)",
      "Worked hours",
      "Status",
      "Status origin",
      "Checkout state",
      "Checkout source",
      "Duration",
    ]) {
      assert.ok(
        dailyPages[0].includes(header),
        `Daily Details contains the ${header} header`,
      );
    }
    assert.equal(
      dailyPages.some((page) => page.includes("EMP-EMPTY")),
      false,
      "employee with no daily rows appears only in Summary",
    );
    assertPdfRowContainsValuesInOrder(dailyPages, "EMP-042", [
      "EMP-042",
      "Asha Patel",
      expectedDate,
      "Monday",
      expectedCheckIn,
      expectedCheckOut,
      "9.00",
      "present",
      "recorded",
      "checked_out",
      "system",
      "Finalized",
    ]);
    assertPdfRowContainsValuesInOrder(dailyPages, "EMP-042", [
      "EMP-042",
      "Asha Patel",
      expectedSecondDate,
      "Tuesday",
      expectedCheckIn,
      "1.00",
      "present",
      "recorded",
      "open",
      "Provisional",
    ]);

    const text = pages.join("\n");
    assert.match(
      text,
      /[\u0B80-\u0BFF]/u,
      "the text extractor emits Tamil characters, but does not preserve the exact name string",
    );
    assert.equal(
      dailyPages.some((page) => page.includes("No reportable day")),
      false,
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("pdftotext is required for rendered PDF value inspection");
      return;
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("empty PDF report keeps all three sections without synthetic detail rows", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "attendance-empty-pdf-"),
  );
  const outputPath = path.join(directory, "empty.pdf");
  const spoolPath = path.join(directory, "empty.jsonl");
  try {
    await writeAttendancePdf({
      reportPlan: makeReportPlan([]),
      periodType: "year",
      outputPath,
      spoolPath,
      deadline: Date.now() + 30_000,
    });
    const bytes = await readFile(outputPath);
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    try {
      const info = execFileSync("pdfinfo", [outputPath], { encoding: "utf8" });
      const pagesText = extractPdfPages(outputPath);
      const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      assert.equal(pageCount, 3, "the empty report has one page per section");
      assert.equal(pagesText.length, pageCount);
      assert.equal(getPdfSectionPages(pagesText, "Summary").length, 1);
      const dailyPages = getPdfSectionPages(pagesText, "Daily Details");
      const informationPages = getPdfSectionPages(
        pagesText,
        "Report Information",
      );
      assert.equal(dailyPages.length, 1);
      assert.equal(informationPages.length, 1);
      assert.ok(pagesText[0].includes("Total employees: 0"));
      assert.equal(
        dailyPages.some(
          (page) =>
            page.includes("No reportable day") ||
            /^[\t ]*EMP-[A-Z0-9-]+[\t ]/mu.test(page),
        ),
        false,
        "empty Daily Details contains no synthetic or employee attendance rows",
      );
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("pdfinfo and pdftotext are required for PDF inspection");
        return;
      }
      throw error;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PDF spool limit rejects bytes beyond the configured temporary-storage cap", () => {
  assert.equal(MAX_ATTENDANCE_PDF_SPOOL_BYTES, 128 * 1024 * 1024);
  assert.doesNotThrow(() =>
    assertAttendancePdfSpoolLimit(MAX_ATTENDANCE_PDF_SPOOL_BYTES),
  );
  assert.throws(
    () => assertAttendancePdfSpoolLimit(MAX_ATTENDANCE_PDF_SPOOL_BYTES + 1),
    (error) =>
      error.statusCode === 413 &&
      error.message.includes("128 MB temporary-storage limit"),
  );
});

test("PDF export service removes its temporary directory after writer failure", async () => {
  const tempDirectory = await mkdtemp(
    path.join(os.tmpdir(), "attendance-pdf-failure-cleanup-"),
  );
  const longNameEmployee = makeEmployee(1);
  longNameEmployee.userId.firstName = "Long ".repeat(10_000);

  try {
    await withReportModelMocks([longNameEmployee], async () => {
      await assert.rejects(
        generateAttendanceReportExport({
          format: "pdf",
          query: {
            fromDate: "2024-06-03",
            toDate: "2024-06-03",
            periodType: "custom",
            asOf,
          },
          tempDirectory,
        }),
        { statusCode: 422 },
      );
    });
    assert.deepEqual(await readdir(tempDirectory), []);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("export slots reject excess concurrency and release on operation failure", async () => {
  assert.equal(MAX_CONCURRENT_ATTENDANCE_EXPORTS, 1);
  let release;
  const active = withAttendanceExportSlot(
    "admin-1",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    withAttendanceExportSlot("admin-2", async () => {}),
    { statusCode: 429 },
  );
  release();
  await active;
  await assert.rejects(
    withAttendanceExportSlot("admin-1", async () => {
      throw new Error("test failure");
    }),
    /test failure/,
  );
  await withAttendanceExportSlot("admin-1", async () => "slot released");
});

test("export byte limit fails instead of producing a partial-success stream", async () => {
  assert.equal(MAX_ATTENDANCE_EXPORT_BYTES, 64 * 1024 * 1024);
  const limit = createAttendanceExportByteLimit(3);
  await assert.rejects(
    pipeline(
      Readable.from(["abc", "d"]),
      limit,
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    ),
    (error) =>
      error.statusCode === 413 &&
      error.message.includes("3 bytes output limit"),
  );
});

test("configured 64 MiB attendance PDF output limit rejects oversized streams", async () => {
  const limit = createAttendanceExportByteLimit(MAX_ATTENDANCE_EXPORT_BYTES);
  let emittedBytes = 0;
  const source = Readable.from(
    (async function* () {
      for (let chunk = 0; chunk < 65; chunk += 1) {
        yield Buffer.alloc(1024 * 1024);
      }
    })(),
  );
  await assert.rejects(
    pipeline(
      source,
      limit,
      new Writable({
        write(chunk, _encoding, callback) {
          emittedBytes += chunk.length;
          callback();
        },
      }),
    ),
    (error) =>
      error.statusCode === 413 && error.message.includes("64 MiB output limit"),
  );
  assert.equal(emittedBytes, MAX_ATTENDANCE_EXPORT_BYTES);
});
