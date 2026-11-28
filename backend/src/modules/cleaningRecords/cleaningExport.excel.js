import ExcelJS from "exceljs";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import ApiError from "../../utils/ApiError.js";
import { getBusinessDateParts } from "../jobs/recurringMaintenance.utils.js";

const TIME_ZONE = "Asia/Kolkata";
const DATE_FORMAT = "dd-mmm-yyyy";

const SCHEDULED_COLUMNS = [
  { header: "ATM ID", width: 18 },
  { header: "ATM location", width: 28 },
  { header: "ATM address", width: 42 },
  { header: "Bank", width: 24 },
  { header: "Region", width: 22 },
  { header: "District", width: 24 },
  { header: "Plan ID / details", width: 46 },
  { header: "Maintenance type", width: 22 },
  { header: "Plan-assigned employee", width: 30 },
  { header: "Occurrence-assigned employee", width: 30 },
  { header: "Scheduled date", width: 18 },
  { header: "Job status", width: 18 },
  { header: "Actual cleaning date", width: 20 },
  { header: "CleaningRecord validity", width: 24 },
  { header: "Cleaner type", width: 18 },
  { header: "Actual cleaner employee", width: 30 },
  { header: "Outsourced cleaner name", width: 28 },
  { header: "Reporting employee", width: 30 },
  { header: "Remarks", width: 48 },
];

const MONITORING_COLUMNS = [
  { header: "ATM ID", width: 18 },
  { header: "ATM location", width: 28 },
  { header: "ATM address", width: 42 },
  { header: "Bank", width: 24 },
  { header: "Region", width: 22 },
  { header: "District", width: 24 },
  { header: "Maintenance type", width: 22 },
  { header: "Assigned employee", width: 30 },
  { header: "Monitoring status", width: 24 },
  { header: "Last valid cleaning date", width: 24 },
  { header: "Days since last valid cleaning", width: 30 },
  { header: "Monitoring activation date", width: 26 },
  { header: "Export timestamp (Asia/Kolkata)", width: 34 },
];

const escapeSpreadsheetText = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
};

const dateCell = (value) => {
  if (!value) return null;
  const dateKey =
    typeof value === "string"
      ? value
      : getBusinessDateParts(new Date(value)).dateKey;
  return new Date(`${dateKey}T12:00:00.000Z`);
};

const formatTimestamp = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const employeeName = (employee) => {
  if (!employee) return "";
  const name = [employee.firstName, employee.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return [employee.employeeCode, name].filter(Boolean).join(" - ");
};

const planDetails = (job) => {
  const plan = job.recurringPlan;
  const planId = job.recurringMaintenance?.planId ?? plan?._id;
  if (!planId && !plan) return "";
  const details = [planId ? `Plan ${planId}` : ""];
  if (plan?.startDate) {
    details.push(
      `Starts ${getBusinessDateParts(new Date(plan.startDate)).dateKey}`,
    );
  }
  if (plan?.dayOfWeek !== null && plan?.dayOfWeek !== undefined) {
    details.push(`Day ${plan.dayOfWeek}`);
  }
  if (plan?.isActive !== undefined) {
    details.push(plan.isActive ? "Active" : "Inactive");
  }
  return details.filter(Boolean).join("; ");
};

const snapshotOrCurrent = (snapshotValue, currentValue) =>
  snapshotValue || currentValue || "";

const scheduledJobValues = (job) => {
  const record = job.cleaningRecord ?? null;
  const atm = job.currentATM ?? {};
  const snapshot = job.geographySnapshot ?? {};
  const validity =
    record?.validityStatus === "VALID" || record?.validityStatus === "VOID"
      ? record.validityStatus
      : record
        ? "UNKNOWN"
        : "NO_RECORD";
  return [
    escapeSpreadsheetText(atm.atmId ?? atm.clientAtmId),
    escapeSpreadsheetText(atm.locationName),
    escapeSpreadsheetText(atm.address),
    escapeSpreadsheetText(
      snapshotOrCurrent(snapshot.bankName, job.currentBank?.bankName),
    ),
    escapeSpreadsheetText(
      snapshotOrCurrent(snapshot.regionName, job.currentRegion?.name),
    ),
    escapeSpreadsheetText(
      snapshotOrCurrent(
        snapshot.districtName,
        job.currentDistrict?.districtName,
      ),
    ),
    escapeSpreadsheetText(planDetails(job)),
    escapeSpreadsheetText(job.recurringMaintenance?.maintenanceType),
    escapeSpreadsheetText(employeeName(job.planAssignedEmployee)),
    escapeSpreadsheetText(
      employeeName(
        job.occurrenceAssignedEmployee ??
          job.occurrenceAssignedUser ??
          null,
      ),
    ),
    dateCell(job.recurringMaintenance?.scheduledDate),
    escapeSpreadsheetText(job.status),
    dateCell(record?.cleaningDate),
    escapeSpreadsheetText(validity),
    escapeSpreadsheetText(record?.actualCleanerType),
    escapeSpreadsheetText(employeeName(job.actualCleanerEmployee)),
    escapeSpreadsheetText(record?.outsourcedCleanerName),
    escapeSpreadsheetText(employeeName(job.reportingEmployee)),
    escapeSpreadsheetText(record?.remarks),
  ];
};

const monitoringValues = (record, generatedAt) => {
  const atm = record.atm ?? {};
  const employee = record.responsibleEmployee ?? {};
  return [
    escapeSpreadsheetText(atm.atmId ?? atm.clientAtmId),
    escapeSpreadsheetText(atm.locationName),
    escapeSpreadsheetText(atm.address),
    escapeSpreadsheetText(atm.bankId?.bankName),
    escapeSpreadsheetText(atm.regionId?.name),
    escapeSpreadsheetText(atm.districtId?.districtName),
    escapeSpreadsheetText(record.maintenanceType),
    escapeSpreadsheetText(
      employeeName({
        employeeCode: employee.employeeCode,
        firstName: employee.userId?.firstName,
        lastName: employee.userId?.lastName,
      }),
    ),
    escapeSpreadsheetText(record.status),
    dateCell(record.latestCleaningDate),
    Number.isInteger(record.ageInCalendarDays)
      ? record.ageInCalendarDays
      : null,
    record.monitoringActivatedAt
      ? formatTimestamp(new Date(record.monitoringActivatedAt))
      : "",
    formatTimestamp(generatedAt),
  ];
};

const createWorksheet = (workbook, name, columns) => {
  const worksheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.columns = columns.map(({ width }) => ({ width }));
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
  return worksheet;
};

const createExportByteLimit = (maximumBytes) => {
  let writtenBytes = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      writtenBytes += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(chunk, encoding);
      if (writtenBytes > maximumBytes) {
        callback(
          new ApiError(413, "Cleaning export exceeds the 64 MiB output limit"),
        );
        return;
      }
      callback(null, chunk);
    },
  });
};

