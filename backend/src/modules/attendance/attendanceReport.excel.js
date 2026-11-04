import ExcelJS from "exceljs";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import {
  assertAttendanceExportActive,
  createAttendanceExportByteLimit,
  MAX_ATTENDANCE_EXPORT_BYTES,
} from "./attendanceExport.safety.js";
import ApiError from "../../utils/ApiError.js";
import { toAsiaKolkataDateKey } from "../employees/employeeDates.js";

const TIME_ZONE = "Asia/Kolkata";
const EXCEL_MAX_ROWS = 1_048_576;
const DATE_FORMAT = "dd-mmm-yyyy";
const DURATION_FORMAT = "0.00";
const SUMMARY_COLUMNS = [
  { header: "Employee code", key: "employeeCode", width: 18 },
  { header: "Employee name", key: "employeeName", width: 30 },
  { header: "Eligible days", key: "eligibleWorkingDays", width: 15 },
  { header: "Present days", key: "presentDays", width: 14 },
  { header: "Incomplete days", key: "incompleteDays", width: 17 },
  { header: "Absent days", key: "absentDays", width: 14 },
  { header: "Not recorded days", key: "notRecordedDays", width: 19 },
  { header: "Attendance %", key: "attendancePercentage", width: 16 },
  { header: "Worked hours", key: "workedHours", width: 16 },
  { header: "Finalized hours", key: "finalizedHours", width: 17 },
  { header: "Provisional hours", key: "provisionalHours", width: 19 },
];
const DAILY_COLUMNS = [
  { header: "Employee code", key: "employeeCode", width: 18 },
  { header: "Employee name", key: "employeeName", width: 30 },
  { header: "Attendance date", key: "attendanceDate", width: 18 },
  { header: "Day", key: "day", width: 14 },
  { header: "Check-in (Asia/Kolkata)", key: "checkInAt", width: 25 },
  { header: "Check-out (Asia/Kolkata)", key: "checkOutAt", width: 25 },
  { header: "Worked hours", key: "workedHours", width: 16 },
  { header: "Status", key: "status", width: 17 },
  { header: "Status origin", key: "statusOrigin", width: 18 },
  { header: "Checkout state", key: "checkoutState", width: 18 },
  { header: "Checkout source", key: "checkOutSource", width: 18 },
  { header: "Duration", key: "durationState", width: 16 },
];

const escapeSpreadsheetText = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
};

const dateCell = (dateKey) =>
  new Date(`${dateKey}T12:00:00.000Z`);

const hours = (durationMs) =>
  durationMs === null ? null : durationMs / (60 * 60 * 1000);

const formattedDateTime = (value) => {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const createWorksheet = (workbook, name, columns) => {
  const worksheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.columns = columns.map(({ key, width }) => ({ key, width }));
  const header = worksheet.addRow(columns.map(({ header: label }) => label));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF254B6E" },
  };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  header.commit();
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  return worksheet;
};

const createSummaryWorksheet = (workbook, reportPlan, periodType) => {
  const worksheet = workbook.addWorksheet("Summary", {
    views: [{ state: "frozen", ySplit: 8 }],
  });
  worksheet.columns = SUMMARY_COLUMNS.map(({ key, width }) => ({ key, width }));
  const metadata = [
    ["Attendance report"],
    [`Period type: ${periodType}`],
    [`Date range: ${reportPlan.period.fromDate} to ${reportPlan.period.toDate}`],
    [
      `As of business date: ${toAsiaKolkataDateKey(reportPlan.asOf)} · cutoff: ${reportPlan.asOf.toISOString()} · ${TIME_ZONE}`,
    ],
    [`Employee filter: ${reportPlan.employeeId ?? "All employees"}`],
    [`Total employees: ${reportPlan.totalEmployees}`],
  ];
  for (const [value] of metadata) {
    worksheet.addRow([escapeSpreadsheetText(value)]).commit();
  }
  worksheet.addRow([]).commit();
  const header = worksheet.addRow(SUMMARY_COLUMNS.map(({ header: label }) => label));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF254B6E" },
  };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  header.commit();
  worksheet.autoFilter = {
    from: { row: 8, column: 1 },
    to: { row: 8, column: SUMMARY_COLUMNS.length },
  };
  return worksheet;
};

const addSummaryRow = (worksheet, employee) => {
  const summary = employee.summary;
  const row = worksheet.addRow([
    escapeSpreadsheetText(employee.employeeCode),
    escapeSpreadsheetText(employee.employeeName),
    summary.eligibleWorkingDays,
    summary.presentDays,
    summary.incompleteDays,
    summary.absentDays,
    summary.notRecordedDays,
    summary.attendancePercentage,
    hours(summary.workedDurationMs),
    hours(summary.finalizedWorkedDurationMs),
    hours(summary.provisionalWorkedDurationMs),
  ]);
  row.getCell(8).numFmt = "0.00";
  for (const column of [9, 10, 11]) {
    row.getCell(column).numFmt = DURATION_FORMAT;
  }
  row.commit();
};

