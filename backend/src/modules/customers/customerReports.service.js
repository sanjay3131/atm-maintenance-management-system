import ExcelJS from "exceljs";
import { JOB_STATUS } from "../../utils/jobStatus.js";
import ApiError from "../../utils/ApiError.js";
import { AC_SUB_TYPE_LABELS, JOB_WORK_TYPE_LABELS } from "../jobs/jobWorkTypes.js";

export const CUSTOMER_REPORT_JOB_STATUSES = [
  JOB_STATUS.VERIFIED,
  JOB_STATUS.APPROVED,
  JOB_STATUS.CLOSED,
];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const parseCalendarDate = (value) => {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
};

export const parseCustomerReportFilters = (query) => {
  const fromDate = query.fromDate;
  const toDate = query.toDate;
  if ((fromDate === undefined) !== (toDate === undefined)) {
    throw new ApiError(400, "fromDate and toDate must be provided together");
  }

  let dateFilter = {};
  if (fromDate !== undefined) {
    const start = parseCalendarDate(fromDate);
    const inclusiveEnd = parseCalendarDate(toDate);
    if (!start || !inclusiveEnd) {
      throw new ApiError(400, "Dates must be valid YYYY-MM-DD values");
    }
    if (start > inclusiveEnd) {
      throw new ApiError(400, "fromDate must be on or before toDate");
    }
    const endExclusive = new Date(inclusiveEnd);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    dateFilter = {
      createdAt: { $gte: start, $lt: endExclusive },
    };
  }

  const jobStatus = query.jobStatus;
  if (
    jobStatus !== undefined &&
    !CUSTOMER_REPORT_JOB_STATUSES.includes(jobStatus)
  ) {
    throw new ApiError(400, "Invalid customer-visible job status");
  }

  return { dateFilter, jobStatus, fromDate, toDate };
};

export const buildCustomerJobReportQuery = (customerId, filters) => ({
  customerId,
  isDeleted: false,
  status: filters.jobStatus || { $in: CUSTOMER_REPORT_JOB_STATUSES },
  ...filters.dateFilter,
});

export const buildCustomerAMCReportQuery = (customerId, filters) => ({
  customerId,
  isDeleted: false,
  status: "COMPLETED",
  ...filters.dateFilter,
});

const escapeSpreadsheetText = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
};

const dateValue = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;

const dateRangeLabel = (filters) =>
  filters.fromDate
    ? `${filters.fromDate} to ${filters.toDate}`
    : "All dates";

const createReportWorkbook = ({ title, worksheetName, filters, columns, rows }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ATM Maintenance Management System";
  workbook.lastModifiedBy = "ATM Maintenance Management System";
  workbook.created = new Date();
  workbook.modified = workbook.created;
  workbook.title = title;
  workbook.subject = `Customer report: ${title}`;

  const worksheet = workbook.addWorksheet(worksheetName);
  worksheet.columns = columns;
  worksheet.mergeCells(1, 1, 1, columns.length);
  worksheet.getCell(1, 1).value = escapeSpreadsheetText(title);
  worksheet.getCell(1, 1).font = { bold: true, size: 16 };
  worksheet.mergeCells(2, 1, 2, columns.length);
  worksheet.getCell(2, 1).value =
    `Record created date range: ${dateRangeLabel(filters)}`;
  worksheet.getCell(2, 1).font = { italic: true, color: { argb: "FF475569" } };

  const header = worksheet.getRow(4);
  header.values = columns.map(({ header: label }) => label);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1D4ED8" },
  };
  header.alignment = { vertical: "middle" };
  header.height = 22;
  worksheet.views = [{ state: "frozen", ySplit: 4 }];
  worksheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: columns.length },
  };

  for (const values of rows) {
    const row = worksheet.addRow(
      columns.map(({ key, type }) => {
        const value = values[key];
        if (type === "date") return dateValue(value);
        return escapeSpreadsheetText(value);
      }),
    );
    row.eachCell((cell, columnNumber) => {
      if (columns[columnNumber - 1].type === "date") {
        cell.numFmt = "dd-mmm-yyyy";
      }
    });
  }

  worksheet.getRow(4).commit();
  return workbook.xlsx.writeBuffer();
};

export const createCustomerJobWorkbook = (jobs, filters) =>
  createReportWorkbook({
    title: "Customer Job History",
    worksheetName: "Job History",
    filters,
    columns: [
      { header: "Job reference", key: "jobReference", width: 24 },
      { header: "Title", key: "title", width: 36 },
      { header: "Work type", key: "workType", width: 20 },
      { header: "AC sub-type", key: "acSubType", width: 20 },
      { header: "Priority", key: "priority", width: 14 },
      { header: "Status", key: "status", width: 16 },
      { header: "Created", key: "createdAt", width: 16, type: "date" },
      { header: "Completed", key: "completedAt", width: 16, type: "date" },
      { header: "Closed", key: "closedAt", width: 16, type: "date" },
    ],
    rows: jobs.map((job) => ({
      jobReference: job.jobNumber || job.jobId,
      title: job.title,
      workType: JOB_WORK_TYPE_LABELS[job.workType] ?? job.workType,
      acSubType: AC_SUB_TYPE_LABELS[job.acSubType] ?? job.acSubType,
      priority: job.priority,
      status: job.status,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      closedAt: job.closedAt,
    })),
  });

export const createCustomerAMCWorkbook = (amcs, filters) =>
  createReportWorkbook({
    title: "Customer Completed AMC Report",
    worksheetName: "Completed AMC",
    filters,
    columns: [
      { header: "AMC reference", key: "amcId", width: 24 },
      { header: "Month", key: "month", width: 14 },
      { header: "Year", key: "year", width: 12 },
      { header: "Status", key: "status", width: 16 },
      { header: "Visit date", key: "visitDate", width: 16, type: "date" },
      { header: "Completed", key: "completedAt", width: 16, type: "date" },
      {
        header: "Checklist completed",
        key: "checklistCompleted",
        width: 22,
      },
    ],
    rows: amcs.map((amc) => ({
      amcId: amc.amcId,
      month: amc.month,
      year: amc.year,
      status: amc.status,
      visitDate: amc.visitDate,
      completedAt: amc.completedAt,
      checklistCompleted: amc.checklistCompleted ? "Yes" : "No",
    })),
  });

export const CUSTOMER_XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const sendCustomerWorkbook = async (res, filename, workbookBuffer) => {
  res.setHeader("Content-Type", CUSTOMER_XLSX_CONTENT_TYPE);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).send(Buffer.from(workbookBuffer));
};

export const customerReportFilename = (report, filters) => {
  const range = filters.fromDate
    ? `-${filters.fromDate}-to-${filters.toDate}`
    : "";
  return `${report}${range}.xlsx`;
};