const assertExportActive = ({ signal, deadline }) => {
  if (signal?.aborted) {
    throw new ApiError(499, "Cleaning export was cancelled");
  }
  if (Date.now() >= deadline) {
    throw new ApiError(504, "Cleaning export exceeded its time limit");
  }
};

const addDateFormats = (row, dateColumns) => {
  for (const column of dateColumns) {
    row.getCell(column).numFmt = DATE_FORMAT;
  }
  row.commit();
};

export const writeRecurringCleaningWorkbook = async ({
  scheduledJobs,
  monitoringRows,
  outputPath,
  signal,
  deadline,
  generatedAt,
  maxBytes,
  maxRows,
}) => {
  const byteLimit = createExportByteLimit(maxBytes);
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
  workbook.title = "Recurring cleaning export";
  workbook.subject = "Scheduled cleaning jobs and current monitoring";

  try {
    const scheduledSheet = createWorksheet(
      workbook,
      "Scheduled Jobs",
      SCHEDULED_COLUMNS,
    );
    const monitoringSheet = createWorksheet(
      workbook,
      "Current Monitoring",
      MONITORING_COLUMNS,
    );
    let scheduledCount = 0;
    for await (const job of scheduledJobs) {
      assertExportActive({ signal, deadline });
      if (scheduledCount >= maxRows) {
        throw new ApiError(
          413,
          "Scheduled Jobs exceed the Excel worksheet row limit",
        );
      }
      const row = scheduledSheet.addRow(scheduledJobValues(job));
      addDateFormats(row, [11, 13]);
      scheduledCount += 1;
    }

    let monitoringCount = 0;
    for (const record of monitoringRows) {
      assertExportActive({ signal, deadline });
      if (monitoringCount >= maxRows) {
        throw new ApiError(
          413,
          "Current Monitoring exceeds the Excel worksheet row limit",
        );
      }
      const row = monitoringSheet.addRow(
        monitoringValues(record, generatedAt),
      );
      addDateFormats(row, [10]);
      monitoringCount += 1;
    }

    assertExportActive({ signal, deadline });
    scheduledSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: scheduledCount + 1, column: SCHEDULED_COLUMNS.length },
    };
    monitoringSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: monitoringCount + 1, column: MONITORING_COLUMNS.length },
    };
    scheduledSheet.commit();
    monitoringSheet.commit();
    await workbook.commit();
    await outputFinished;
    assertExportActive({ signal, deadline });
  } catch (error) {
    byteLimit.destroy();
    output.destroy();
    await outputFinished.catch(() => {});
    throw error;
  }
};

export const cleaningExportSpreadsheetText = escapeSpreadsheetText;
