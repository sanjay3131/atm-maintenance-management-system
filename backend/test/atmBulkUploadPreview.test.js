import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { request as httpRequest } from "node:http";
import express from "express";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import ATM from "../src/modules/atms/atm.model.js";
import Bank from "../src/modules/banks/bank.model.js";
import Customer from "../src/modules/customers/customer.model.js";
import District from "../src/modules/districts/district.models.js";
import Region from "../src/modules/region/region.model.js";
import errorMiddleware from "../src/middlewares/error.middleware.js";
import {
  atmBulkUploadMiddleware,
  MAX_ATM_BULK_UPLOAD_BYTES,
} from "../src/modules/atms/atmBulkUpload.middleware.js";
import {
  parseAtmBulkUpload,
  previewAtmBulkUpload,
  resolveAtmBulkUploadRows,
} from "../src/modules/atms/atmBulkUpload.service.js";
import { createATMUploadTemplateWorkbook } from "../src/modules/atms/atmBulkUploadTemplate.service.js";

const HEADERS = [
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
const CUSTOMER_ID = "64a000000000000000000001";
const BANK_ID = "64a000000000000000000002";
const OTHER_BANK_ID = "64a000000000000000000003";
const REGION_ID = "64a000000000000000000004";
const DISTRICT_ID = "64a000000000000000000005";
const OTHER_DISTRICT_ID = "64a000000000000000000006";

const validRow = () => [
  "1",
  "00001234",
  "Example location",
  "Example city",
  "Example address",
  "ONSITE",
  "CUS-000001",
  "BANK1",
  "Central",
  "Example District",
];

const makeWorkbookBuffer = async ({
  rows = [validRow()],
  headers = HEADERS,
  uploadSheetName = "ATM Upload",
  instructionsSheetName = "Instructions",
  instructionRows = [],
} = {}) => {
  const workbook = new ExcelJS.Workbook();
  const uploadSheet = workbook.addWorksheet(uploadSheetName);
  uploadSheet.addRow(headers);
  for (const row of rows) uploadSheet.addRow(row);

  const instructions = workbook.addWorksheet(instructionsSheetName);
  for (const row of instructionRows) instructions.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

const defaultFixtures = () => ({
  ATM: [],
  Customer: [
    {
      _id: CUSTOMER_ID,
      customerCode: "CUS-000001",
      bankName: "Example Bank",
      districtIds: [DISTRICT_ID],
    },
  ],
  Bank: [{ _id: BANK_ID, bankName: "Example Bank", bankCode: "BANK1" }],
  Region: [
    {
      _id: REGION_ID,
      name: "Central",
      bankId: BANK_ID,
      isActive: true,
      geographyStatus: "MAPPED",
    },
  ],
  District: [
    {
      _id: DISTRICT_ID,
      districtNameNormalized: "example district",
      bankId: BANK_ID,
      regionId: REGION_ID,
      isActive: true,
      geographyStatus: "MAPPED",
    },
  ],
});

const mockReadModels = (
  t,
  fixtures = defaultFixtures(),
  { failModel, queryTracker } = {},
) => {
  const models = [ATM, Customer, Bank, Region, District];
  const findCalls = [];
  for (const model of models) {
    t.mock.method(model, "find", (filter) => {
      const call = { model: model.modelName, filter, session: undefined };
      findCalls.push(call);
      return {
        select() {
          return this;
        },
        session(session) {
          call.session = session;
          return this;
        },
        lean() {
          if (model === failModel) {
            return Promise.reject(new Error("mocked resolver query failure"));
          }
          const result = Promise.resolve(fixtures[model.modelName] ?? []);
          if (!queryTracker) return result;
          queryTracker.active += 1;
          queryTracker.maximum =
            Math.max(queryTracker.maximum, queryTracker.active);
          return result.finally(() => {
            queryTracker.active -= 1;
          });
        },
      };
    });
  }

  for (const [model, methods] of [
    [
      ATM,
      [
        "create",
        "insertMany",
        "updateOne",
        "updateMany",
        "findOneAndUpdate",
        "deleteOne",
        "deleteMany",
        "bulkWrite",
      ],
    ],
    [
      Customer,
      [
        "create",
        "insertMany",
        "updateOne",
        "updateMany",
        "findOneAndUpdate",
        "deleteOne",
        "deleteMany",
        "bulkWrite",
      ],
    ],
    [
      Bank,
      [
        "create",
        "insertMany",
        "updateOne",
        "updateMany",
        "findOneAndUpdate",
        "deleteOne",
        "deleteMany",
        "bulkWrite",
      ],
    ],
    [
      Region,
      [
        "create",
        "insertMany",
        "updateOne",
        "updateMany",
        "findOneAndUpdate",
        "deleteOne",
        "deleteMany",
        "bulkWrite",
      ],
    ],
    [
      District,
      [
        "create",
        "insertMany",
        "updateOne",
        "updateMany",
        "findOneAndUpdate",
        "deleteOne",
        "deleteMany",
        "bulkWrite",
      ],
    ],
  ]) {
    for (const method of methods) {
      if (typeof model[method] === "function") {
        t.mock.method(model, method, () => {
          assert.fail(`Preview must not call ${model.modelName}.${method}().`);
        });
      }
    }
  }
  return findCalls;
};

const previewWithFixtures = async (t, fixtures) => {
  mockReadModels(t, fixtures);
  return previewAtmBulkUpload(await makeWorkbookBuffer());
};

test("resolver retains IDs and propagates the session without mutating parsed rows", async (t) => {
  const queryTracker = { active: 0, maximum: 0 };
  const findCalls = mockReadModels(t, defaultFixtures(), { queryTracker });
  const rows = await parseAtmBulkUpload(await makeWorkbookBuffer());
  const originalRows = structuredClone(rows);
  const session = {};

  const resolvedRows = await resolveAtmBulkUploadRows(rows, { session });

  assert.notStrictEqual(resolvedRows, rows);
  assert.deepEqual(rows, originalRows);
  assert.deepEqual(resolvedRows[0].resolved, {
    customerId: CUSTOMER_ID,
    bankId: BANK_ID,
    regionId: REGION_ID,
    districtId: DISTRICT_ID,
  });
  assert.ok(findCalls.length > 0);
  assert.ok(findCalls.every((call) => call.session === session));
  assert.equal(queryTracker.maximum, 1);
});

test("failed resolution does not mutate parsed rows", async (t) => {
  mockReadModels(t, defaultFixtures(), { failModel: Customer });
  const invalid = validRow();
  invalid[1] = 1234;
  const rows = await parseAtmBulkUpload(
    await makeWorkbookBuffer({ rows: [invalid] }),
  );
  const originalRows = structuredClone(rows);

  await assert.rejects(
    resolveAtmBulkUploadRows(rows),
    /mocked resolver query failure/,
  );

  assert.deepEqual(rows, originalRows);
});

test("re-resolution clears stale errors and IDs while preserving parser errors", async (t) => {
  const fixtures = defaultFixtures();
  fixtures.ATM = [{ clientAtmId: "00001234", isDeleted: true }];
  mockReadModels(t, fixtures);
  const invalid = validRow();
  invalid[5] = "MOBILE";
  const parsedRows = await parseAtmBulkUpload(
    await makeWorkbookBuffer({ rows: [invalid] }),
  );
  const parserErrors = structuredClone(parsedRows[0].inputErrors);
  const firstResolution = await resolveAtmBulkUploadRows(parsedRows);

  assert.ok(firstResolution[0].resolved);
  assert.ok(firstResolution[0].errors.some((error) => /already exists/.test(error.message)));

  fixtures.ATM = [];
  fixtures.Customer = [];
  fixtures.Bank = [];
  fixtures.Region = [];
  fixtures.District = [];
  const secondResolution = await resolveAtmBulkUploadRows(firstResolution);

  assert.equal(
    secondResolution[0].errors.some((error) => /already exists/.test(error.message)),
    false,
  );
  for (const parserError of parserErrors) {
    assert.ok(secondResolution[0].errors.some(
      (error) =>
        error.field === parserError.field &&
        error.message === parserError.message,
    ));
  }
  assert.equal(Object.hasOwn(secondResolution[0], "resolved"), false);
});

const isStatus = (statusCode) => (error) =>
  error?.statusCode === statusCode;

const multipartFile = (fileBuffer, filename = "atm-upload.xlsx") => {
  const boundary = "atm-bulk-upload-test-boundary";
  return {
    boundary,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
};

const postMultipart = ({ port, boundary, body }) =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: "/upload",
        method: "POST",
        agent: false,
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": body.length,
          connection: "close",
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });

test("validates the XLSX sheet and header contract and returns accurate results", async (t) => {
  const findCalls = mockReadModels(t);
  const buffer = await makeWorkbookBuffer({
    instructionRows: [validRow()],
  });

  const result = await previewAtmBulkUpload(buffer);

  assert.deepEqual(result, {
    totalRows: 1,
    validCount: 1,
    invalidCount: 0,
    rows: [
      {
        rowNumber: 2,
        status: "valid",
        values: {
          atmId: "00001234",
          location: "Example location",
          city: "Example city",
        },
        errors: [],
      },
    ],
  });
  assert.ok(
    findCalls.some(
      (call) =>
        call.model === "Customer" &&
        call.filter.isActive === true &&
        call.filter.isDeleted === false,
    ),
  );
  assert.ok(
    findCalls.some(
      (call) =>
        call.model === "Region" &&
        call.filter.isActive === true &&
        call.filter.geographyStatus === "MAPPED",
    ),
  );
  assert.ok(
    findCalls.some(
      (call) =>
        call.model === "District" &&
        call.filter.isActive === true &&
        call.filter.geographyStatus === "MAPPED",
    ),
  );
});

test("accepts the existing template while rejecting its illustrative example rows", async (t) => {
  mockReadModels(t);
  const { buffer } = await createATMUploadTemplateWorkbook();

  const result = await previewAtmBulkUpload(buffer);

  assert.equal(result.totalRows, 2);
  assert.equal(result.validCount, 0);
  assert.equal(result.invalidCount, 2);
  assert.deepEqual(
    result.rows.map((row) => row.rowNumber),
    [2, 3],
  );
  assert.ok(result.rows.every((row) => row.status === "invalid"));
});

test("rejects malformed workbooks and a changed worksheet or header contract", async () => {
  await assert.rejects(
    previewAtmBulkUpload(Buffer.from("not an XLSX workbook")),
    isStatus(400),
  );

  const wrongHeader = await makeWorkbookBuffer({
    headers: [...HEADERS.slice(0, 9), "Unexpected"],
  });
  await assert.rejects(previewAtmBulkUpload(wrongHeader), isStatus(400));

  const wrongSheet = await makeWorkbookBuffer({
    uploadSheetName: "ATM data",
  });
  await assert.rejects(previewAtmBulkUpload(wrongSheet), isStatus(400));

  const malformedXml = new AdmZip(await makeWorkbookBuffer());
  malformedXml.updateFile(
    "xl/worksheets/sheet1.xml",
    Buffer.from("<worksheet><row></worksheet>"),
  );
  await assert.rejects(
    previewAtmBulkUpload(malformedXml.toBuffer()),
    isStatus(400),
  );
});

test("maps the 5 MiB multipart file limit to HTTP 413", async (t) => {
  assert.equal(MAX_ATM_BULK_UPLOAD_BYTES, 5 * 1024 * 1024);
  const app = express();
  app.post("/upload", atmBulkUploadMiddleware, (_req, res) => {
    res.status(204).end();
  });
  app.use(errorMiddleware);

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );

  const { boundary, body } = multipartFile(
    Buffer.alloc(MAX_ATM_BULK_UPLOAD_BYTES + 1),
  );
  const response = await postMultipart({
    port: server.address().port,
    boundary,
    body,
  });
  assert.equal(response.statusCode, 413);
  assert.match(JSON.parse(response.body).message, /5 MiB/);

  const invalidFile = multipartFile(Buffer.from("not an XLSX archive"));
  const invalidResponse = await postMultipart({
    port: server.address().port,
    ...invalidFile,
  });
  assert.equal(invalidResponse.statusCode, 400);

  const validFile = multipartFile(await makeWorkbookBuffer());
  const validResponse = await postMultipart({
    port: server.address().port,
    ...validFile,
  });
  assert.equal(validResponse.statusCode, 204);

  const wrongExtension = multipartFile(
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    "atm-upload.xls",
  );
  const wrongExtensionResponse = await postMultipart({
    port: server.address().port,
    ...wrongExtension,
  });
  assert.equal(wrongExtensionResponse.statusCode, 400);
});

