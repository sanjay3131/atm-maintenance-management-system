import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import ApiError from "../../utils/ApiError.js";

const TEMPLATE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "docs/reference/Single_Work_Order_Print_Sheet.xlsx",
);

const WORKSHEET_NAME = "Work Order Print";
const ORIGINAL_ROW_COUNT = 27;
const ORIGINAL_COLUMN_COUNT = 7;
const MIN_VISIT_SLOTS = 3;
const MIN_MATERIAL_SLOTS = 4;
const MAX_DYNAMIC_SLOTS = 10000;
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PRINTER_SETTINGS_PATH = "xl/printerSettings/printerSettings1.bin";
const WORKSHEET_RELATIONSHIPS_PATH =
  "xl/worksheets/_rels/sheet1.xml.rels";
const WORKSHEET_PATH = "xl/worksheets/sheet1.xml";
const CONTENT_TYPES_PATH = "[Content_Types].xml";
const FULL_CALC_ON_LOAD_PATTERN = /<calcPr\b[^>]*fullCalcOnLoad="1"[^>]*\/>/;
const PRINTER_RELATIONSHIP_PATTERN =
  /<Relationship\b[^>]*Id="rId1"[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/printerSettings"[^>]*Target="\.\.\/printerSettings\/printerSettings1\.bin"[^>]*\/>/;
const PRINTER_CONTENT_TYPE_PATTERN =
  /<Default\s+Extension="bin"\s+ContentType="application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.printerSettings"\s*\/>/g;

const clone = (value) =>
  value && typeof value === "object" ? structuredClone(value) : value;

const isValidDate = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime());

const valueOrBlank = (value) =>
  value === undefined || value === null ? "" : value;

const joinDisplayParts = (...parts) =>
  parts
    .map((part) => (part === undefined || part === null ? "" : String(part).trim()))
    .filter(Boolean)
    .join(" — ");

const effectiveSnapshotValue = (report, field) => {
  const override = report.reportFields?.overrides?.[field];
  if (override?.isOverridden) return override.value;
  return report.jobSnapshot?.[field];
};

const toNumber = (value, label) => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new ApiError(409, `${label} contains an invalid non-negative value`);
  }
  return number;
};

const toDateOrBlank = (value, label) => {
  if (value === undefined || value === null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!isValidDate(date)) {
    throw new ApiError(409, `${label} contains an invalid date`);
  }
  return date;
};

const parseRange = (range) => {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
  if (!match || match[2] !== match[4]) {
    throw new Error(`Unsupported merge range: ${range}`);
  }
  return {
    startColumn: match[1],
    startRow: Number(match[2]),
    endColumn: match[3],
    endRow: Number(match[4]),
  };
};

const rangeWithRow = (range, row) => {
  const parsed = parseRange(range);
  return `${parsed.startColumn}${row}:${parsed.endColumn}${row}`;
};

const getMergeCells = (range) => {
  const { startColumn, startRow, endColumn, endRow } = parseRange(range);
  const columnNumber = (column) =>
    [...column].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0);
  const start = columnNumber(startColumn);
  const end = columnNumber(endColumn);
  const cells = [];
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = start; column <= end; column += 1) {
      let value = column;
      let letters = "";
      while (value > 0) {
        const remainder = (value - 1) % 26;
        letters = String.fromCharCode(65 + remainder) + letters;
        value = Math.floor((value - 1) / 26);
      }
      cells.push(`${letters}${row}`);
    }
  }
  return cells;
};

const assertNoOverlappingMerges = (ranges) => {
  const occupied = new Set();
  for (const range of ranges) {
    for (const cell of getMergeCells(range)) {
      if (occupied.has(cell)) {
        throw new Error(`Overlapping merged ranges include ${cell}`);
      }
      occupied.add(cell);
    }
  }
};

const cloneStyle = (style) => clone(style);

