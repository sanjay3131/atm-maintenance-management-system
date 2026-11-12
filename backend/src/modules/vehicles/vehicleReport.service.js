import ExcelJS from "exceljs";
import ApiError from "../../utils/ApiError.js";
import Employee from "../employees/employee.model.js";
import Vehicle from "./vehicle.model.js";
import VehicleDailyMileage from "./vehicleDailyMileage.model.js";
import VehicleUsageSession from "./vehicleUsageSession.model.js";

export const MAX_VEHICLE_REPORT_DAYS = 366;
export const MAX_VEHICLE_REPORT_ROWS = 20_000;
export const MAX_VEHICLE_REPORT_BYTES = 64 * 1024 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;

const utcDay = (dateKey) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.floor(date.getTime() / DAY_MS);
};

const validateReportWindow = ({ fromDate, toDate }) => {
  if (fromDate > toDate)
    throw new ApiError(400, "fromDate must be on or before toDate");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (toDate > today)
    throw new ApiError(400, "Report dates cannot be in the future");
  if (utcDay(toDate) - utcDay(fromDate) + 1 > MAX_VEHICLE_REPORT_DAYS) {
    throw new ApiError(
      400,
      `Report range cannot exceed ${MAX_VEHICLE_REPORT_DAYS} days`,
    );
  }
};

