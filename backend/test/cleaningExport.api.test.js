import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildCurrentMonitoringRows,
  buildScheduledJobsPipeline,
  getMonitoringPlanIdsForStatus,
} from "../src/modules/cleaningRecords/cleaningExport.service.js";
import {
  cleaningExportSpreadsheetText,
  writeRecurringCleaningWorkbook,
} from "../src/modules/cleaningRecords/cleaningExport.excel.js";
import { cleaningExportQuerySchema } from "../src/modules/cleaningRecords/cleaningExport.validation.js";
import jobsRouter from "../src/modules/jobs/jobs.routes.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";

const PLAN_ID = "64b000000000000000000101";
const OTHER_PLAN_ID = "64b000000000000000000102";
const EMPLOYEE_ID = "64b000000000000000000103";
const USER_ID = "64b000000000000000000104";

const getColumn = (worksheet, header) => {
  const headers = worksheet.getRow(1).values;
  const column = headers.findIndex((value) => value === header);
  assert.notEqual(column, -1, `Missing column "${header}"`);
  return column;
};

test("cleaning export query validates calendar dates, filters, and range bounds", () => {
  const base = {
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
  };
  assert.equal(cleaningExportQuerySchema.safeParse(base).success, true);
  assert.equal(
    cleaningExportQuerySchema.safeParse({
      ...base,
      fromDate: "2026-02-30",
    }).success,
    false,
  );
  assert.equal(
    cleaningExportQuerySchema.safeParse({
      ...base,
      toDate: "2026-02-28",
    }).success,
    false,
  );
  assert.equal(
    cleaningExportQuerySchema.safeParse({
      ...base,
      toDate: "2027-03-02",
    }).success,
    false,
  );
  assert.equal(
    cleaningExportQuerySchema.safeParse({
      ...base,
      employeeId: "not-an-object-id",
    }).success,
    false,
  );
  assert.equal(
    cleaningExportQuerySchema.safeParse({
      ...base,
      monitoringStatus: "UNKNOWN",
    }).success,
    false,
  );
});

test("export route requires authentication and admin or superAdmin role", () => {
  const route = jobsRouter.stack.find(
    (layer) =>
      layer.route?.path === "/recurring/cleaning-export.xlsx" &&
      layer.route.methods.get,
  )?.route;

  assert.ok(route);
  assert.equal(route.stack[0].handle, verifyAccessToken);
  const roleGate = route.stack[1].handle;
  for (const role of ["admin", "superAdmin"]) {
    let authorized = false;
    roleGate({ user: { userType: role } }, {}, () => {
      authorized = true;
    });
    assert.equal(authorized, true);
  }
  assert.throws(
    () => roleGate({ user: { userType: "employee" } }, {}, () => {}),
    { statusCode: 403 },
  );
});

test("scheduled job pipeline uses Asia/Kolkata boundaries and either employee assignment", () => {
  const pipeline = buildScheduledJobsPipeline({
    filters: {
      fromDate: "2026-03-08",
      toDate: "2026-03-08",
      employeeId: EMPLOYEE_ID,
      bankId: OTHER_PLAN_ID,
      monitoringStatus: "RED",
    },
    employeeUserId: USER_ID,
    monitoringPlanIds: [PLAN_ID],
  });

  const initialMatch = pipeline[0].$match;
  assert.equal(
    initialMatch["recurringMaintenance.scheduledDate"].$gte.toISOString(),
    "2026-03-07T18:30:00.000Z",
  );
  assert.equal(
    initialMatch["recurringMaintenance.scheduledDate"].$lt.toISOString(),
    "2026-03-08T18:30:00.000Z",
  );
  const employeeMatch = pipeline.find((stage) => stage.$match?.$or)?.$match.$or;
  assert.ok(employeeMatch);
  assert.equal(String(employeeMatch[0]["recurringPlan.assignedEmployeeId"]), EMPLOYEE_ID);
  assert.equal(String(employeeMatch[1].assignedEmployeeId), USER_ID);
  assert.deepEqual(
    pipeline.find(
      (stage) => stage.$match?.["recurringMaintenance.planId"]?.$in,
    ).$match["recurringMaintenance.planId"].$in.map(String),
    [PLAN_ID],
  );
  assert.equal(
    pipeline.some((stage) => stage.$match?._exportBankId),
    true,
  );
});

test("monitoring status filter returns only plans with that current status", () => {
  const rows = getMonitoringPlanIdsForStatus(
    [
      { planId: PLAN_ID, status: "RED" },
      { planId: OTHER_PLAN_ID, status: "GREEN" },
    ],
    "RED",
  );
  assert.deepEqual(rows.map(String), [PLAN_ID]);
});

