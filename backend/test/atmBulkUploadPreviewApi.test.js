import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import ATMIdSequence from "../src/modules/atms/atmIdSequence.model.js";
import ATMBulkUploadImport from "../src/modules/atms/atmBulkUploadImport.model.js";
import Bank from "../src/modules/banks/bank.model.js";
import Customer from "../src/modules/customers/customer.model.js";
import District from "../src/modules/districts/district.models.js";
import Region from "../src/modules/region/region.model.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";
import {
  handleATMUploadImportError,
  handleATMUploadPreviewError,
  importATMUpload,
  previewATMUpload,
} from "../src/modules/atms/atmBulkUpload.controller.js";
import { atmBulkUploadMiddleware } from "../src/modules/atms/atmBulkUpload.middleware.js";
import atmRouter from "../src/modules/atms/atm.routes.js";

const CUSTOMER_ID = "64a000000000000000000001";
const BANK_ID = "64a000000000000000000002";
const REGION_ID = "64a000000000000000000003";
const DISTRICT_ID = "64a000000000000000000004";
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

const row = (atmId, installationType = "ONSITE") => [
  "1",
  atmId,
  "Main branch",
  "Example city",
  "Example address",
  installationType,
  "CUS-000001",
  "BANK1",
  "Central",
  "West District",
];

const makeWorkbookBuffer = async (rows = [row("00001234")]) => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("ATM Upload").addRow(HEADERS);
  const uploadSheet = workbook.getWorksheet("ATM Upload");
  for (const value of rows) uploadSheet.addRow(value);
  workbook.addWorksheet("Instructions");
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

const modelFixtures = () => ({
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
      districtNameNormalized: "west district",
      bankId: BANK_ID,
      regionId: REGION_ID,
      isActive: true,
      geographyStatus: "MAPPED",
    },
  ],
});

const mockModels = (t, { fixtures = modelFixtures(), failATMRead = false } = {}) => {
  const models = [ATM, Customer, Bank, Region, District];
  for (const model of models) {
    t.mock.method(model, "find", () => ({
      select() {
        return this;
      },
      lean() {
        if (model === ATM && failATMRead) {
          return Promise.reject(new Error("private database connection detail"));
        }
        return Promise.resolve(fixtures[model.modelName] ?? []);
      },
    }));
  }

  const writeMethods = [
    "create",
    "insertMany",
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "deleteOne",
    "deleteMany",
    "bulkWrite",
  ];
  for (const model of models) {
    for (const method of writeMethods) {
      if (typeof model[method] === "function") {
        t.mock.method(model, method, () => {
          assert.fail(`Preview must not call ${model.modelName}.${method}().`);
        });
      }
    }
  }
};

const invokePreview = (req) =>
  new Promise((resolve, reject) => {
    const res = {
      headersSent: false,
      statusCode: undefined,
      payload: undefined,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        this.payload = payload;
        resolve({ statusCode: this.statusCode, payload });
        return this;
      },
    };
    const next = (error) => {
      if (!error) {
        reject(new Error("Preview continued without returning a response."));
        return;
      }
      handleATMUploadPreviewError(error, req, res, reject);
    };

    previewATMUpload(req, res, next);
  });

const invokeImport = (req) =>
  new Promise((resolve, reject) => {
    const res = {
      headersSent: false,
      statusCode: undefined,
      payload: undefined,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        this.payload = payload;
        resolve({ statusCode: this.statusCode, payload });
        return this;
      },
    };
    const next = (error) => {
      if (!error) {
        reject(new Error("Import continued without returning a response."));
        return;
      }
      handleATMUploadImportError(error, req, res, reject);
    };

    importATMUpload(req, res, next);
  });

const makeImportRequest = (options = {}) => {
  const { buffer } = options;
  const idempotencyKey = Object.hasOwn(options, "idempotencyKey")
    ? options.idempotencyKey
    : "api-import-key";
  return {
    file: buffer ? { buffer } : undefined,
    user: { _id: new mongoose.Types.ObjectId(CUSTOMER_ID) },
    get(name) {
      return name.toLowerCase() === "idempotency-key"
        ? idempotencyKey
        : undefined;
    },
  };
};