const snapshotWorksheet = (worksheet) => {
  const merges = [...worksheet.model.merges];
  const mergeSlaves = new Set(
    merges
      .flatMap(getMergeCells)
      .filter((address) => !merges.some((range) => range.split(":")[0] === address)),
  );
  const rows = {};

  for (let rowNumber = 1; rowNumber <= ORIGINAL_ROW_COUNT; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    rows[rowNumber] = {
      height: row.height,
      hidden: row.hidden,
      outlineLevel: row.outlineLevel,
      collapsed: row.collapsed,
      values: {},
      styles: {},
    };

    for (let columnNumber = 1; columnNumber <= ORIGINAL_COLUMN_COUNT; columnNumber += 1) {
      const cell = row.getCell(columnNumber);
      rows[rowNumber].values[cell.address] = mergeSlaves.has(cell.address)
        ? null
        : clone(cell.value);
      rows[rowNumber].styles[cell.address] = cloneStyle(cell.style);
    }
  }

  return { merges, rows };
};

const getColumnLetters = (columnNumber) => {
  let value = columnNumber;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
};

const restoreSnapshotRowByColumns = (worksheet, rowSnapshot, destinationRowNumber) => {
  const destination = worksheet.getRow(destinationRowNumber);
  destination.height = rowSnapshot.height;
  destination.hidden = rowSnapshot.hidden;
  destination.outlineLevel = rowSnapshot.outlineLevel;
  const sourceRowNumber = Number(Object.keys(rowSnapshot.values)[0].match(/\d+$/)[0]);

  for (let columnNumber = 1; columnNumber <= ORIGINAL_COLUMN_COUNT; columnNumber += 1) {
    const sourceAddress = `${getColumnLetters(columnNumber)}${sourceRowNumber}`;
    const destinationCell = destination.getCell(columnNumber);
    destinationCell.style = cloneStyle(rowSnapshot.styles[sourceAddress]);
    destinationCell.value = clone(rowSnapshot.values[sourceAddress]);
  }
};

const clearRowValues = (worksheet, rowNumber) => {
  for (let columnNumber = 1; columnNumber <= ORIGINAL_COLUMN_COUNT; columnNumber += 1) {
    worksheet.getCell(rowNumber, columnNumber).value = null;
  }
};

const buildRowDestination = (rowNumber, extraVisits, extraMaterials) => {
  if (rowNumber >= 21) return rowNumber + extraVisits + extraMaterials;
  if (rowNumber >= 14) return rowNumber + extraVisits;
  return rowNumber;
};

const recreateMerges = ({
  worksheet,
  originalMerges,
  extraVisits,
  materialHeading,
  materialHeader,
  materialFirst,
  materialSlots,
  officeHeading,
}) => {
  const relocatedMerges = originalMerges.map((merge) => {
    const { startRow } = parseRange(merge);
    return rangeWithRow(merge, buildRowDestination(startRow, extraVisits, materialSlots - MIN_MATERIAL_SLOTS));
  });
  const visitMerges = Array.from({ length: Math.max(MIN_VISIT_SLOTS, extraVisits + MIN_VISIT_SLOTS) }, (_, index) =>
    `C${11 + index}:E${11 + index}`,
  );
  const materialMerges = Array.from({ length: materialSlots }, (_, index) =>
    `B${materialFirst + index}:C${materialFirst + index}`,
  );
  const mergeRanges = [
    ...relocatedMerges,
    ...visitMerges.slice(MIN_VISIT_SLOTS),
    `A${materialHeading}:G${materialHeading}`,
    `B${materialHeader}:C${materialHeader}`,
    ...materialMerges.slice(MIN_MATERIAL_SLOTS),
    `A${officeHeading}:G${officeHeading}`,
  ];
  const uniqueMerges = [...new Set(mergeRanges)];
  assertNoOverlappingMerges(uniqueMerges);
  for (const merge of uniqueMerges) worksheet.mergeCells(merge);
  return uniqueMerges;
};

