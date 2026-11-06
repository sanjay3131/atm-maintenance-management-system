import ExcelJS from "exceljs";
import ApiError from "../../utils/ApiError.js";
import Employee from "../employees/employee.model.js";
import Vehicle from "./vehicle.model.js";
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

const employeeKey = (session) => String(session.employeeId);
const vehicleKey = (session) => String(session.vehicleId);

const buildGroups = (sessions, reportType) => {
  const groups = new Map();
  for (const session of sessions) {
    const key =
      reportType === "vehicle" ? vehicleKey(session) : employeeKey(session);
    const current = groups.get(key) ?? {
      key,
      label:
        reportType === "vehicle"
          ? session.vehicleRegistrationSnapshot
          : session.employeeNameSnapshot,
      code: reportType === "employee" ? session.employeeCodeSnapshot : "",
      distanceKm: 0,
      sessionCount: 0,
    };
    current.distanceKm += session.distanceKm;
    current.sessionCount += 1;
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
  const filter = {
    status: "COMPLETED",
    businessDate: { $gte: fromDate, $lte: toDate },
    ...(vehicleId ? { vehicleId } : {}),
    ...(employeeId ? { employeeId } : {}),
  };
  const count = await VehicleUsageSession.countDocuments(filter);
  if (count > MAX_VEHICLE_REPORT_ROWS) {
    throw new ApiError(
      413,
      `Vehicle export cannot exceed ${MAX_VEHICLE_REPORT_ROWS} usage sessions`,
    );
  }
  const sessions = await VehicleUsageSession.find(filter)
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
    .lean();
  if (sessions.length > MAX_VEHICLE_REPORT_ROWS) {
    throw new ApiError(
      413,
      `Vehicle export cannot exceed ${MAX_VEHICLE_REPORT_ROWS} usage sessions`,
    );
  }

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
    { header: "Starting KM", key: "start", width: 16 },
    { header: "Ending KM", key: "end", width: 16 },
    { header: "Distance KM", key: "distance", width: 16 },
  ];
  detailSheet.getRow(1).font = { bold: true };

  if (sessions.length === 0) {
    detailSheet.addRow([
      "No completed mileage sessions found for the selected filters.",
    ]);
  } else {
    for (const session of sessions) {
      const identity =
        reportType === "vehicle"
          ? session.vehicleRegistrationSnapshot
          : session.employeeNameSnapshot;
      detailSheet.addRow({
        identity: escapeSpreadsheetText(identity),
        ...(reportType === "employee"
          ? {
              employeeCode: escapeSpreadsheetText(session.employeeCodeSnapshot),
            }
          : {}),
        vehicle: escapeSpreadsheetText(session.vehicleRegistrationSnapshot),
        employee: escapeSpreadsheetText(session.employeeNameSnapshot),
        date: session.businessDate,
        start: session.startOdometerKm,
        end: session.endOdometerKm,
        distance: session.distanceKm,
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
    { header: "Completed sessions", key: "sessions", width: 20 },
    { header: "Total kilometres", key: "distance", width: 20 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  const groups = buildGroups(sessions, reportType);
  for (const group of groups) {
    summarySheet.addRow({
      identity: escapeSpreadsheetText(group.label),
      ...(reportType === "employee"
        ? { employeeCode: escapeSpreadsheetText(group.code) }
        : {}),
      sessions: group.sessionCount,
      distance: group.distanceKm,
    });
  }
  summarySheet.addRow({
    identity: "Complete filtered dataset total",
    ...(reportType === "employee" ? { employeeCode: "" } : {}),
    sessions: sessions.length,
    distance: sessions.reduce(
      (total, session) => total + session.distanceKm,
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
    ["Completed sessions", sessions.length],
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
  };
};