const buildGroups = (rows, reportType) => {
  const groups = new Map();
  for (const row of rows) {
    const key =
      reportType === "vehicle" ? row.vehicleId : row.employeeId;
    const current = groups.get(key) ?? {
      key,
      label:
        reportType === "vehicle"
          ? row.vehicle
          : row.employee,
      code: reportType === "employee" ? row.employeeCode : "",
      distanceKm: 0,
      recordCount: 0,
    };
    current.distanceKm += row.distance;
    current.recordCount += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort(
    (left, right) =>
      left.label.localeCompare(right.label) ||
      left.key.localeCompare(right.key),
  );
};

const escapeSpreadsheetText = (value) => {
  const text = String(value ?? "");
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
};

export const createVehicleMileageWorkbook = async ({
  reportType,
  fromDate,
  toDate,
  vehicleId,
  employeeId,
}) => {
  if (!new Set(["vehicle", "employee"]).has(reportType)) {
    throw new ApiError(400, "Unsupported vehicle report type");
  }
  validateReportWindow({ fromDate, toDate });
  if (vehicleId && !(await Vehicle.exists({ _id: vehicleId }))) {
    throw new ApiError(404, "Vehicle not found");
  }
  if (employeeId && !(await Employee.exists({ _id: employeeId }))) {
    throw new ApiError(404, "Employee not found");
  }
  const sessionFilter = {
    status: "COMPLETED",
    businessDate: { $gte: fromDate, $lte: toDate },
    ...(vehicleId ? { vehicleId } : {}),
    ...(employeeId ? { employeeId } : {}),
  };
  const dailyFilter = {
    status: "CLOSED",
    businessDate: { $gte: fromDate, $lte: toDate },
    ...(vehicleId ? { vehicleId } : {}),
    ...(employeeId
      ? { "segments.employeeId": employeeId }
      : {}),
  };
  const [sessions, dailyRecords] = await Promise.all([
    VehicleUsageSession.find(sessionFilter)
      .select(
        "vehicleId employeeId vehicleRegistrationSnapshot employeeNameSnapshot employeeCodeSnapshot businessDate startOdometerKm endOdometerKm distanceKm startedAt _id",
      )
      .sort({
        businessDate: 1,
        vehicleId: 1,
        employeeId: 1,
        startedAt: 1,
        _id: 1,
      })
      .limit(MAX_VEHICLE_REPORT_ROWS + 1)
      .lean(),
    VehicleDailyMileage.find(dailyFilter)
      .select(
        "vehicleId vehicleRegistrationSnapshot businessDate startOdometerKm endOdometerKm dailyDistanceKm segments timelineReviewRequired",
      )
      .sort({ businessDate: 1, vehicleId: 1, _id: 1 })
      .limit(MAX_VEHICLE_REPORT_ROWS + 1)
      .lean(),
  ]);
  if (
    sessions.length > MAX_VEHICLE_REPORT_ROWS ||
    dailyRecords.length > MAX_VEHICLE_REPORT_ROWS
  ) {
    throw new ApiError(
      413,
      `Vehicle export cannot exceed ${MAX_VEHICLE_REPORT_ROWS} source records`,
    );
  }
  const rows = sessions.map((session) => ({
    source: "Legacy session",
    vehicleId: String(session.vehicleId),
    employeeId: String(session.employeeId),
    vehicle: session.vehicleRegistrationSnapshot,
    employee: session.employeeNameSnapshot,
    employeeCode: session.employeeCodeSnapshot,
    date: session.businessDate,
    start: session.startOdometerKm,
    end: session.endOdometerKm,
    distance: session.distanceKm,
  }));
  for (const record of dailyRecords) {
    const segments = record.segments ?? [];
    if (reportType === "vehicle") {
      const users = new Map(
        segments.map((segment) => [
          String(segment.employeeId),
          {
            name: segment.employeeNameSnapshot,
            code: segment.employeeCodeSnapshot,
          },
        ]),
      );
      rows.push({
        source: record.timelineReviewRequired
          ? "Daily record (timeline review)"
          : "Daily record",
        vehicleId: String(record.vehicleId),
        employeeId: "",
        vehicle: record.vehicleRegistrationSnapshot,
        employee: [...users.values()].map((item) => item.name).join(", "),
        employeeCode: "",
        date: record.businessDate,
        start: record.startOdometerKm,
        end: record.endOdometerKm,
        distance: record.dailyDistanceKm,
      });
    } else {
      for (const segment of segments) {
        if (employeeId && String(segment.employeeId) !== String(employeeId)) {
          continue;
        }
        rows.push({
          source: record.timelineReviewRequired
            ? "Daily segment (timeline review)"
            : "Daily segment",
          vehicleId: String(record.vehicleId),
          employeeId: String(segment.employeeId),
          vehicle: record.vehicleRegistrationSnapshot,
          employee: segment.employeeNameSnapshot,
          employeeCode: segment.employeeCodeSnapshot,
          date: record.businessDate,
          start: segment.startOdometerKm,
          end: segment.endOdometerKm,
          distance: segment.distanceKm,
        });
      }
    }
  }
  if (rows.length > MAX_VEHICLE_REPORT_ROWS) {
    throw new ApiError(
      413,
      `Vehicle export cannot exceed ${MAX_VEHICLE_REPORT_ROWS} report rows`,
    );
  }
  rows.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.vehicle.localeCompare(right.vehicle) ||
      left.employee.localeCompare(right.employee) ||
      left.source.localeCompare(right.source),
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ATM Maintenance Management System";
  workbook.created = new Date();
  workbook.title =
    reportType === "vehicle"
      ? "Vehicle mileage report"
      : "Employee mileage report";
  const detailSheet = workbook.addWorksheet("Mileage history");
  const identityHeader =
    reportType === "vehicle" ? "Vehicle registration" : "Employee";
  detailSheet.columns = [
    { header: identityHeader, key: "identity", width: 26 },
    ...(reportType === "employee"
      ? [{ header: "Employee code", key: "employeeCode", width: 18 }]
      : []),
    { header: "Vehicle registration", key: "vehicle", width: 24 },
    { header: "Employee", key: "employee", width: 28 },
    { header: "Business date (Asia/Kolkata)", key: "date", width: 24 },
    { header: "Mileage record type", key: "source", width: 22 },
    { header: "Starting KM", key: "start", width: 16 },
    { header: "Ending KM", key: "end", width: 16 },
    { header: "Distance KM", key: "distance", width: 16 },
  ];
  detailSheet.getRow(1).font = { bold: true };

  if (rows.length === 0) {
    detailSheet.addRow(["No completed mileage records found for the selected filters."]);
  } else {
    for (const row of rows) {
      const identity =
        reportType === "vehicle"
          ? row.vehicle
          : row.employee;
      detailSheet.addRow({
        identity: escapeSpreadsheetText(identity),
        ...(reportType === "employee"
          ? {
              employeeCode: escapeSpreadsheetText(row.employeeCode),
            }
          : {}),
        vehicle: escapeSpreadsheetText(row.vehicle),
        employee: escapeSpreadsheetText(row.employee),
        date: row.date,
        source: row.source,
        start: row.start,
        end: row.end,
        distance: row.distance,
      });
    }
  }

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    {
      header: reportType === "vehicle" ? "Vehicle registration" : "Employee",
      key: "identity",
      width: 30,
    },
    ...(reportType === "employee"
      ? [{ header: "Employee code", key: "employeeCode", width: 18 }]
      : []),
    { header: "Mileage records / segments", key: "records", width: 28 },
    { header: "Total kilometres", key: "distance", width: 20 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  const groups = buildGroups(rows, reportType);
  for (const group of groups) {
    summarySheet.addRow({
      identity: escapeSpreadsheetText(group.label),
      ...(reportType === "employee"
        ? { employeeCode: escapeSpreadsheetText(group.code) }
        : {}),
      records: group.recordCount,
      distance: group.distanceKm,
    });
  }
  summarySheet.addRow({
    identity: "Complete filtered dataset total",
    ...(reportType === "employee" ? { employeeCode: "" } : {}),
    records: rows.length,
    distance: rows.reduce(
      (total, row) => total + row.distance,
      0,
    ),
  }).font = { bold: true };

  const information = workbook.addWorksheet("Report information");
  information.addRows([
    [
      "Report",
      reportType === "vehicle"
        ? "Vehicle-wise mileage"
        : "Employee-wise mileage",
    ],
    ["From date", fromDate],
    ["To date", toDate],
    ["Timezone", "Asia/Kolkata"],
    ["Mileage records / segments", rows.length],
  ]);
  information.columns = [{ width: 24 }, { width: 44 }];

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  if (buffer.byteLength > MAX_VEHICLE_REPORT_BYTES) {
    throw new ApiError(
      413,
      `Generated vehicle export exceeds ${MAX_VEHICLE_REPORT_BYTES} bytes`,
    );
  }
  return {
    buffer,
    filename: `${reportType}-mileage-${fromDate}-to-${toDate}.xlsx`,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    totalSessions: sessions.length,
    totalRecords: rows.length,
  };
};