test("rejects archive expansion beyond the per-entry size limit", async () => {
  const archive = new AdmZip(await makeWorkbookBuffer());
  archive.addFile(
    "xl/oversized.xml",
    Buffer.alloc(8 * 1024 * 1024 + 1, "x"),
  );

  await assert.rejects(
    previewAtmBulkUpload(archive.toBuffer()),
    isStatus(413),
  );
});

test("enforces total expansion, compression-ratio, archive-entry and worksheet-dimension limits", async () => {
  const validBuffer = await makeWorkbookBuffer();

  const repeatedContent = Buffer.alloc(300_000, "a");
  const highRatioArchive = new AdmZip(validBuffer);
  highRatioArchive.addFile("xl/repetitive.xml", repeatedContent);
  await assert.rejects(
    previewAtmBulkUpload(highRatioArchive.toBuffer()),
    isStatus(413),
  );

  const randomBlock = randomBytes(1024 * 1024);
  const expandedEntry = Buffer.concat(Array(7).fill(randomBlock));
  const expandedArchive = new AdmZip(validBuffer);
  for (let index = 0; index < 3; index += 1) {
    expandedArchive.addFile(`xl/expanded-${index}.xml`, expandedEntry);
  }
  await assert.rejects(
    previewAtmBulkUpload(expandedArchive.toBuffer()),
    isStatus(413),
  );

  const manyEntriesArchive = new AdmZip(validBuffer);
  for (let index = 0; index < 112; index += 1) {
    manyEntriesArchive.addFile(`extra/entry-${index}.xml`, Buffer.alloc(0));
  }
  await assert.rejects(
    previewAtmBulkUpload(manyEntriesArchive.toBuffer()),
    isStatus(413),
  );

  const oversizedWorksheet = new AdmZip(validBuffer);
  const worksheetXml = oversizedWorksheet.readAsText(
    "xl/worksheets/sheet1.xml",
  );
  oversizedWorksheet.updateFile(
    "xl/worksheets/sheet1.xml",
    Buffer.from(
      worksheetXml.replace(
        /<dimension ref="[^"]+"/,
        '<dimension ref="A1:K2"',
      ),
    ),
  );
  await assert.rejects(
    previewAtmBulkUpload(oversizedWorksheet.toBuffer()),
    isStatus(413),
  );
});

