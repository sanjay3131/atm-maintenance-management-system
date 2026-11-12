import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import test from "node:test";
import Vehicle from "../src/modules/vehicles/vehicle.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import VehicleUsageSession from "../src/modules/vehicles/vehicleUsageSession.model.js";
import VehicleDailyMileage from "../src/modules/vehicles/vehicleDailyMileage.model.js";
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

const workbookOverrides = ({
  rows = records,
  dailyRecords = [],
} = {}) => [
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
  [
    VehicleDailyMileage,
    "find",
    () => ({
      select() {
        return this;
      },
      sort() {
        return this;
      },
      limit() {
        return this;
      },
      lean: async () => dailyRecords,
    }),
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

test("daily mileage is counted once by vehicle and segmented by employee", async () => {
  const dailyRecord = {
    _id: "daily-1",
    vehicleId: "vehicle-a",
    vehicleRegistrationSnapshot: "TN45AB1234",
    businessDate: "2026-01-04",
    startOdometerKm: 1055,
    endOdometerKm: 1105,
    dailyDistanceKm: 50,
    segments: [
      {
        employeeId: "employee-a",
        employeeNameSnapshot: "Ravi Kumar",
        employeeCodeSnapshot: "EMP-001",
        startOdometerKm: 1055,
        endOdometerKm: 1085,
        distanceKm: 30,
      },
      {
        employeeId: "employee-b",
        employeeNameSnapshot: "Kumar Ravi",
        employeeCodeSnapshot: "EMP-002",
        startOdometerKm: 1085,
        endOdometerKm: 1105,
        distanceKm: 20,
      },
    ],
  };
  await withOverrides(
    workbookOverrides({ dailyRecords: [dailyRecord] }),
    async () => {
      const vehicleResult = await createVehicleMileageWorkbook({
        reportType: "vehicle",
        fromDate: "2026-01-01",
        toDate: "2026-01-31",
      });
      const vehicleWorkbook = new ExcelJS.Workbook();
      await vehicleWorkbook.xlsx.load(vehicleResult.buffer);
      assert.equal(
        vehicleWorkbook.getWorksheet("Summary").getRow(2).getCell(3).value,
        105,
      );
      assert.equal(
        vehicleWorkbook.getWorksheet("Summary").getRow(3).getCell(3).value,
        105,
      );
    },
  );
  await withOverrides(
    workbookOverrides({ rows: [], dailyRecords: [dailyRecord] }),
    async () => {
      const employeeResult = await createVehicleMileageWorkbook({
        reportType: "employee",
        employeeId: "employee-a",
        fromDate: "2026-01-01",
        toDate: "2026-01-31",
      });
      const employeeWorkbook = new ExcelJS.Workbook();
      await employeeWorkbook.xlsx.load(employeeResult.buffer);
      assert.equal(
        employeeWorkbook.getWorksheet("Summary").getRow(2).getCell(4).value,
        30,
      );
    },
  );
});

test("empty report returns a valid workbook with a no-records indication", async () => {
  await withOverrides(workbookOverrides({ rows: [] }), async () => {
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
      /No completed mileage records/,
    );
    assert.equal(
      workbook.getWorksheet("Summary").getRow(2).getCell(4).value,
      0,
    );
  });
});

test("report range and row count limits are enforced before workbook generation", async () => {
  await withOverrides(
    workbookOverrides({
      rows: Array.from({ length: MAX_VEHICLE_REPORT_ROWS + 1 }, (_, index) => ({
        ...records[0],
        _id: `session-${index}`,
        businessDate: "2026-01-01",
      })),
    }),
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
