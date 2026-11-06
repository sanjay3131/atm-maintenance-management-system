import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import test from "node:test";
import Vehicle from "../src/modules/vehicles/vehicle.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import VehicleUsageSession from "../src/modules/vehicles/vehicleUsageSession.model.js";
import {
  createVehicleMileageWorkbook,
  MAX_VEHICLE_REPORT_ROWS,
} from "../src/modules/vehicles/vehicleReport.service.js";

const records = [
  {
    _id: "session-1",
    vehicleId: "vehicle-a",
    employeeId: "employee-a",
    vehicleRegistrationSnapshot: "TN45AB1234",
    employeeNameSnapshot: "Ravi Kumar",
    employeeCodeSnapshot: "EMP-001",
    businessDate: "2026-01-02",
    startOdometerKm: 1000,
    endOdometerKm: 1020,
    distanceKm: 20,
    startedAt: new Date("2026-01-02T03:00:00Z"),
    status: "COMPLETED",
  },
  {
    _id: "session-2",
    vehicleId: "vehicle-a",
    employeeId: "employee-b",
    vehicleRegistrationSnapshot: "TN45AB1234",
    employeeNameSnapshot: "Kumar Ravi",
    employeeCodeSnapshot: "EMP-002",
    businessDate: "2026-01-03",
    startOdometerKm: 1020,
    endOdometerKm: 1055,
    distanceKm: 35,
    startedAt: new Date("2026-01-03T03:00:00Z"),
    status: "COMPLETED",
  },
];

const withOverrides = async (overrides, run) => {
  const originals = overrides.map(([target, key]) => [
    target,
    key,
    target[key],
  ]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    return await run();
  } finally {
    for (const [target, key, value] of originals.reverse()) target[key] = value;
  }
};

const workbookOverrides = ({ rows = records, count = rows.length } = {}) => [
  [VehicleUsageSession, "countDocuments", async () => count],
  [
    VehicleUsageSession,
    "find",
    (filter) => {
      const result = rows.filter(
        (row) =>
          row.status === filter.status &&
          row.businessDate >= filter.businessDate.$gte &&
          row.businessDate <= filter.businessDate.$lte &&
          (!filter.vehicleId || row.vehicleId === filter.vehicleId) &&
          (!filter.employeeId || row.employeeId === filter.employeeId),
      );
      return {
        select() {
          return this;
        },
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        lean: async () => result,
      };
    },
  ],
  [Vehicle, "exists", async () => ({ _id: "vehicle-a" })],
  [Employee, "exists", async () => ({ _id: "employee-a" })],
];

test("vehicle workbook totals the complete filtered dataset and uses snapshots", async () => {
  await withOverrides(workbookOverrides(), async () => {
    const result = await createVehicleMileageWorkbook({
      reportType: "vehicle",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const detail = workbook.getWorksheet("Mileage history");
    const summary = workbook.getWorksheet("Summary");
    assert.equal(detail.getRow(2).getCell(1).value, "TN45AB1234");
    assert.equal(detail.getRow(3).getCell(3).value, "Kumar Ravi");
    assert.equal(summary.getRow(2).getCell(3).value, 55);
    assert.equal(summary.getRow(3).getCell(3).value, 55);
  });
});

test("empty report returns a valid workbook with a no-records indication", async () => {
  await withOverrides(workbookOverrides({ rows: [], count: 0 }), async () => {
    const result = await createVehicleMileageWorkbook({
      reportType: "employee",
      fromDate: "2026-01-01",
      toDate: "2026-01-01",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    assert.match(
      String(
        workbook.getWorksheet("Mileage history").getRow(2).getCell(1).value,
      ),
      /No completed mileage sessions/,
    );
    assert.equal(
      workbook.getWorksheet("Summary").getRow(2).getCell(4).value,
      0,
    );
  });
});

test("report range and row count limits are enforced before workbook generation", async () => {
  await withOverrides(
    workbookOverrides({ rows: [], count: MAX_VEHICLE_REPORT_ROWS + 1 }),
    async () => {
      await assert.rejects(
        createVehicleMileageWorkbook({
          reportType: "vehicle",
          fromDate: "2026-01-01",
          toDate: "2026-01-01",
        }),
        { statusCode: 413 },
      );
    },
  );
  await withOverrides(workbookOverrides(), async () => {
    await assert.rejects(
      createVehicleMileageWorkbook({
        reportType: "vehicle",
        fromDate: "2025-01-01",
        toDate: "2026-01-03",
      }),
      { statusCode: 400 },
    );
  });
});
