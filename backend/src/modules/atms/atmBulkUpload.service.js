import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import { inflateRawSync } from "node:zlib";
import ATM from "./atm.model.js";
import Bank from "../banks/bank.model.js";
import Customer from "../customers/customer.model.js";
import District from "../districts/district.models.js";
import { normalizeDistrictName } from "../districts/districtNormalization.js";
import Region from "../region/region.model.js";
import { createAtmSchema } from "./atm.validation.js";
import ApiError from "../../utils/ApiError.js";

export const MAX_ATM_BULK_UPLOAD_ROWS = 1000;

const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 128;
const MAX_ARCHIVE_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES = 20 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;
const MAX_WORKSHEET_ROWS = 10_000;
const MAX_WORKSHEET_COLUMNS = 10;
const MAX_WORKSHEET_CELLS = 12_000;
const MAX_SHARED_STRINGS = 12_000;
const XLSX_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const REQUIRED_ARCHIVE_ENTRIES = [
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
];
const WORKSHEET_NAME = "ATM Upload";
const WORKSHEET_HEADERS = [
  "S.No",
  "ATM ID",
  "Location",
  "City",
  "Address",
  "Installation Type",
  "Customer Code",
  "Bank Code",
  "Region Name",
  "District Name",
];

const invalidWorkbook = (message = "The uploaded XLSX workbook is invalid.") =>
  new ApiError(400, message);
const exceededLimit = (message) => new ApiError(413, message);

const findEndOfCentralDirectory = (buffer) => {
  const firstPossibleOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= firstPossibleOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  throw invalidWorkbook("The uploaded file is not a valid XLSX archive.");
};

const validateZipContainer = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_ARCHIVE_BYTES) {
    throw exceededLimit("The uploaded file exceeds the 5 MiB limit.");
  }
  if (
    buffer.length < 22 ||
    buffer.length < XLSX_SIGNATURE.length ||
    !buffer.subarray(0, XLSX_SIGNATURE.length).equals(XLSX_SIGNATURE)
  ) {
    throw invalidWorkbook("The uploaded file is not a valid XLSX archive.");
  }

  const endOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(endOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(endOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(endOffset + 8);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw invalidWorkbook("Multi-disk and ZIP64 archives are not supported.");
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw exceededLimit("The workbook contains too many archive entries.");
  }
  if (
    centralDirectoryOffset + centralDirectorySize > endOffset ||
    centralDirectoryOffset + centralDirectorySize < centralDirectoryOffset
  ) {
    throw invalidWorkbook("The XLSX archive directory is malformed.");
  }

  return { centralDirectoryOffset, entryCount };
};

const safeArchiveEntryName = (name) => {
  if (
    typeof name !== "string" ||
    !name ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.split("/").some((part) => part === "." || part === "..") ||
    /^[a-z]:/i.test(name)
  ) {
    throw invalidWorkbook("The XLSX archive contains an invalid entry path.");
  }
};

const columnNumber = (letters) => {
  let number = 0;
  for (const letter of letters.toUpperCase()) {
    number = number * 26 + letter.charCodeAt(0) - 64;
  }
  return number;
};

const validateWorksheetXml = (name, xml) => {
  const dimension = xml.match(/<dimension\b[^>]*\bref="([^"]+)"/i);
  if (dimension) {
    for (const cellReference of dimension[1].split(":")) {
      const match = cellReference.match(/^([A-Z]+)(\d+)$/i);
      if (
        !match ||
        columnNumber(match[1]) > MAX_WORKSHEET_COLUMNS ||
        Number(match[2]) > MAX_WORKSHEET_ROWS
      ) {
        throw exceededLimit("The worksheet dimensions exceed the supported limits.");
      }
    }
  }

  let rowCount = 0;
  for (const match of xml.matchAll(/<row\b([^>]*)>/gi)) {
    rowCount += 1;
    const rowNumber = match[1].match(/\br="(\d+)"/i);
    if (rowNumber && Number(rowNumber[1]) > MAX_WORKSHEET_ROWS) {
      throw exceededLimit("The worksheet dimensions exceed the supported limits.");
    }
  }
  if (rowCount > MAX_WORKSHEET_ROWS) {
    throw exceededLimit("The worksheet contains too many rows.");
  }

  let cellCount = 0;
  for (const match of xml.matchAll(/<c\b([^>]*)>/gi)) {
    cellCount += 1;
    const cellReference = match[1].match(/\br="([A-Z]+)(\d+)"/i);
    if (
      cellReference &&
      (columnNumber(cellReference[1]) > MAX_WORKSHEET_COLUMNS ||
        Number(cellReference[2]) > MAX_WORKSHEET_ROWS)
    ) {
      throw exceededLimit("The worksheet dimensions exceed the supported limits.");
    }
  }
  if (cellCount > MAX_WORKSHEET_CELLS) {
    throw exceededLimit("The worksheet contains too many cells.");
  }

  if (name === "xl/sharedStrings.xml") {
    const sharedStringCount = [...xml.matchAll(/<si(?:\s|>)/gi)].length;
    if (sharedStringCount > MAX_SHARED_STRINGS) {
      throw exceededLimit("The workbook contains too many shared strings.");
    }
  }
};