test("rejects more than 1,000 non-empty candidate rows", async () => {
  const buffer = await makeWorkbookBuffer({
    rows: Array.from({ length: 1001 }, (_, index) => {
      const row = validRow();
      row[0] = String(index + 1);
      row[1] = `ATM-${index + 1}`;
      return row;
    }),
  });

  await assert.rejects(previewAtmBulkUpload(buffer), isStatus(413));
});

test("skips blank rows and keeps physical Excel row numbers", async (t) => {
  mockReadModels(t);
  const buffer = await makeWorkbookBuffer({
    rows: [[], [], validRow()],
  });

  const result = await previewAtmBulkUpload(buffer);

  assert.equal(result.totalRows, 1);
  assert.equal(result.rows[0].rowNumber, 4);
});

test("requires text identifier cells, required fields and a supported installation type", async (t) => {
  mockReadModels(t);
  const numericIdentifiers = validRow();
  numericIdentifiers[1] = 1234;
  numericIdentifiers[6] = 1;
  numericIdentifiers[7] = 2;

  const missingFields = validRow();
  missingFields[1] = "ATM-2";
  missingFields[2] = " ";
  missingFields[3] = null;
  missingFields[4] = "";
  missingFields[5] = "";

  const invalidInstallationType = validRow();
  invalidInstallationType[1] = "ATM-3";
  invalidInstallationType[5] = "MOBILE";
  const buffer = await makeWorkbookBuffer({
    rows: [numericIdentifiers, missingFields, invalidInstallationType],
  });

  const result = await previewAtmBulkUpload(buffer);

  assert.deepEqual(
    result.rows[0].errors.map((error) => error.field),
    ["ATM ID", "Customer Code", "Bank Code"],
  );
  assert.deepEqual(
    result.rows[1].errors.map((error) => error.field),
    ["Location", "City", "Address", "Installation Type"],
  );
  assert.ok(
    result.rows[2].errors.some(
      (error) => error.field === "Installation Type",
    ),
  );
  assert.equal(result.totalRows, 3);
  assert.equal(result.invalidCount, 3);
});