const assertReportShape = (report) => {
  if (!report || typeof report !== "object") {
    throw new ApiError(500, "Job cost report export data is invalid");
  }
  if (report.materialSnapshotStatus !== "REFRESHED" || report.materialSnapshotFresh !== true) {
    throw new ApiError(
      409,
      "Material snapshot is missing or stale; refresh materials before exporting",
    );
  }
  if (Number(report.reportFields?.gstRate) !== 18) {
    throw new ApiError(409, "Job cost report export requires an 18% GST rate");
  }
  const visits = Array.isArray(report.serviceVisits) ? report.serviceVisits : [];
  const materials = Array.isArray(report.materialSnapshot)
    ? report.materialSnapshot
    : [];
  if (visits.length > MAX_DYNAMIC_SLOTS || materials.length > MAX_DYNAMIC_SLOTS) {
    throw new ApiError(413, "Job cost report is too large for workbook export");
  }
};

const populateJobSnapshot = (worksheet, report) => {
  const snapshot = report.jobSnapshot ?? {};
  const values = {
    B4: effectiveSnapshotValue(report, "complaintNumber"),
    E4: toDateOrBlank(effectiveSnapshotValue(report, "callLogDate"), "Call-log date"),
    B5: joinDisplayParts(
      effectiveSnapshotValue(report, "bankName"),
      effectiveSnapshotValue(report, "branch"),
    ),
    E5: joinDisplayParts(
      snapshot.atmId,
      effectiveSnapshotValue(report, "atmLocationName"),
    ),
    B6: effectiveSnapshotValue(report, "complaintDescription"),
    E6: snapshot.currentStatus,
    B7: effectiveSnapshotValue(report, "assignedTechnicianName"),
    E7: effectiveSnapshotValue(report, "workType"),
  };
  for (const [address, value] of Object.entries(values)) {
    worksheet.getCell(address).value = valueOrBlank(value);
  }
};

const populateVisits = (worksheet, report) => {
  const visits = [...(report.serviceVisits ?? [])].sort(
    (left, right) => left.sequence - right.sequence,
  );
  for (const [index, visit] of visits.entries()) {
    const row = 11 + index;
    worksheet.getCell(`A${row}`).value = visit.sequence;
    worksheet.getCell(`B${row}`).value = toDateOrBlank(visit.visitDate, `Visit ${visit.sequence} date`);
    worksheet.getCell(`C${row}`).value = valueOrBlank(visit.workPerformed);
    worksheet.getCell(`F${row}`).value = valueOrBlank(visit.status);
    worksheet.getCell(`G${row}`).value = valueOrBlank(visit.signOffOrPhotoReference);
  }
};

const populateMaterials = (worksheet, report, materialFirst) => {
  for (const [index, material] of (report.materialSnapshot ?? []).entries()) {
    const row = materialFirst + index;
    const quantity = toNumber(material.quantity, `Material ${index + 1} quantity`);
    const unitCost = toNumber(material.unitCostSnapshot, `Material ${index + 1} unit cost`);
    const lineCost = toNumber(material.lineCostSnapshot, `Material ${index + 1} line cost`);
    worksheet.getCell(`B${row}`).value = valueOrBlank(material.itemNameSnapshot);
    worksheet.getCell(`D${row}`).value = `${quantity} ${material.unitSnapshot}`;
    worksheet.getCell(`E${row}`).value = unitCost;
    worksheet.getCell(`F${row}`).value = lineCost;
    worksheet.getCell(`G${row}`).value = "";
  }
};

const populateBilling = (worksheet, report, rows, materialFirst, materialSlots) => {
  const totalRow = rows.officeHeading + 1;
  const laborRow = rows.officeHeading + 2;
  const subtotalRow = rows.officeHeading + 3;
  const gstRow = rows.officeHeading + 4;
  const finalRow = rows.officeHeading + 5;
  const materialLast = materialFirst + materialSlots - 1;

  worksheet.getCell(`C${totalRow}`).value = {
    formula: `SUM(F${materialFirst}:F${materialLast})`,
  };
  worksheet.getCell(`C${laborRow}`).value = toNumber(
    report.reportFields?.serviceLaborCost,
    "Service labor cost",
  );
  worksheet.getCell(`C${subtotalRow}`).value = {
    formula: `C${totalRow}+C${laborRow}`,
  };
  worksheet.getCell(`C${gstRow}`).value = {
    formula: `C${subtotalRow}*0.18`,
  };
  worksheet.getCell(`C${finalRow}`).value = {
    formula: `C${subtotalRow}+C${gstRow}`,
  };

  worksheet.getCell(`G${totalRow}`).value = valueOrBlank(
    report.reportFields?.bankPurchaseOrderNumber,
  );
  worksheet.getCell(`G${laborRow}`).value = valueOrBlank(
    report.reportFields?.taxInvoiceNumber,
  );
  worksheet.getCell(`G${subtotalRow}`).value = `${Number(
    report.reportFields.gstRate,
  ).toFixed(2)}%`;
  worksheet.getCell(`G${gstRow}`).value = valueOrBlank(
    report.reportFields?.filingPeriod,
  );
  worksheet.getCell(`G${finalRow}`).value = valueOrBlank(
    report.reportFields?.officeBillingStatus,
  );
};