const inspectXmlEntry = (name, data) => {
  let xml;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw invalidWorkbook("The XLSX archive contains invalid XML text.");
  }

  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) {
    throw invalidWorkbook("XML declarations with external entities are not supported.");
  }

  if (
    name === "[Content_Types].xml" &&
    /macroEnabled|vbaProject/i.test(xml)
  ) {
    throw invalidWorkbook("Macro-enabled workbooks are not supported.");
  }

  if (name.startsWith("xl/worksheets/") && name.endsWith(".xml")) {
    validateWorksheetXml(name, xml);
  } else if (name === "xl/sharedStrings.xml") {
    validateWorksheetXml(name, xml);
  }
};

const preflightXlsxArchive = (buffer) => {
  const { centralDirectoryOffset, entryCount } = validateZipContainer(buffer);
  let archive;
  try {
    archive = new AdmZip(buffer);
  } catch {
    throw invalidWorkbook("The uploaded file is not a valid XLSX archive.");
  }

  let entries;
  try {
    entries = archive.getEntries();
  } catch {
    throw invalidWorkbook("The XLSX archive directory is malformed.");
  }
  if (entries.length !== entryCount) {
    throw invalidWorkbook("The XLSX archive directory is malformed.");
  }
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw exceededLimit("The workbook contains too many archive entries.");
  }

  const entryNames = new Set();
  const extents = [];
  let declaredExpandedBytes = 0;
  let actualExpandedBytes = 0;
  for (const entry of entries) {
    const name = entry.entryName;
    safeArchiveEntryName(name);
    if (entryNames.has(name)) {
      throw invalidWorkbook("The XLSX archive contains duplicate entries.");
    }
    entryNames.add(name);

    const header = entry.header;
    const compressedSize = header.compressedSize;
    const declaredSize = header.size;
    if (
      !Number.isSafeInteger(compressedSize) ||
      !Number.isSafeInteger(declaredSize) ||
      compressedSize < 0 ||
      declaredSize < 0
    ) {
      throw invalidWorkbook("The XLSX archive contains invalid entry sizes.");
    }
    if (declaredSize > MAX_ARCHIVE_ENTRY_BYTES) {
      throw exceededLimit("An XLSX archive entry exceeds the supported size.");
    }
    declaredExpandedBytes += declaredSize;
    if (declaredExpandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw exceededLimit("The expanded XLSX archive exceeds the supported size.");
    }
    if (
      declaredSize > 0 &&
      (compressedSize === 0 || declaredSize / compressedSize > MAX_COMPRESSION_RATIO)
    ) {
      throw exceededLimit("The XLSX archive has an excessive compression ratio.");
    }
    if (header.encrypted) {
      throw invalidWorkbook("Encrypted XLSX archives are not supported.");
    }
    if (![0, 8].includes(header.method)) {
      throw invalidWorkbook("The XLSX archive uses an unsupported compression method.");
    }

    const localHeaderOffset = header.offset;
    if (
      !Number.isSafeInteger(localHeaderOffset) ||
      localHeaderOffset < 0 ||
      localHeaderOffset + 30 > centralDirectoryOffset
    ) {
      throw invalidWorkbook("The XLSX archive contains an invalid local entry.");
    }

    let boundedData;
    try {
      header.loadLocalHeaderFromBinary(buffer);
      const dataOffset = header.realDataOffset;
      const dataEnd = dataOffset + compressedSize;
      if (
        !Number.isSafeInteger(dataOffset) ||
        dataOffset < localHeaderOffset + 30 ||
        dataEnd < dataOffset ||
        dataEnd > centralDirectoryOffset
      ) {
        throw invalidWorkbook("The XLSX archive contains an invalid local entry.");
      }
      extents.push({ start: localHeaderOffset, end: dataEnd });
      const compressedData = buffer.subarray(dataOffset, dataEnd);
      if (compressedSize === 0 && declaredSize === 0) {
        boundedData = Buffer.alloc(0);
      } else if (header.method === 8) {
        boundedData = inflateRawSync(compressedData, {
          maxOutputLength: MAX_ARCHIVE_ENTRY_BYTES + 1,
        });
      } else {
        boundedData = compressedData;
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.code === "ERR_BUFFER_TOO_LARGE") {
        throw exceededLimit("An XLSX archive entry exceeds the supported size.");
      }
      throw invalidWorkbook("The XLSX archive contains a malformed entry.");
    }

    if (boundedData.length > MAX_ARCHIVE_ENTRY_BYTES) {
      throw exceededLimit("An XLSX archive entry exceeds the supported size.");
    }
    actualExpandedBytes += boundedData.length;
    if (actualExpandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw exceededLimit("The expanded XLSX archive exceeds the supported size.");
    }
    if (boundedData.length !== declaredSize) {
      throw invalidWorkbook("The XLSX archive contains inconsistent entry sizes.");
    }
    if (
      boundedData.length > 0 &&
      boundedData.length / compressedSize > MAX_COMPRESSION_RATIO
    ) {
      throw exceededLimit("The XLSX archive has an excessive compression ratio.");
    }

    let verifiedData;
    try {
      verifiedData = entry.getData();
    } catch {
      throw invalidWorkbook("The XLSX archive contains a corrupt entry.");
    }
    if (
      !Buffer.isBuffer(verifiedData) ||
      verifiedData.length !== boundedData.length ||
      !verifiedData.equals(boundedData)
    ) {
      throw invalidWorkbook("The XLSX archive contains a corrupt entry.");
    }

    if (name.endsWith(".xml") || name.endsWith(".rels")) {
      inspectXmlEntry(name, boundedData);
    }
  }

  extents.sort((left, right) => left.start - right.start);
  for (let index = 1; index < extents.length; index += 1) {
    if (extents[index].start < extents[index - 1].end) {
      throw invalidWorkbook("The XLSX archive contains overlapping entries.");
    }
  }

  for (const requiredEntry of REQUIRED_ARCHIVE_ENTRIES) {
    if (!entryNames.has(requiredEntry)) {
      throw invalidWorkbook("The uploaded file is not a supported XLSX workbook.");
    }
  }
  if (![...entryNames].some((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))) {
    throw invalidWorkbook("The XLSX archive does not contain a worksheet.");
  }
  if ([...entryNames].some((name) => name.endsWith(".bin"))) {
    throw invalidWorkbook("Binary workbook content is not supported.");
  }
};

