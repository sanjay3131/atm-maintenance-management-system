import PDFDocument from "pdfkit";
import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import ApiError from "../../utils/ApiError.js";
import { toAsiaKolkataDateKey } from "../employees/employeeDates.js";
import {
  assertAttendanceExportActive,
  createAttendanceExportByteLimit,
  MAX_ATTENDANCE_EXPORT_BYTES,
} from "./attendanceExport.safety.js";

const TIME_ZONE = "Asia/Kolkata";
const FONT_PATH = fileURLToPath(
  new URL("./assets/NotoSansTamil-Regular.ttf", import.meta.url),
);
export const MAX_ATTENDANCE_PDF_SPOOL_BYTES = 128 * 1024 * 1024;

export const assertAttendancePdfSpoolLimit = (totalBytes) => {
  if (totalBytes > MAX_ATTENDANCE_PDF_SPOOL_BYTES) {
    throw new ApiError(
      413,
      "Attendance PDF working data exceeds the 128 MB temporary-storage limit",
    );
  }
};
const SUMMARY_COLUMNS = [
  { title: "Employee code", width: 90, key: "employeeCode" },
  { title: "Employee name", width: 210, key: "employeeName" },
  { title: "Eligible days", width: 75, key: "eligibleWorkingDays" },
  { title: "Present days", width: 70, key: "presentDays" },
  { title: "Incomplete days", width: 82, key: "incompleteDays" },
  { title: "Absent days", width: 70, key: "absentDays" },
  { title: "Not recorded days", width: 92, key: "notRecordedDays" },
  { title: "Attendance %", width: 85, key: "attendancePercentage" },
  { title: "Worked hours", width: 95, key: "workedHours" },
  { title: "Finalized hours", width: 105, key: "finalizedHours" },
  { title: "Provisional hours", width: 115, key: "provisionalHours" },
];
const DAILY_COLUMNS = [
  { title: "Employee code", width: 78, key: "employeeCode" },
  { title: "Employee name", width: 175, key: "employeeName" },
  { title: "Attendance date", width: 82, key: "attendanceDate" },
  { title: "Day", width: 55, key: "day" },
  { title: "Check-in (Asia/Kolkata)", width: 98, key: "checkInAt" },
  { title: "Check-out (Asia/Kolkata)", width: 98, key: "checkOutAt" },
  { title: "Worked hours", width: 78, key: "workedHours" },
  { title: "Status", width: 84, key: "status" },
  { title: "Status origin", width: 88, key: "statusOrigin" },
  { title: "Checkout state", width: 95, key: "checkoutState" },
  { title: "Checkout source", width: 90, key: "checkOutSource" },
  { title: "Duration", width: 90, key: "durationState" },
];
const INFORMATION_COLUMNS = [
  { title: "Field", width: 210, key: "field" },
  { title: "Value", width: 916, key: "value" },
];
const PAGE_SIZE = [1191, 842];
const MARGINS = { top: 50, bottom: 42, left: 32, right: 32 };
const TAMIL_TEXT = /[\u0B80-\u0BFF]/u;

const fontForText = (text) =>
  TAMIL_TEXT.test(text) ? "AttendanceTamil" : "Helvetica";

const layoutText = (doc, text, width, fontSize) => {
  const runs = [];
  let line = 0;
  let offset = 0;
  const lineHeight = fontSize * 1.35;
  const append = (value, font) => {
    if (!value) return;
    doc.font(font).fontSize(fontSize);
    const valueWidth = doc.widthOfString(value);
    if (/^\s+$/u.test(value) && offset === 0) return;
    if (offset > 0 && offset + valueWidth > width) {
      line += 1;
      offset = 0;
      if (/^\s+$/u.test(value)) return;
    }
    if (valueWidth > width && offset === 0 && !/^\s+$/u.test(value)) {
      for (const character of Array.from(value)) {
        doc.font(font).fontSize(fontSize);
        const characterWidth = doc.widthOfString(character);
        if (offset > 0 && offset + characterWidth > width) {
          line += 1;
          offset = 0;
        }
        runs.push({ text: character, font, line, offset });
        offset += characterWidth;
      }
      return;
    }
    runs.push({ text: value, font, line, offset });
    offset += valueWidth;
  };

  const fontRuns = text.match(/[\u0B80-\u0BFF]+|[^\u0B80-\u0BFF]+/gu) ?? [text];
  for (const fontRun of fontRuns) {
    const font = fontForText(fontRun);
    const tokens = fontRun.match(/\s+|\S+/gu) ?? [];
    for (const token of tokens) append(token, font);
  }
  return { runs, height: (line + 1) * lineHeight };
};