const addDailyRow = (worksheet, employee, detail) => {
  const row = worksheet.addRow([
    escapeSpreadsheetText(employee.employeeCode),
    escapeSpreadsheetText(employee.employeeName),
    dateCell(detail.attendanceDate),
    new Intl.DateTimeFormat("en-IN", {
      timeZone: TIME_ZONE,
      weekday: "long",
    }).format(dateCell(detail.attendanceDate)),
    formattedDateTime(detail.checkInAt),
    formattedDateTime(detail.checkOutAt),
    hours(detail.workedDurationMs),
    escapeSpreadsheetText(detail.status),
    escapeSpreadsheetText(detail.statusOrigin),
    escapeSpreadsheetText(detail.checkoutState),
    escapeSpreadsheetText(detail.checkOutSource),
    detail.durationIsProvisional
      ? "Provisional"
      : detail.checkoutState === "checked_out"
        ? "Finalized"
        : "",
  ]);
  row.getCell(3).numFmt = DATE_FORMAT;
  row.getCell(7).numFmt = DURATION_FORMAT;
  row.commit();
};

const createDailySheet = (workbook) => {
  const worksheet = createWorksheet(workbook, "Daily Details", DAILY_COLUMNS);
  let dataRows = 0;
  return {
    add(employee, detail) {
      if (dataRows >= EXCEL_MAX_ROWS - 1) {
        throw new ApiError(
          413,
          "Attendance daily details exceed Excel worksheet row capacity",
        );
      }
      addDailyRow(worksheet, employee, detail);
      dataRows += 1;
    },
    commit() {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: dataRows + 1, column: DAILY_COLUMNS.length },
      };
      worksheet.commit();
    },
  };
};

export const writeAttendanceWorkbook = async ({
  reportPlan,
  periodType,
  outputPath,
  signal,
  deadline,
  generatedAt = new Date(),
}) => {
  const byteLimit = createAttendanceExportByteLimit(MAX_ATTENDANCE_EXPORT_BYTES);
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  const outputFinished = pipeline(byteLimit, output);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: byteLimit,
    useStyles: true,
    useSharedStrings: false,
  });
  workbook.creator = "ATM Maintenance Management System";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.title = "Attendance report";
  workbook.subject = "Complete filtered employee attendance report";

  try {
    const summary = createSummaryWorksheet(workbook, reportPlan, periodType);
    const daily = createDailySheet(workbook);
    const totals = {
      eligibleWorkingDays: 0,
      presentDays: 0,
      incompleteDays: 0,
      absentDays: 0,
      notRecordedDays: 0,
      workedDurationMs: 0,
      finalizedWorkedDurationMs: 0,
      provisionalWorkedDurationMs: 0,
    };
    let processedEmployees = 0;

    for await (const batch of reportPlan.batches(( ) =>
      assertAttendanceExportActive({ signal, deadline }),
    )) {
      assertAttendanceExportActive({ signal, deadline });
      for (const employee of batch.employees) {
        addSummaryRow(summary, employee);
        processedEmployees += 1;
        for (const key of Object.keys(totals)) {
          totals[key] += employee.summary[key];
        }
        for (const detail of employee.dailyDetails) daily.add(employee, detail);
      }
    }

    if (processedEmployees !== reportPlan.totalEmployees) {
      throw new Error("Attendance workbook did not include every filtered employee");
    }

    const totalPercentage =
      totals.eligibleWorkingDays === 0
        ? null
        : Number(
            ((totals.presentDays / totals.eligibleWorkingDays) * 100).toFixed(2),
          );
    const totalRow = summary.addRow([
      "Total",
      `${processedEmployees} employees`,
      totals.eligibleWorkingDays,
      totals.presentDays,
      totals.incompleteDays,
      totals.absentDays,
      totals.notRecordedDays,
      totalPercentage,
      hours(totals.workedDurationMs),
      hours(totals.finalizedWorkedDurationMs),
      hours(totals.provisionalWorkedDurationMs),
    ]);
    totalRow.font = { bold: true };
    totalRow.commit();
    summary.autoFilter = {
      from: { row: 8, column: 1 },
      to: { row: processedEmployees + 9, column: SUMMARY_COLUMNS.length },
    };

    const info = workbook.addWorksheet("Report Information");
    info.columns = [
      { key: "field", width: 30 },
      { key: "value", width: 48 },
    ];
    const infoHeader = info.addRow(["Field", "Value"]);
    infoHeader.font = { bold: true };
    infoHeader.commit();
    const information = [
      ["Report", "Attendance report"],
      ["Period type", periodType],
      ["Start date", reportPlan.period.fromDate],
      ["End date", reportPlan.period.toDate],
      ["As of", reportPlan.asOf.toISOString()],
      ["As of business date", toAsiaKolkataDateKey(reportPlan.asOf)],
      ["Calculated through date", reportPlan.period.calculatedThroughDate ?? "No eligible dates"],
      ["Timezone", TIME_ZONE],
      ["Employee filter", reportPlan.employeeId ?? "All employees"],
      ["Employees", processedEmployees],
      ["Generated at", generatedAt.toISOString()],
      ["Export format", "XLSX"],
      ["Consistency", "Fixed asOf; records are not read from a database snapshot."],
    ];
    for (const [field, value] of information) {
      info.addRow([escapeSpreadsheetText(field), escapeSpreadsheetText(value)]).commit();
    }

    assertAttendanceExportActive({ signal, deadline });
    summary.commit();
    daily.commit();
    info.commit();
    await workbook.commit();
    await outputFinished;
    assertAttendanceExportActive({ signal, deadline });
  } catch (error) {
    byteLimit.destroy();
    output.destroy();
    await outputFinished.catch(() => {});
    throw error;
  }
};

export const attendanceWorkbookLimits = {
  excelMaxRows: EXCEL_MAX_ROWS,
};