const runFind = async (model, filter, projection, session) => {
  let query = model.find(filter);
  if (projection && typeof query.select === "function") {
    query = query.select(projection);
  }
  if (session) {
    if (typeof query.session !== "function") {
      throw new TypeError("The bulk-upload resolver query does not support MongoDB sessions.");
    }
    query = query.session(session);
  }
  if (typeof query.lean === "function") query = query.lean();
  return query;
};

const normalizedId = (value) => String(value?._id ?? value).toLowerCase();
const addError = (row, field, message) => {
  if (!row.errors.some((error) => error.field === field && error.message === message)) {
    row.errors.push({ field, message });
  }
};

const previewCellValue = (cell) => {
  if (typeof cell.value === "string") return cell.value.trim();
  if (typeof cell.value === "number" || typeof cell.value === "boolean") {
    return String(cell.value);
  }
  return typeof cell.text === "string" ? cell.text.trim() : "";
};

const readRequiredText = (
  cell,
  row,
  field,
  { normalize = (value) => value, emptyMessage = `${field} is required.` } = {},
) => {
  if (cell.value === null || cell.value === undefined) {
    addError(row, field, emptyMessage);
    return null;
  }
  if (
    cell.type !== ExcelJS.ValueType.String ||
    typeof cell.value !== "string"
  ) {
    const message =
      field === "ATM ID"
        ? "ATM ID must be entered as text so leading zeros are preserved."
        : `${field} must be entered as text.`;
    addError(row, field, message);
    return null;
  }

  const value = cell.value.trim();
  if (!value) {
    addError(row, field, emptyMessage);
    return null;
  }
  return normalize(value);
};