export const calculateDynamicRows = (report) => {
  const visitCount = report.serviceVisits?.length ?? 0;
  const materialCount = report.materialSnapshot?.length ?? 0;
  const visitSlots = Math.max(MIN_VISIT_SLOTS, visitCount);
  const materialSlots = Math.max(MIN_MATERIAL_SLOTS, materialCount);
  const extraVisits = visitSlots - MIN_VISIT_SLOTS;
  const extraMaterials = materialSlots - MIN_MATERIAL_SLOTS;
  const materialHeading = 15 + extraVisits;
  const materialHeader = 16 + extraVisits;
  const materialFirst = 17 + extraVisits;
  const officeHeading = 22 + extraVisits + extraMaterials;

  return {
    visitSlots,
    materialSlots,
    materialHeading,
    materialHeader,
    materialFirst,
    materialLast: materialFirst + materialSlots - 1,
    officeHeading,
    billingRows: {
      total: officeHeading + 1,
      labor: officeHeading + 2,
      subtotal: officeHeading + 3,
      gst: officeHeading + 4,
      final: officeHeading + 5,
    },
  };
};

export const buildJobCostReportWorksheet = (worksheet, report) => {
  const rows = calculateDynamicRows(report);
  const snapshot = snapshotWorksheet(worksheet);
  const originalMerges = snapshot.merges;
  const extraVisits = rows.visitSlots - MIN_VISIT_SLOTS;
  const extraMaterials = rows.materialSlots - MIN_MATERIAL_SLOTS;

  for (const merge of originalMerges) worksheet.unMergeCells(merge);
  if (extraVisits > 0) {
    worksheet.insertRows(14, Array.from({ length: extraVisits }, () => []), "n");
  }
  if (extraMaterials > 0) {
    worksheet.insertRows(
      rows.materialFirst + MIN_MATERIAL_SLOTS,
      Array.from({ length: extraMaterials }, () => []),
      "n",
    );
  }

  for (let originalRow = 1; originalRow <= ORIGINAL_ROW_COUNT; originalRow += 1) {
    restoreSnapshotRowByColumns(
      worksheet,
      snapshot.rows[originalRow],
      buildRowDestination(originalRow, extraVisits, extraMaterials),
    );
  }
  for (let row = 14; row < 14 + extraVisits; row += 1) {
    restoreSnapshotRowByColumns(worksheet, snapshot.rows[13], row);
    clearRowValues(worksheet, row);
  }
  for (
    let row = rows.materialFirst + MIN_MATERIAL_SLOTS;
    row < rows.materialFirst + rows.materialSlots;
    row += 1
  ) {
    restoreSnapshotRowByColumns(worksheet, snapshot.rows[20], row);
    clearRowValues(worksheet, row);
  }

  recreateMerges({
    worksheet,
    originalMerges,
    extraVisits,
    materialHeading: rows.materialHeading,
    materialHeader: rows.materialHeader,
    materialFirst: rows.materialFirst,
    materialSlots: rows.materialSlots,
    officeHeading: rows.officeHeading,
  });
  populateJobSnapshot(worksheet, report);
  populateVisits(worksheet, report);
  populateMaterials(worksheet, report, rows.materialFirst);
  populateBilling(worksheet, report, rows, rows.materialFirst, rows.materialSlots);

  return rows;
};