test("rejects every in-workbook duplicate after trimming and case normalization", async (t) => {
  const findCalls = mockReadModels(t);
  const secondRow = validRow();
  secondRow[1] = " 00001234 ";
  secondRow[5] = "offsite";
  secondRow[6] = "cus-000001";
  secondRow[7] = "bank1";
  secondRow[8] = " Central ";
  secondRow[9] = " EXAMPLE DISTRICT ";
  const buffer = await makeWorkbookBuffer({ rows: [validRow(), secondRow] });

  const result = await previewAtmBulkUpload(buffer);

  assert.equal(result.validCount, 0);
  assert.equal(result.invalidCount, 2);
  for (const row of result.rows) {
    assert.ok(
      row.errors.some((error) => /more than once/.test(error.message)),
    );
    assert.equal(
      row.errors.some((error) => error.field === "Installation Type"),
      false,
    );
  }
  assert.ok(findCalls.some((call) => call.model === "ATM"));
});

test("checks existing ATM IDs without excluding soft-deleted records", async (t) => {
  const fixtures = defaultFixtures();
  fixtures.ATM = [{ clientAtmId: "00001234", isDeleted: true }];
  const findCalls = mockReadModels(t, fixtures);

  const result = await previewAtmBulkUpload(await makeWorkbookBuffer());

  assert.equal(result.rows[0].status, "invalid");
  assert.ok(result.rows[0].errors.some((error) => /already exists/.test(error.message)));
  const existingAtmQuery = findCalls.find((call) => call.model === "ATM");
  assert.deepEqual(existingAtmQuery.filter, {
    clientAtmId: { $in: ["00001234"] },
  });
  assert.equal(Object.hasOwn(existingAtmQuery.filter, "isDeleted"), false);
});