const readRow = (worksheetRow) => {
  const row = { rowNumber: worksheetRow.number, errors: [] };
  const cells = WORKSHEET_HEADERS.map((_, index) =>
    worksheetRow.getCell(index + 1),
  );
  const isBlank = cells.every(
    (cell) =>
      cell.value === null ||
      cell.value === undefined ||
      (typeof cell.value === "string" && !cell.value.trim()),
  );
  if (isBlank) return null;

  row.previewValues = {
    atmId: previewCellValue(cells[1]),
    location: previewCellValue(cells[2]),
    city: previewCellValue(cells[3]),
  };
  row.clientAtmId = readRequiredText(cells[1], row, "ATM ID", {
    normalize: (value) => value.toUpperCase(),
  });
  row.locationName = readRequiredText(cells[2], row, "Location");
  row.city = readRequiredText(cells[3], row, "City");
  row.address = readRequiredText(cells[4], row, "Address");
  row.installationType = readRequiredText(cells[5], row, "Installation Type", {
    normalize: (value) => value.toUpperCase(),
  });
  row.customerCode = readRequiredText(cells[6], row, "Customer Code", {
    normalize: (value) => value.toUpperCase(),
  });
  row.bankCode = readRequiredText(cells[7], row, "Bank Code", {
    normalize: (value) => value.toUpperCase(),
  });
  row.regionName = readRequiredText(cells[8], row, "Region Name");
  row.districtName = readRequiredText(cells[9], row, "District Name", {
    normalize: normalizeDistrictName,
  });

  if (
    row.installationType &&
    !["ONSITE", "OFFSITE"].includes(row.installationType)
  ) {
    addError(row, "Installation Type", "Installation Type must be ONSITE or OFFSITE.");
  }
  row.inputErrors = row.errors.map((error) => ({ ...error }));
  return row;
};

const addSchemaErrors = (row, values) => {
  const result = createAtmSchema.safeParse(values);
  if (result.success) return;

  const fieldNames = {
    clientAtmId: "ATM ID",
    bankId: "Bank Code",
    customerId: "Customer Code",
    districtId: "District Name",
    regionId: "Region Name",
    locationName: "Location",
    city: "City",
    address: "Address",
    installationType: "Installation Type",
  };
  for (const issue of result.error.issues) {
    const field = fieldNames[issue.path[0]] ?? "Row";
    addError(row, field, issue.message);
  }
};

const loadWorkbook = async (buffer) => {
  preflightXlsxArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw invalidWorkbook("The XLSX workbook contains malformed XML or workbook data.");
  }
  const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
  if (
    sheetNames.length !== 2 ||
    sheetNames[0] !== WORKSHEET_NAME ||
    sheetNames[1] !== "Instructions"
  ) {
    throw invalidWorkbook(
      'The workbook must contain "ATM Upload" followed by "Instructions".',
    );
  }

  const worksheet = workbook.getWorksheet(WORKSHEET_NAME);
  const headers = WORKSHEET_HEADERS.map(
    (_, index) => worksheet.getRow(1).getCell(index + 1).value,
  );
  if (
    headers.some((header, index) => header !== WORKSHEET_HEADERS[index]) ||
    worksheet.getRow(1).cellCount !== WORKSHEET_HEADERS.length
  ) {
    throw invalidWorkbook("The ATM Upload worksheet headers do not match the required contract.");
  }
  return worksheet;
};

const findMapValue = (map, key) => (key ? map.get(key) : undefined);