const mockImportDependencies = (t, { unknownFenceOutcome = false } = {}) => {
  const fixtures = modelFixtures();
  const state = {
    receipts: [],
    sequenceValue: 0,
    transactionCalls: 0,
    receiptCreateCalls: 0,
    atmInsertCalls: 0,
    customerWriteCalls: 0,
  };
  const session = {
    active: false,
    inTransaction() {
      return this.active;
    },
    async withTransaction(operation) {
      state.transactionCalls += 1;
      this.active = true;
      try {
        return await operation(this);
      } finally {
        this.active = false;
      }
    },
    async endSession() {},
  };

  t.mock.method(mongoose, "startSession", async () => session);
  for (const model of [ATM, Customer, Bank, Region, District]) {
    t.mock.method(model, "find", () => ({
      select() {
        return this;
      },
      session() {
        return this;
      },
      lean() {
        return Promise.resolve(fixtures[model.modelName] ?? []);
      },
    }));
  }
  t.mock.method(District, "updateOne", async () => {
    if (unknownFenceOutcome) {
      const error = new Error("unknown transaction outcome");
      error.errorLabels = ["UnknownTransactionCommitResult"];
      throw error;
    }
    return { matchedCount: 1 };
  });
  t.mock.method(ATMIdSequence, "findOneAndUpdate", async (_filter, update) => {
    state.sequenceValue += update.$inc.value;
    return { value: state.sequenceValue };
  });
  t.mock.method(ATM, "insertMany", async (documents) => {
    state.atmInsertCalls += 1;
    return documents.map((document) => ({
      ...document,
      _id: new mongoose.Types.ObjectId(),
    }));
  });
  t.mock.method(Customer, "bulkWrite", async (operations) => {
    state.customerWriteCalls += 1;
    return { matchedCount: operations.length, modifiedCount: operations.length };
  });
  t.mock.method(ATMBulkUploadImport, "findOne", (filter) => ({
    lean() {
      return Promise.resolve(
        state.receipts.find(
          (receipt) =>
            String(receipt.actorId) === String(filter.actorId) &&
            receipt.idempotencyKeyHash === filter.idempotencyKeyHash,
        ) ?? null,
      );
    },
  }));
  t.mock.method(ATMBulkUploadImport, "create", async (documents) => {
    state.receiptCreateCalls += 1;
    const receipts = documents.map((document) => ({
      ...document,
      result: { ...document.result },
    }));
    state.receipts.push(...receipts);
    return receipts;
  });

  return state;
};

test("registers the protected preview route with the required middleware order", (t) => {
  t.mock.method(console, "log", () => {});
  const routeLayer = atmRouter.stack.find(
    (layer) => layer.route?.path === "/bulk-upload/preview",
  );
  assert.ok(routeLayer);
  assert.equal(routeLayer.route.methods.post, true);
  assert.equal(routeLayer.route.stack.length, 4);
  assert.equal(routeLayer.route.stack[0].handle, verifyAccessToken);
  assert.equal(routeLayer.route.stack[2].handle, atmBulkUploadMiddleware);
  assert.equal(routeLayer.route.stack[3].handle, previewATMUpload);

  const roleGate = routeLayer.route.stack[1].handle;
  for (const role of ["admin", "superAdmin"]) {
    let authorized = false;
    roleGate({ user: { userType: role } }, {}, () => {
      authorized = true;
    });
    assert.equal(authorized, true);
  }
  assert.throws(() =>
    roleGate({ user: { userType: "employee" } }, {}, () => {}),
  );
  assert.throws(() => roleGate({}, {}, () => {}));

  const routeIndex = atmRouter.stack.indexOf(routeLayer);
  const firstParameterizedRouteIndex = atmRouter.stack.findIndex(
    (layer, index) => index > routeIndex && layer.route?.path.includes(":"),
  );
  assert.ok(
    firstParameterizedRouteIndex === -1 || routeIndex < firstParameterizedRouteIndex,
  );
});

test("registers the protected import route for administrators only", (t) => {
  t.mock.method(console, "log", () => {});
  const routeLayer = atmRouter.stack.find(
    (layer) => layer.route?.path === "/bulk-upload/import",
  );
  assert.ok(routeLayer);
  assert.equal(routeLayer.route.methods.post, true);
  assert.equal(routeLayer.route.stack.length, 4);
  assert.equal(routeLayer.route.stack[0].handle, verifyAccessToken);
  assert.equal(routeLayer.route.stack[2].handle, atmBulkUploadMiddleware);
  assert.equal(routeLayer.route.stack[3].handle, importATMUpload);

  const roleGate = routeLayer.route.stack[1].handle;
  for (const role of ["admin", "superAdmin"]) {
    let authorized = false;
    roleGate({ user: { userType: role } }, {}, () => {
      authorized = true;
    });
    assert.equal(authorized, true);
  }
  for (const role of ["employee", "customer", "supervisor"]) {
    assert.throws(() =>
      roleGate({ user: { userType: role } }, {}, () => {}),
    );
  }
  assert.throws(() => roleGate({}, {}, () => {}));
});

test("rejects missing and invalid Idempotency-Key headers before importing", async () => {
  const buffer = await makeWorkbookBuffer();
  for (const idempotencyKey of [undefined, "", "   ", "k".repeat(257)]) {
    const response = await invokeImport(
      makeImportRequest({ buffer, idempotencyKey }),
    );
    assert.equal(response.statusCode, 400);
    assert.match(response.payload.message, /Idempotency-Key/);
  }
});

test("rejects missing and malformed import files", async (t) => {
  const missingFile = await invokeImport(makeImportRequest({}));
  assert.equal(missingFile.statusCode, 400);
  assert.match(missingFile.payload.message, /XLSX file is required/);

  mockImportDependencies(t);
  const malformedFile = await invokeImport(
    makeImportRequest({ buffer: Buffer.from("not an XLSX workbook") }),
  );
  assert.equal(malformedFile.statusCode, 400);
  assert.match(malformedFile.payload.message, /XLSX/);
});