test("accepts a Customer with matching Bank and District assignments", async (t) => {
  const result = await previewWithFixtures(t, defaultFixtures());

  assert.equal(result.rows[0].status, "valid");
  assert.deepEqual(result.rows[0].errors, []);
});

test("rejects a Customer assigned to a different District", async (t) => {
  const fixtures = defaultFixtures();
  fixtures.Customer[0].districtIds = [OTHER_DISTRICT_ID];

  const result = await previewWithFixtures(t, fixtures);

  assert.equal(result.rows[0].status, "invalid");
  assert.ok(
    result.rows[0].errors.some(
      (error) =>
        error.field === "Customer Code" &&
        /not assigned to the selected district/.test(error.message),
    ),
  );
});

test("rejects a Customer with no configured District assignments", async (t) => {
  const fixtures = defaultFixtures();
  fixtures.Customer[0].districtIds = [];

  const result = await previewWithFixtures(t, fixtures);

  assert.equal(result.rows[0].status, "invalid");
  assert.ok(
    result.rows[0].errors.some(
      (error) =>
        error.field === "Customer Code" &&
        /not assigned to the selected district/.test(error.message),
    ),
  );
});

test("rejects a Customer configured for a different Bank", async (t) => {
  const fixtures = defaultFixtures();
  fixtures.Customer[0].bankName = "Other Bank";
  fixtures.Bank.push({
    _id: OTHER_BANK_ID,
    bankName: "Other Bank",
    bankCode: "BANK2",
  });

  const result = await previewWithFixtures(t, fixtures);

  assert.equal(result.rows[0].status, "invalid");
  assert.ok(
    result.rows[0].errors.some(
      (error) =>
        error.field === "Customer Code" &&
        /bank does not match/.test(error.message),
    ),
  );
});

test("requires active mapped Region records in the selected bank", async (t) => {
  const fixtures = defaultFixtures();
  fixtures.Region = [];
  mockReadModels(t, fixtures);

  const result = await previewAtmBulkUpload(await makeWorkbookBuffer());

  assert.equal(result.rows[0].status, "invalid");
  assert.ok(
    result.rows[0].errors.some((error) => error.field === "Region Name"),
  );
});

test("rejects Customer and Bank references without active matches", async (t) => {
  const fixtures = defaultFixtures();
  fixtures.Customer = [];
  fixtures.Bank = [];
  mockReadModels(t, fixtures);

  const result = await previewAtmBulkUpload(await makeWorkbookBuffer());

  assert.ok(
    result.rows[0].errors.some((error) => error.field === "Customer Code"),
  );
  assert.ok(
    result.rows[0].errors.some((error) => error.field === "Bank Code"),
  );
});

test("requires active mapped District records in the selected bank and region", async (t) => {
  const districtFixtures = defaultFixtures();
  districtFixtures.District = [];
  mockReadModels(t, districtFixtures);

  const districtResult = await previewAtmBulkUpload(await makeWorkbookBuffer());
  assert.equal(districtResult.rows[0].status, "invalid");
  assert.ok(
    districtResult.rows[0].errors.some((error) => error.field === "District Name"),
  );
});

test("returns partial row results and counts without exposing resolved record IDs", async (t) => {
  mockReadModels(t);
  const invalid = validRow();
  invalid[1] = "ATM-2";
  invalid[5] = "UNKNOWN";
  const result = await previewAtmBulkUpload(
    await makeWorkbookBuffer({ rows: [validRow(), invalid] }),
  );

  assert.equal(result.totalRows, 2);
  assert.equal(result.validCount, 1);
  assert.equal(result.invalidCount, 1);
  assert.equal(result.rows[0].status, "valid");
  assert.equal(result.rows[1].status, "invalid");
  assert.deepEqual(Object.keys(result.rows[0].values), [
    "atmId",
    "location",
    "city",
  ]);
  assert.equal(JSON.stringify(result).includes(CUSTOMER_ID), false);
  assert.equal(JSON.stringify(result).includes(BANK_ID), false);
});