const addExistingDuplicateErrors = (rows, existingAtms) => {
  const existingIds = new Set(
    existingAtms.map((atm) => String(atm.clientAtmId).trim().toUpperCase()),
  );
  for (const row of rows) {
    if (row.clientAtmId && existingIds.has(row.clientAtmId)) {
      addError(row, "ATM ID", "An ATM with this ATM ID already exists.");
    }
  }
};

export const resolveAtmBulkUploadRows = async (inputRows, { session } = {}) => {
  const rows = inputRows.map((row) => {
    const inputErrors = row.inputErrors.map((error) => ({ ...error }));
    const resolvedRow = {
      ...row,
      inputErrors,
      errors: inputErrors.map((error) => ({ ...error })),
    };
    delete resolvedRow.resolved;
    return resolvedRow;
  });

  if (!rows.length) return rows;

  const clientAtmIds = [...new Set(rows.map((row) => row.clientAtmId).filter(Boolean))];
  const customerCodes = [...new Set(rows.map((row) => row.customerCode).filter(Boolean))];
  const bankCodes = [...new Set(rows.map((row) => row.bankCode).filter(Boolean))];

  const findCustomers = () =>
    customerCodes.length
      ? runFind(
          Customer,
          {
            customerCode: { $in: customerCodes },
            isActive: true,
            isDeleted: false,
          },
          "_id customerCode bankName districtIds",
          session,
        )
      : [];
  const findBanks = () =>
    bankCodes.length
      ? runFind(
          Bank,
          { bankCode: { $in: bankCodes }, isActive: true },
          "_id bankName bankCode",
          session,
        )
      : [];
  const findExistingATMs = () =>
    clientAtmIds.length
      ? runFind(
          ATM,
          { clientAtmId: { $in: clientAtmIds } },
          "clientAtmId",
          session,
        )
      : [];

  let customers;
  let banks;
  let existingAtms;
  if (session) {
    customers = await findCustomers();
    banks = await findBanks();
    existingAtms = await findExistingATMs();
  } else {
    [customers, banks, existingAtms] = await Promise.all([
      findCustomers(),
      findBanks(),
      findExistingATMs(),
    ]);
  }

  const customerByCode = new Map(
    customers.map((customer) => [String(customer.customerCode).toUpperCase(), customer]),
  );
  const bankByCode = new Map(
    banks.map((bank) => [String(bank.bankCode).toUpperCase(), bank]),
  );
  const customerBankReferences = [
    ...new Set(
      customers
        .map((customer) =>
          typeof customer.bankName === "string" ? customer.bankName.trim() : "",
        )
        .filter(Boolean),
    ),
  ];
  const activeCustomerBanks = customerBankReferences.length
    ? await runFind(
        Bank,
        {
          isActive: true,
          $or: [
            { bankName: { $in: customerBankReferences } },
            { bankCode: { $in: customerBankReferences } },
          ],
        },
        "_id bankName bankCode",
        session,
      )
    : [];
  const regions = await runFind(
    Region,
    {
      name: { $in: [...new Set(rows.map((row) => row.regionName).filter(Boolean))] },
      bankId: { $in: banks.map((bank) => bank._id) },
      isActive: true,
      geographyStatus: "MAPPED",
    },
    "_id name bankId isActive geographyStatus",
    session,
  );
  const districts = await runFind(
    District,
    {
      districtNameNormalized: {
        $in: [...new Set(rows.map((row) => row.districtName).filter(Boolean))],
      },
      bankId: { $in: banks.map((bank) => bank._id) },
      regionId: { $in: regions.map((region) => region._id) },
      isActive: true,
      geographyStatus: "MAPPED",
    },
    "_id districtNameNormalized bankId regionId isActive geographyStatus",
    session,
  );

  const duplicateRows = new Map();
  for (const row of rows) {
    if (!row.clientAtmId) continue;
    const matchingRows = duplicateRows.get(row.clientAtmId) ?? [];
    matchingRows.push(row);
    duplicateRows.set(row.clientAtmId, matchingRows);
  }
  for (const matchingRows of duplicateRows.values()) {
    if (matchingRows.length > 1) {
      for (const row of matchingRows) {
        addError(
          row,
          "ATM ID",
          "This ATM ID appears more than once in the workbook; all occurrences are rejected.",
        );
      }
    }
  }
  addExistingDuplicateErrors(rows, existingAtms);

  for (const row of rows) {
    const customer = findMapValue(customerByCode, row.customerCode);
    const bank = findMapValue(bankByCode, row.bankCode);
    let region;
    let district;

    if (row.customerCode && !customer) {
      addError(row, "Customer Code", "No active customer matches this code.");
    }
    if (row.bankCode && !bank) {
      addError(row, "Bank Code", "No active bank matches this code.");
    }
    if (row.regionName && bank) {
      region = regions.find(
        (candidate) =>
          candidate.name === row.regionName &&
          normalizedId(candidate.bankId) === normalizedId(bank._id),
      );
      if (!region) {
        addError(
          row,
          "Region Name",
          "No active mapped region with this name belongs to the selected bank.",
        );
      }
    }
    if (row.districtName && bank && region) {
      district = districts.find(
        (candidate) =>
          candidate.districtNameNormalized === row.districtName &&
          normalizedId(candidate.bankId) === normalizedId(bank._id) &&
          normalizedId(candidate.regionId) === normalizedId(region._id),
      );
      if (!district) {
        addError(
          row,
          "District Name",
          "No active mapped district with this name belongs to the selected bank and region.",
        );
      }
    } else if (row.districtName && bank && !region) {
      addError(
        row,
        "District Name",
        "The district cannot be resolved until its selected region is valid.",
      );
    }

    if (customer && bank) {
      const configuredBank = activeCustomerBanks.find(
        (candidate) =>
          candidate.bankName === customer.bankName ||
          candidate.bankCode === customer.bankName,
      );
      if (!configuredBank) {
        addError(
          row,
          "Customer Code",
          "The customer must be configured for an active bank.",
        );
      } else if (normalizedId(configuredBank._id) !== normalizedId(bank._id)) {
        addError(
          row,
          "Customer Code",
          "The customer's configured bank does not match the selected bank.",
        );
      }
    }
    if (customer && district) {
      const customerDistrictIds = Array.isArray(customer.districtIds)
        ? customer.districtIds
        : [];
      if (
        !customerDistrictIds.some(
          (districtId) =>
            normalizedId(districtId) === normalizedId(district._id),
        )
      ) {
        addError(
          row,
          "Customer Code",
          "The customer is not assigned to the selected district.",
        );
      }
    }

    if (customer && bank && region && district) {
      row.resolved = {
        customerId: customer._id,
        bankId: bank._id,
        regionId: region._id,
        districtId: district._id,
      };
    }

    if (
      row.errors.length === 0 &&
      customer &&
      bank &&
      region &&
      district
    ) {
      addSchemaErrors(row, {
        clientAtmId: row.clientAtmId,
        bankId: String(bank._id),
        customerId: String(customer._id),
        districtId: String(district._id),
        regionId: String(region._id),
        locationName: row.locationName,
        city: row.city,
        address: row.address,
        installationType: row.installationType,
      });
    }
  }
  return rows;
};

export const parseAtmBulkUpload = async (buffer) => {
  if (!Buffer.isBuffer(buffer)) {
    throw invalidWorkbook("An XLSX workbook buffer is required.");
  }
  if (buffer.length > MAX_ARCHIVE_BYTES) {
    throw exceededLimit("The uploaded file exceeds the 5 MiB limit.");
  }

  const worksheet = await loadWorkbook(buffer);
  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = readRow(worksheet.getRow(rowNumber));
    if (row) rows.push(row);
    if (rows.length > MAX_ATM_BULK_UPLOAD_ROWS) {
      throw exceededLimit("The workbook may contain no more than 1,000 non-empty data rows.");
    }
  }

  return rows;
};

export const previewAtmBulkUpload = async (buffer) => {
  const parsedRows = await parseAtmBulkUpload(buffer);
  const rows = await resolveAtmBulkUploadRows(parsedRows);
  const results = rows.map((row) => ({
    rowNumber: row.rowNumber,
    status: row.errors.length ? "invalid" : "valid",
    values: row.previewValues,
    errors: row.errors,
  }));
  const validCount = results.filter((row) => row.status === "valid").length;

  return {
    totalRows: results.length,
    validCount,
    invalidCount: results.length - validCount,
    rows: results,
  };
};