test("current monitoring keeps active no-history plans and excludes inactive plans", () => {
  const rows = buildCurrentMonitoringRows({
    records: [
      {
        planId: PLAN_ID,
        maintenanceType: "DAILY_CLEANING",
        status: "NO_HISTORY",
        latestCleaningDate: null,
        ageInCalendarDays: null,
      },
      {
        planId: OTHER_PLAN_ID,
        maintenanceType: "DAILY_CLEANING",
        status: "GREEN",
      },
    ],
    plans: [
      {
        _id: PLAN_ID,
        isActive: true,
        maintenanceType: "DAILY_CLEANING",
        atmId: { atmId: "ATM-001" },
      },
      {
        _id: OTHER_PLAN_ID,
        isActive: false,
        maintenanceType: "DAILY_CLEANING",
        atmId: { atmId: "ATM-002" },
      },
    ],
    filters: {},
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "NO_HISTORY");
  assert.equal(rows[0].atm.atmId, "ATM-001");
});

test("streamed workbook distinguishes missing, valid, and void records and escapes formulas", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cleaning-export-test-"));
  const outputPath = join(directory, "export.xlsx");
  const generatedAt = new Date("2026-03-09T06:00:00.000Z");
  const scheduledJobs = [
    {
      status: "PENDING",
      recurringMaintenance: {
        planId: PLAN_ID,
        maintenanceType: "DAILY_CLEANING",
        scheduledDate: new Date("2026-03-08T18:30:00.000Z"),
      },
      recurringPlan: { _id: PLAN_ID, isActive: true },
      currentATM: { atmId: "ATM-001", locationName: "Central", address: "1 Main Rd" },
      currentBank: { bankName: "Current Bank" },
      cleaningRecord: null,
    },
    {
      status: "COMPLETED",
      recurringMaintenance: {
        planId: PLAN_ID,
        maintenanceType: "DAILY_CLEANING",
        scheduledDate: new Date("2026-03-08T18:30:00.000Z"),
      },
      recurringPlan: { _id: PLAN_ID, isActive: true },
      currentATM: { atmId: "ATM-001", locationName: "Central", address: "1 Main Rd" },
      cleaningRecord: {
        validityStatus: "VALID",
        cleaningDate: "2026-03-09",
        actualCleanerType: "INTERNAL",
        remarks: "=HYPERLINK(\"https://example.invalid\")",
      },
    },
    {
      status: "REJECTED",
      recurringMaintenance: {
        planId: PLAN_ID,
        maintenanceType: "DAILY_CLEANING",
        scheduledDate: new Date("2026-03-08T18:30:00.000Z"),
      },
      recurringPlan: { _id: PLAN_ID, isActive: true },
      currentATM: { atmId: "ATM-001", locationName: "Central", address: "1 Main Rd" },
      cleaningRecord: {
        validityStatus: "VOID",
        cleaningDate: "2026-03-09",
        actualCleanerType: "OUTSOURCED",
        outsourcedCleanerName: "Cleaner",
        remarks: "Corrected",
      },
    },
  ];
  const monitoringRows = [
    {
      planId: PLAN_ID,
      maintenanceType: "DAILY_CLEANING",
      status: "NO_HISTORY",
      latestCleaningDate: null,
      ageInCalendarDays: null,
      monitoringActivatedAt: "2026-03-01T00:00:00.000Z",
      responsibleEmployee: null,
      atm: {
        atmId: "ATM-002",
        locationName: "North",
        address: "2 North Rd",
        bankId: { bankName: "Bank" },
        regionId: { name: "North" },
        districtId: { districtName: "Central" },
      },
    },
  ];

  try {
    await writeRecurringCleaningWorkbook({
      scheduledJobs,
      monitoringRows,
      outputPath,
      generatedAt,
      deadline: Date.now() + 10_000,
      maxBytes: 1024 * 1024,
      maxRows: 100,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
      "Scheduled Jobs",
      "Current Monitoring",
    ]);

    const scheduled = workbook.getWorksheet("Scheduled Jobs");
    const validityColumn = getColumn(scheduled, "CleaningRecord validity");
    const statusColumn = getColumn(scheduled, "Job status");
    const remarksColumn = getColumn(scheduled, "Remarks");
    assert.equal(scheduled.getRow(2).getCell(validityColumn).value, "NO_RECORD");
    assert.equal(scheduled.getRow(2).getCell(statusColumn).value, "PENDING");
    assert.equal(scheduled.getRow(3).getCell(validityColumn).value, "VALID");
    assert.equal(scheduled.getRow(4).getCell(validityColumn).value, "VOID");
    assert.equal(
      scheduled.getRow(3).getCell(remarksColumn).value,
      "'=HYPERLINK(\"https://example.invalid\")",
    );

    const monitoring = workbook.getWorksheet("Current Monitoring");
    const monitoringStatusColumn = getColumn(monitoring, "Monitoring status");
    assert.equal(monitoring.rowCount, 2);
    assert.equal(
      monitoring.getRow(2).getCell(monitoringStatusColumn).value,
      "NO_HISTORY",
    );
    assert.equal(
      cleaningExportSpreadsheetText(" @SUM(A1:A2)"),
      "' @SUM(A1:A2)",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