const textHeight = (doc, text, width, fontSize) => {
  if (TAMIL_TEXT.test(text)) {
    return layoutText(doc, text, width, fontSize).height;
  }
  doc.font("Helvetica").fontSize(fontSize);
  return doc.heightOfString(text, { width, fontSize });
};

const drawText = (doc, text, x, y, width, fontSize) => {
  if (!TAMIL_TEXT.test(text)) {
    doc.font("Helvetica").fontSize(fontSize);
    doc.text(text, x, y, { width, fontSize });
    return;
  }
  const layout = layoutText(doc, text, width, fontSize);
  for (const run of layout.runs) {
    doc.font(run.font).fontSize(fontSize);
    doc.text(run.text, x + run.offset, y + run.line * fontSize * 1.35, {
      lineBreak: false,
    });
  }
};

const displayDateTime = (value) => {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const displayHours = (durationMs) =>
  durationMs == null ? "" : (durationMs / 3_600_000).toFixed(2);

const displayPercentage = (value) =>
  value == null ? "" : value.toFixed(2);

const writeReportSpool = async ({
  reportPlan,
  spoolPath,
  signal,
  deadline,
}) => {
  const spool = createWriteStream(spoolPath, { flags: "wx", mode: 0o600 });
  const closed = new Promise((resolve, reject) => {
    spool.once("error", reject);
    spool.once("finish", resolve);
  });
  const employees = [];
  let totalBytes = 0;
  let processed = 0;

  try {
    for await (const batch of reportPlan.batches(() =>
      assertAttendanceExportActive({ signal, deadline }),
    )) {
      for (const employee of batch.employees) {
        assertAttendanceExportActive({ signal, deadline });
        const row = JSON.stringify(employee);
        const bytes = Buffer.byteLength(row) + 1;
        totalBytes += bytes;
        assertAttendancePdfSpoolLimit(totalBytes);
        if (!spool.write(`${row}\n`)) await once(spool, "drain");
        employees.push({
          employeeCode: employee.employeeCode,
          employeeName: employee.employeeName,
          summary: employee.summary,
        });
        processed += 1;
      }
    }
    if (processed !== reportPlan.totalEmployees) {
      throw new Error("Attendance PDF did not include every filtered employee");
    }
    spool.end();
    await closed;
  } catch (error) {
    spool.destroy(error);
    await closed.catch(() => {});
    throw error;
  }
  return employees;
};

const drawTableHeader = (doc, y, title, columns, introLines = []) => {
  const left = MARGINS.left;
  const contentWidth = PAGE_SIZE[0] - MARGINS.left - MARGINS.right;
  doc.font("Helvetica").fontSize(13).fillColor("#17212b");
  doc.text(title, left, y, { width: contentWidth, lineBreak: false });
  y += 20;
  for (const line of introLines) {
    doc.font("Helvetica").fontSize(8).fillColor("#536574");
    doc.text(line, left, y, { width: contentWidth });
    y += textHeight(doc, line, contentWidth, 8) + 2;
  }
  y += 3;
  let x = left;
  for (const column of columns) {
    doc.font("Helvetica").fontSize(7.5).fillColor("#243746");
    doc.text(column.title, x, y, {
      width: column.width - 4,
      height: 30,
      lineBreak: true,
    });
    x += column.width;
  }
  y += 32;
  doc
    .moveTo(left, y)
    .lineTo(PAGE_SIZE[0] - MARGINS.right, y)
    .lineWidth(0.6)
    .strokeColor("#748391")
    .stroke();
  return y + 6;
};

const createPdfWriter = (outputPath) => {
  const byteLimit = createAttendanceExportByteLimit(MAX_ATTENDANCE_EXPORT_BYTES);
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  const outputFinished = pipeline(byteLimit, output);
  const doc = new PDFDocument({
    size: "A3",
    layout: "landscape",
    margins: MARGINS,
    bufferPages: false,
    autoFirstPage: true,
  });
  doc.registerFont("AttendanceTamil", FONT_PATH);
  doc.font("Helvetica");
  doc.pipe(byteLimit);

  let pageNumber = 1;
  const drawChrome = () => {
    const savedX = doc.x;
    const savedY = doc.y;
    doc.font("Helvetica").fontSize(8).fillColor("#536574");
    doc.text("Attendance report · Asia/Kolkata", MARGINS.left, 18, {
      lineBreak: false,
    });
    doc.text(
      `Page ${pageNumber}`,
      MARGINS.left,
      PAGE_SIZE[1] - MARGINS.bottom - 12,
      {
        width: PAGE_SIZE[0] - MARGINS.left - MARGINS.right,
        align: "right",
        lineBreak: false,
      },
    );
    doc.x = savedX;
    doc.y = savedY;
  };
  drawChrome();
  doc.on("pageAdded", () => {
    pageNumber += 1;
    drawChrome();
  });
  return { doc, byteLimit, output, outputFinished };
};

const assertPdfRowFits = (height) => {
  if (height > PAGE_SIZE[1] - MARGINS.top - MARGINS.bottom - 80) {
    throw new ApiError(
      422,
      "An attendance row is too long to fit safely on a PDF page",
    );
  }
};

const addPdfTableRow = (
  doc,
  { sectionTitle, columns, values, y, fontSize = 8 },
) => {
  const cells = columns.map(({ key, width }) => {
    const text = String(values[key] ?? "");
    return {
      text,
      width,
      height: textHeight(doc, text, width, fontSize),
    };
  });
  const rowHeight = Math.max(19, ...cells.map(({ height }) => height)) + 6;
  assertPdfRowFits(rowHeight);
  if (y + rowHeight > PAGE_SIZE[1] - MARGINS.bottom) {
    doc.addPage();
    y = drawTableHeader(doc, MARGINS.top - 10, sectionTitle, columns);
  }

  let x = MARGINS.left;
  doc.fillColor("#17212b");
  for (const cell of cells) {
    drawText(doc, cell.text, x, y, cell.width, fontSize);
    x += cell.width;
  }
  const bottom = y + rowHeight - 3;
  doc
    .moveTo(MARGINS.left, bottom)
    .lineTo(PAGE_SIZE[0] - MARGINS.right, bottom)
    .lineWidth(0.25)
    .strokeColor("#d4dce2")
    .stroke();
  return y + rowHeight;
};

const readSpool = async function* (spoolPath) {
  let content = "";
  for await (const chunk of createReadStream(spoolPath, { encoding: "utf8" })) {
    content += chunk;
    let newline;
    while ((newline = content.indexOf("\n")) !== -1) {
      const line = content.slice(0, newline);
      content = content.slice(newline + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (content) yield JSON.parse(content);
};

const summaryValues = (employee) => ({
  employeeCode: employee.employeeCode,
  employeeName: employee.employeeName,
  eligibleWorkingDays: employee.summary.eligibleWorkingDays,
  presentDays: employee.summary.presentDays,
  incompleteDays: employee.summary.incompleteDays,
  absentDays: employee.summary.absentDays,
  notRecordedDays: employee.summary.notRecordedDays,
  attendancePercentage: displayPercentage(
    employee.summary.attendancePercentage,
  ),
  workedHours: displayHours(employee.summary.workedDurationMs),
  finalizedHours: displayHours(employee.summary.finalizedWorkedDurationMs),
  provisionalHours: displayHours(employee.summary.provisionalWorkedDurationMs),
});

const makeSummaryTotal = (employees) => {
  const totals = employees.reduce(
    (sum, employee) => {
      for (const key of [
        "eligibleWorkingDays",
        "presentDays",
        "incompleteDays",
        "absentDays",
        "notRecordedDays",
        "workedDurationMs",
        "finalizedWorkedDurationMs",
        "provisionalWorkedDurationMs",
      ]) {
        sum[key] += employee.summary[key];
      }
      return sum;
    },
    {
      eligibleWorkingDays: 0,
      presentDays: 0,
      incompleteDays: 0,
      absentDays: 0,
      notRecordedDays: 0,
      workedDurationMs: 0,
      finalizedWorkedDurationMs: 0,
      provisionalWorkedDurationMs: 0,
    },
  );
  const attendancePercentage =
    totals.eligibleWorkingDays === 0
      ? null
      : Number(
          ((totals.presentDays / totals.eligibleWorkingDays) * 100).toFixed(2),
        );
  return {
    employeeCode: "Total",
    employeeName: `${employees.length} employees`,
    ...totals,
    attendancePercentage,
  };
};

const detailValues = (employee, detail) => {
  const date = new Date(`${detail.attendanceDate}T12:00:00.000Z`);
  return {
    employeeCode: employee.employeeCode,
    employeeName: employee.employeeName,
    attendanceDate: new Intl.DateTimeFormat("en-IN", {
      timeZone: TIME_ZONE,
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date),
    day: new Intl.DateTimeFormat("en-IN", {
      timeZone: TIME_ZONE,
      weekday: "long",
    }).format(date),
    checkInAt: displayDateTime(detail.checkInAt),
    checkOutAt: displayDateTime(detail.checkOutAt),
    workedHours: displayHours(detail.workedDurationMs),
    status: detail.status,
    statusOrigin: detail.statusOrigin,
    checkoutState: detail.checkoutState,
    checkOutSource: detail.checkOutSource,
    durationState: detail.durationIsProvisional
      ? "Provisional"
      : detail.checkoutState === "checked_out"
        ? "Finalized"
        : "",
  };
};

const reportInformation = ({
  reportPlan,
  periodType,
  generatedAt,
  employeeCount,
}) => [
  ["Report", "Attendance report"],
  ["Period type", periodType],
  ["Start date", reportPlan.period.fromDate],
  ["End date", reportPlan.period.toDate],
  ["As of", reportPlan.asOf.toISOString()],
  ["As of business date", toAsiaKolkataDateKey(reportPlan.asOf)],
  [
    "Calculated through date",
    reportPlan.period.calculatedThroughDate ?? "No eligible dates",
  ],
  ["Timezone", TIME_ZONE],
  ["Employee filter", reportPlan.employeeId ?? "All employees"],
  ["Employees", employeeCount],
  ["Generated at", generatedAt.toISOString()],
  ["Export format", "PDF"],
  ["Consistency", "Fixed asOf; records are not read from a database snapshot."],
].map(([field, value]) => ({ field, value }));

const createSectionWriter = (doc) => {
  let hasSection = false;
  return (title, columns, introLines = []) => {
    if (hasSection) doc.addPage();
    hasSection = true;
    return drawTableHeader(
      doc,
      MARGINS.top - 10,
      title,
      columns,
      introLines,
    );
  };
};

export const writeAttendancePdf = async ({
  reportPlan,
  periodType,
  outputPath,
  spoolPath,
  signal,
  deadline,
  generatedAt = new Date(),
}) => {
  const employees = await writeReportSpool({
    reportPlan,
    spoolPath,
    signal,
    deadline,
  });
  const { doc, byteLimit, output, outputFinished } = createPdfWriter(outputPath);

  try {
    const startSection = createSectionWriter(doc);
    let y = startSection("Summary", SUMMARY_COLUMNS, [
      `Attendance report · ${periodType} · ${reportPlan.period.fromDate} to ${reportPlan.period.toDate}`,
      `As of business date ${toAsiaKolkataDateKey(reportPlan.asOf)} · cutoff ${reportPlan.asOf.toISOString()} · ${TIME_ZONE}`,
      `Employee filter: ${reportPlan.employeeId ?? "All employees"} · Total employees: ${employees.length}`,
    ]);
    for (const employee of employees) {
      assertAttendanceExportActive({ signal, deadline });
      y = addPdfTableRow(doc, {
        sectionTitle: "Summary",
        columns: SUMMARY_COLUMNS,
        values: summaryValues(employee),
        y,
      });
    }
    const total = makeSummaryTotal(employees);
    y = addPdfTableRow(doc, {
      sectionTitle: "Summary",
      columns: SUMMARY_COLUMNS,
      values: {
        ...summaryValues({
          employeeCode: total.employeeCode,
          employeeName: total.employeeName,
          summary: total,
        }),
      },
      y,
      fontSize: 8,
    });

    y = startSection("Daily Details", DAILY_COLUMNS);
    for await (const employee of readSpool(spoolPath)) {
      assertAttendanceExportActive({ signal, deadline });
      for (const detail of employee.dailyDetails) {
        assertAttendanceExportActive({ signal, deadline });
        y = addPdfTableRow(doc, {
          sectionTitle: "Daily Details",
          columns: DAILY_COLUMNS,
          values: detailValues(employee, detail),
          y,
          fontSize: 7.5,
        });
      }
    }

    y = startSection("Report Information", INFORMATION_COLUMNS);
    for (const values of reportInformation({
      reportPlan,
      periodType,
      generatedAt,
      employeeCount: employees.length,
    })) {
      assertAttendanceExportActive({ signal, deadline });
      y = addPdfTableRow(doc, {
        sectionTitle: "Report Information",
        columns: INFORMATION_COLUMNS,
        values,
        y,
        fontSize: 9,
      });
    }

    assertAttendanceExportActive({ signal, deadline });
    doc.end();
    await outputFinished;
    assertAttendanceExportActive({ signal, deadline });
  } catch (error) {
    doc.destroy();
    byteLimit.destroy();
    output.destroy();
    await outputFinished.catch(() => {});
    throw error;
  }
};