test("returns counts for a valid import and the same-key replay", async (t) => {
  const state = mockImportDependencies(t);
  const buffer = await makeWorkbookBuffer([row("CLIENT-0001")]);
  const req = makeImportRequest({ buffer });

  const firstResponse = await invokeImport(req);
  const replayResponse = await invokeImport(req);

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(firstResponse.payload.success, true);
  assert.deepEqual(firstResponse.payload.data, {
    totalRows: 1,
    createdCount: 1,
  });
  assert.deepEqual(replayResponse.payload.data, firstResponse.payload.data);
  assert.equal(state.transactionCalls, 1);
  assert.equal(state.receiptCreateCalls, 1);
});

test("maps idempotency conflicts to HTTP 409", async (t) => {
  const state = mockImportDependencies(t);
  const firstBuffer = await makeWorkbookBuffer([row("CLIENT-0001")]);
  const secondBuffer = await makeWorkbookBuffer([row("CLIENT-0002")]);

  await invokeImport(makeImportRequest({ buffer: firstBuffer }));
  const conflict = await invokeImport(
    makeImportRequest({ buffer: secondBuffer }),
  );
  assert.equal(conflict.statusCode, 409);
  assert.match(conflict.payload.message, /different workbook/);
  assert.equal(state.transactionCalls, 1);
});

test("maps an unconfirmed transaction outcome to retryable HTTP 503", async (t) => {
  const state = mockImportDependencies(t, { unknownFenceOutcome: true });
  const buffer = await makeWorkbookBuffer([row("CLIENT-0001")]);
  const retryable = await invokeImport(makeImportRequest({
    buffer,
    idempotencyKey: "retry-key",
  }));
  assert.equal(state.transactionCalls, 1);
  assert.equal(retryable.statusCode, 503);
  assert.match(retryable.payload.message, /same idempotency key/);
});

test("sanitizes unexpected import errors", (t) => {
  t.mock.method(console, "error", () => {});
  const req = {};
  const res = {
    headersSent: false,
    statusCode: undefined,
    payload: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  handleATMUploadImportError(
    new Error("private import database detail"),
    req,
    res,
    assert.fail,
  );

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.payload, {
    success: false,
    message: "Unable to import ATM upload.",
    errors: [],
  });
});

test("returns a clear client error when the file is missing", async () => {
  const response = await invokePreview({ file: undefined });

  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.success, false);
  assert.match(response.payload.message, /XLSX file is required/);
  assert.equal(Object.hasOwn(response.payload, "stack"), false);
});

test("returns a successful preview with partial validation results", async (t) => {
  mockModels(t);
  const buffer = await makeWorkbookBuffer([
    row("00001234"),
    row("ATM-2", "MOBILE"),
  ]);
  const response = await invokePreview({ file: { buffer } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.data.totalRows, 2);
  assert.equal(response.payload.data.validCount, 1);
  assert.equal(response.payload.data.invalidCount, 1);
  assert.equal(response.payload.data.rows[0].status, "valid");
  assert.equal(response.payload.data.rows[1].status, "invalid");
  assert.equal(JSON.stringify(response.payload).includes(CUSTOMER_ID), false);
  assert.equal(JSON.stringify(response.payload).includes(BANK_ID), false);
});

test("returns a sanitized client error for malformed workbooks", async () => {
  const response = await invokePreview({
    file: { buffer: Buffer.from("not an XLSX workbook") },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.success, false);
  assert.match(response.payload.message, /XLSX/);
  assert.equal(Object.hasOwn(response.payload, "stack"), false);
});

test("maps upload and resource-size errors to sanitized HTTP 413 responses", async (t) => {
  const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1);
  const oversizedResponse = await invokePreview({
    file: { buffer: oversizedBuffer },
  });
  assert.equal(oversizedResponse.statusCode, 413);
  assert.equal(Object.hasOwn(oversizedResponse.payload, "stack"), false);

  const res = {
    statusCode: undefined,
    payload: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  handleATMUploadPreviewError(
    { code: "LIMIT_FILE_SIZE", message: "do not reveal this" },
    {},
    res,
    assert.fail,
  );
  assert.equal(res.statusCode, 413);
  assert.match(res.payload.message, /5 MiB/);
  assert.equal(res.payload.message.includes("do not reveal"), false);
  assert.equal(Object.hasOwn(res.payload, "stack"), false);
});

test("sanitizes unexpected preview service and database failures", async (t) => {
  mockModels(t, { failATMRead: true });
  t.mock.method(console, "error", () => {});
  const response = await invokePreview({
    file: { buffer: await makeWorkbookBuffer() },
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.payload, {
    success: false,
    message: "Unable to process ATM upload preview.",
    errors: [],
  });
  assert.equal(JSON.stringify(response.payload).includes("private database"), false);
  assert.equal(Object.hasOwn(response.payload, "stack"), false);
});