const readZipText = (zip, entryName) => {
  const entry = zip.getEntry(entryName);
  if (!entry) throw new Error(`Missing workbook entry: ${entryName}`);
  return entry.getData().toString("utf8");
};

const readZipBuffer = (zip, entryName) => {
  const entry = zip.getEntry(entryName);
  if (!entry) throw new Error(`Missing workbook entry: ${entryName}`);
  return entry.getData();
};

const assertNoDuplicateZipEntries = (zip) => {
  const names = zip.getEntries().map((entry) => entry.entryName);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate workbook entries: ${[...new Set(duplicates)].join(", ")}`);
  }
};

const relationshipTarget = (relationshipPath, target) => {
  const directory = relationshipPath.includes("/_rels/")
    ? relationshipPath.slice(0, relationshipPath.indexOf("/_rels/"))
    : "";
  return path.posix.normalize(path.posix.join(directory, target));
};

const assertNoDanglingRelationships = (zip) => {
  const entries = new Set(zip.getEntries().map((entry) => entry.entryName));
  for (const entryName of entries) {
    if (!entryName.endsWith(".rels")) continue;
    const xml = readZipText(zip, entryName);
    for (const match of xml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
      const attributes = Object.fromEntries(
        [...match[1].matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)].map((item) => [
          item[1],
          item[2],
        ]),
      );
      if (attributes.TargetMode === "External") continue;
      const target = relationshipTarget(entryName, attributes.Target);
      if (!entries.has(target)) {
        throw new Error(`Dangling relationship target: ${entryName} -> ${target}`);
      }
    }
  }
};

const patchTemplatePackage = (generatedBuffer, originalBuffer) => {
  const generatedZip = new AdmZip(generatedBuffer);
  const originalZip = new AdmZip(originalBuffer);
  assertNoDuplicateZipEntries(generatedZip);

  const sourceRelationships = readZipText(
    originalZip,
    WORKSHEET_RELATIONSHIPS_PATH,
  );
  const sourcePrinterSettings = readZipBuffer(originalZip, PRINTER_SETTINGS_PATH);
  const sourceContentTypes = readZipText(originalZip, CONTENT_TYPES_PATH);
  const sourcePrinterDeclarations =
    sourceContentTypes.match(PRINTER_CONTENT_TYPE_PATTERN) ?? [];
  if (sourcePrinterDeclarations.length !== 1) {
    throw new Error("Original printer-settings content type is not unique");
  }

  let contentTypes = readZipText(generatedZip, CONTENT_TYPES_PATH);
  const generatedDeclarations = contentTypes.match(PRINTER_CONTENT_TYPE_PATTERN) ?? [];
  if (generatedDeclarations.length > 1) {
    throw new Error("Generated printer-settings content type is duplicated");
  }
  if (generatedDeclarations.length === 0) {
    if ((contentTypes.match(/<\/Types>/g) ?? []).length !== 1) {
      throw new Error("Generated content types XML is structurally unexpected");
    }
    contentTypes = contentTypes.replace(
      "</Types>",
      `${sourcePrinterDeclarations[0]}</Types>`,
    );
  }
  if ((contentTypes.match(PRINTER_CONTENT_TYPE_PATTERN) ?? []).length !== 1) {
    throw new Error("Final printer-settings content type is not unique");
  }

  let worksheetXml = readZipText(generatedZip, WORKSHEET_PATH);
  const pageSetupMatches = worksheetXml.match(/<pageSetup\b[^>]*\/>/g) ?? [];
  if (pageSetupMatches.length !== 1) {
    throw new Error("Expected exactly one worksheet pageSetup element");
  }
  if (/\b(firstPageNumber|useFirstPageNumber)=/.test(pageSetupMatches[0])) {
    throw new Error("Unexpected page-number attributes in generated pageSetup");
  }
  if (/\br:id=/.test(pageSetupMatches[0])) {
    throw new Error("Generated pageSetup already contains a relationship id");
  }
  const patchedPageSetup = pageSetupMatches[0].replace(
    /\s*\/>$/,
    ' r:id="rId1"/>',
  );
  worksheetXml = worksheetXml.replace(pageSetupMatches[0], patchedPageSetup);

  for (const entryName of [
    CONTENT_TYPES_PATH,
    PRINTER_SETTINGS_PATH,
    WORKSHEET_RELATIONSHIPS_PATH,
    WORKSHEET_PATH,
  ]) {
    generatedZip.deleteFile(entryName);
  }
  generatedZip.addFile(CONTENT_TYPES_PATH, Buffer.from(contentTypes, "utf8"));
  generatedZip.addFile(PRINTER_SETTINGS_PATH, sourcePrinterSettings);
  generatedZip.addFile(
    WORKSHEET_RELATIONSHIPS_PATH,
    Buffer.from(sourceRelationships, "utf8"),
  );
  generatedZip.addFile(WORKSHEET_PATH, Buffer.from(worksheetXml, "utf8"));

  const output = generatedZip.toBuffer();
  const finalZip = new AdmZip(output);
  assertNoDuplicateZipEntries(finalZip);
  assertNoDanglingRelationships(finalZip);
  if (!PRINTER_RELATIONSHIP_PATTERN.test(readZipText(finalZip, WORKSHEET_RELATIONSHIPS_PATH))) {
    throw new Error("Printer-settings relationship was not restored");
  }
  if (
    crypto
      .createHash("sha256")
      .update(readZipBuffer(finalZip, PRINTER_SETTINGS_PATH))
      .digest("hex") !==
    crypto.createHash("sha256").update(sourcePrinterSettings).digest("hex")
  ) {
    throw new Error("Printer-settings binary was not preserved");
  }
  if ((readZipText(finalZip, CONTENT_TYPES_PATH).match(PRINTER_CONTENT_TYPE_PATTERN) ?? []).length !== 1) {
    throw new Error("Final printer-settings content type is not unique");
  }
  return output;
};

export const createJobCostReportWorkbook = async (report) => {
  assertReportShape(report);
  const originalBuffer = await fs.readFile(TEMPLATE_PATH);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(originalBuffer);
  const worksheet = workbook.getWorksheet(WORKSHEET_NAME);
  if (!worksheet) throw new Error(`Template worksheet '${WORKSHEET_NAME}' is missing`);

  worksheet.pageSetup.firstPageNumber = undefined;
  workbook.calcProperties.fullCalcOnLoad = true;
  const rows = buildJobCostReportWorksheet(worksheet, report);
  const generatedBuffer = await workbook.xlsx.writeBuffer();
  const patchedBuffer = patchTemplatePackage(generatedBuffer, originalBuffer);

  const validationWorkbook = new ExcelJS.Workbook();
  await validationWorkbook.xlsx.load(patchedBuffer);
  const validationWorksheet = validationWorkbook.getWorksheet(WORKSHEET_NAME);
  if (!validationWorksheet) throw new Error("Patched workbook worksheet is missing");
  if (
    JSON.stringify([...validationWorksheet.model.merges].sort()) !==
    JSON.stringify([...worksheet.model.merges].sort())
  ) {
    throw new Error("Patched workbook merged ranges do not match the generated layout");
  }
  if (
    validationWorksheet.getCell(`C${rows.billingRows.total}`).value?.formula !==
    `SUM(F${rows.materialFirst}:F${rows.materialLast})`
  ) {
    throw new Error("Patched workbook material formula is incorrect");
  }
  const finalZip = new AdmZip(patchedBuffer);
  if (finalZip.getEntry("xl/calcChain.xml")) {
    throw new Error("Stale calculation chain was unexpectedly restored");
  }
  if (!FULL_CALC_ON_LOAD_PATTERN.test(readZipText(finalZip, "xl/workbook.xml"))) {
    throw new Error("Workbook fullCalcOnLoad property is missing");
  }
  return patchedBuffer;
};

export const getJobCostReportTemplatePath = () => TEMPLATE_PATH;
export const XLSX_CONTENT_TYPE_HEADER = XLSX_CONTENT_TYPE;
