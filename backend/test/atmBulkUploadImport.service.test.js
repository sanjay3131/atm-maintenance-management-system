import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import ATMIdSequence from "../src/modules/atms/atmIdSequence.model.js";
import ATMBulkUploadImport from "../src/modules/atms/atmBulkUploadImport.model.js";
import { importAtmBulkUpload } from "../src/modules/atms/atmBulkUploadImport.service.js";
import Bank from "../src/modules/banks/bank.model.js";
import Customer from "../src/modules/customers/customer.model.js";
import District from "../src/modules/districts/district.models.js";
import Region from "../src/modules/region/region.model.js";

const ACTOR_ID = "64a000000000000000000001";
const CUSTOMER_ID = "64a000000000000000000002";
const BANK_ID = "64a000000000000000000003";
const REGION_ID = "64a000000000000000000004";
const DISTRICT_ID = "64a000000000000000000005";
const IDEMPOTENCY_KEY = "atm-import-test-key";
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

const uploadRow = (clientAtmId, installationType = "ONSITE") => [
  "1",
  clientAtmId,
  "Import location",
  "Import city",
  "Import address",
  installationType,
  "CUS-000001",
  "BANK1",
  "Central",
  "Example District",
];

const workbookBuffer = async (rows = [uploadRow("CLIENT-0001")]) => {
  const workbook = new ExcelJS.Workbook();
  const uploadSheet = workbook.addWorksheet("ATM Upload");
  uploadSheet.addRow(HEADERS);
  rows.forEach((row) => uploadSheet.addRow(row));
  workbook.addWorksheet("Instructions");
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sameId = (left, right) => String(left) === String(right);

const createHarness = (
  t,
  {
    failStage,
    duplicateReceiptOnCreate = false,
    unknownCommitOnce = false,
    retryTransientOnce = false,
    initialReceipts = [],
    preflightWinner = null,
  } = {},
) => {
  const customerId = new mongoose.Types.ObjectId(CUSTOMER_ID);
  const bankId = new mongoose.Types.ObjectId(BANK_ID);
  const regionId = new mongoose.Types.ObjectId(REGION_ID);
  const districtId = new mongoose.Types.ObjectId(DISTRICT_ID);
  const state = {
    inTransaction: false,
    transactionAttempts: 0,
    sequenceValue: 0,
    fenceWrites: 0,
    bankFenceWrites: 0,
    fenceOrder: [],
    insertedATMs: [],
    customerAtmIds: new Map([[CUSTOMER_ID, []]]),
    receipts: [...initialReceipts],
    concurrentWinner: null,
    preflightWinner,
    readCalls: [],
    sequenceOptions: null,
    districtOptions: [],
    atmInsertOptions: null,
    customerWriteOptions: null,
    customerWriteOperations: null,
    receiptCreateOptions: null,
    receiptCreateCalls: 0,
    atmInsertCalls: 0,
    failure: failStage ? new Error(`mocked ${failStage} failure`) : null,
    failStage,
    duplicateReceiptOnCreate,
    unknownCommitOnce,
    retryTransientOnce,
    nextDocumentId: 20,
  };

  const customers = [
    {
      _id: customerId,
      customerCode: "CUS-000001",
      bankName: "Example Bank",
      serviceDistrictIds: [districtId],
      isActive: true,
      isDeleted: false,
    },
  ];
  const banks = [
    {
      _id: bankId,
      bankName: "Example Bank",
      bankCode: "BANK1",
      isActive: true,
    },
  ];
  const regions = [
    {
      _id: regionId,
      name: "Central",
      bankId,
      isActive: true,
      geographyStatus: "MAPPED",
    },
  ];
  const districts = [
    {
      _id: districtId,
      districtNameNormalized: "example district",
      bankId,
      regionId,
      isActive: true,
      geographyStatus: "MAPPED",
    },
  ];

  const matches = (values, value) =>
    Array.isArray(values) && values.some((candidate) => sameId(candidate, value));
  const findDocuments = (model, filter) => {
    if (model === Customer) {
      return customers.filter(
        (customer) =>
          matches(filter.customerCode?.$in, customer.customerCode) &&
          filter.isActive === true &&
          filter.isDeleted === false,
      );
    }
    if (model === Bank) {
      if (filter.bankCode?.$in) {
        return banks.filter(
          (bank) =>
            matches(filter.bankCode.$in, bank.bankCode) &&
            bank.isActive === true,
        );
      }
      return banks.filter(
        (bank) =>
          bank.isActive === true &&
          filter.$or?.some(
            (clause) =>
              matches(clause.bankName?.$in, bank.bankName) ||
              matches(clause.bankCode?.$in, bank.bankCode),
          ),
      );
    }
    if (model === ATM) {
      if (state.preflightWinner) {
        state.concurrentWinner = state.preflightWinner;
        state.preflightWinner = null;
        return [{ clientAtmId: "CLIENT-0001" }];
      }
      return [];
    }
    if (model === Region) {
      return regions.filter(
        (region) =>
          matches(filter.name?.$in, region.name) &&
          matches(filter.bankId?.$in, region.bankId) &&
          filter.isActive === true &&
          filter.geographyStatus === "MAPPED",
      );
    }
    if (model === District) {
      return districts.filter(
        (district) =>
          matches(
            filter.districtNameNormalized?.$in,
            district.districtNameNormalized,
          ) &&
          matches(filter.bankId?.$in, district.bankId) &&
          matches(filter.regionId?.$in, district.regionId) &&
          filter.isActive === true &&
          filter.geographyStatus === "MAPPED",
      );
    }
    return [];
  };

  for (const model of [ATM, Customer, Bank, Region, District]) {
    t.mock.method(model, "find", (filter) => {
      const call = { model, filter, session: undefined };
      state.readCalls.push(call);
      return {
        select() {
          return this;
        },
        session(session) {
          call.session = session;
          return this;
        },
        lean() {
          return Promise.resolve(findDocuments(model, filter));
        },
      };
    });
  }

  const takeSnapshot = () => ({
    sequenceValue: state.sequenceValue,
    fenceWrites: state.fenceWrites,
    bankFenceWrites: state.bankFenceWrites,
    fenceOrder: [...state.fenceOrder],
    insertedATMs: [...state.insertedATMs],
    customerAtmIds: new Map(
      [...state.customerAtmIds].map(([id, atmIds]) => [id, [...atmIds]]),
    ),
    receipts: [...state.receipts],
  });
  const restoreSnapshot = (snapshot) => {
    state.sequenceValue = snapshot.sequenceValue;
    state.fenceWrites = snapshot.fenceWrites;
    state.bankFenceWrites = snapshot.bankFenceWrites;
    state.fenceOrder = snapshot.fenceOrder;
    state.insertedATMs = snapshot.insertedATMs;
    state.customerAtmIds = snapshot.customerAtmIds;
    state.receipts = snapshot.receipts;
  };

  const session = {
    inTransaction: () => state.inTransaction,
    async withTransaction(operation) {
      let attempt = 0;
      while (true) {
        const snapshot = takeSnapshot();
        state.inTransaction = true;
        state.transactionAttempts += 1;
        try {
          const result = await operation(this);
          if (state.unknownCommitOnce) {
            state.unknownCommitOnce = false;
            restoreSnapshot(snapshot);
            const error = new Error("unknown transaction commit result");
            error.errorLabels = ["UnknownTransactionCommitResult"];
            throw error;
          }
          state.inTransaction = false;
          return result;
        } catch (error) {
          restoreSnapshot(snapshot);
          state.inTransaction = false;
          if (
            state.retryTransientOnce &&
            attempt === 0 &&
            error.errorLabels?.includes("TransientTransactionError")
          ) {
            state.retryTransientOnce = false;
            attempt += 1;
            continue;
          }
          throw error;
        }
      }
    },
    async endSession() {},
  };
  state.session = session;
  t.mock.method(mongoose, "startSession", async () => session);

  t.mock.method(Bank, "updateOne", async (_filter, _update, options) => {
    assert.strictEqual(options.session, state.session);
    state.bankFenceWrites += 1;
    state.fenceOrder.push("bank");
    return { matchedCount: 1 };
  });

  t.mock.method(District, "updateOne", async (_filter, _update, options) => {
    state.districtOptions.push(options);
    state.fenceWrites += 1;
    state.fenceOrder.push("district");
    if (state.failStage === "fence") throw state.failure;
    return { matchedCount: 1 };
  });

  t.mock.method(
    ATMIdSequence,
    "findOneAndUpdate",
    async (_filter, update, options) => {
      state.sequenceOptions = options;
      state.sequenceValue += update.$inc.value;
      if (state.failStage === "sequence") throw state.failure;
      return { value: state.sequenceValue };
    },
  );

  t.mock.method(ATM, "insertMany", async (documents, options) => {
    state.atmInsertCalls += 1;
    state.atmInsertOptions = options;
    const created = documents.map((document) => ({
      ...document,
      _id: new mongoose.Types.ObjectId(
        (state.nextDocumentId++).toString(16).padStart(24, "0"),
      ),
    }));
    state.insertedATMs.push(...created);
    if (state.failStage === "atm") throw state.failure;
    if (state.retryTransientOnce && state.atmInsertCalls === 1) {
      const error = new Error("transient transaction failure");
      error.errorLabels = ["TransientTransactionError"];
      throw error;
    }
    return created;
  });

  t.mock.method(Customer, "bulkWrite", async (operations, options) => {
    state.customerWriteOptions = options;
    state.customerWriteOperations = operations;
    let matchedCount = 0;
    for (const { updateOne } of operations) {
      const customerKey = String(updateOne.filter._id);
      const atmIds = state.customerAtmIds.get(customerKey);
      if (
        !atmIds ||
        updateOne.filter.isActive !== true ||
        updateOne.filter.isDeleted !== false
      ) {
        continue;
      }
      matchedCount += 1;
      for (const atmId of updateOne.update.$addToSet.atmIds.$each) {
        if (!atmIds.some((existingId) => sameId(existingId, atmId))) {
          atmIds.push(atmId);
        }
      }
    }
    if (state.failStage === "customer") throw state.failure;
    return { matchedCount, modifiedCount: matchedCount };
  });

  t.mock.method(ATMBulkUploadImport, "findOne", (filter) => ({
    lean() {
      const receipt =
        state.concurrentWinner ??
        state.receipts.find(
          (candidate) =>
            sameId(candidate.actorId, filter.actorId) &&
            candidate.idempotencyKeyHash === filter.idempotencyKeyHash,
        ) ??
        null;
      return Promise.resolve(receipt);
    },
  }));

  t.mock.method(ATMBulkUploadImport, "create", async (documents, options) => {
    state.receiptCreateCalls += 1;
    state.receiptCreateOptions = options;
    if (state.duplicateReceiptOnCreate) {
      state.concurrentWinner = {
        ...documents[0],
        result: { ...documents[0].result },
      };
      const error = new Error("duplicate import receipt");
      error.code = 11000;
      error.keyPattern = { actorId: 1, idempotencyKeyHash: 1 };
      throw error;
    }
    const receipts = documents.map((document) => ({
      ...document,
      result: { ...document.result },
    }));
    state.receipts.push(...receipts);
    if (state.failStage === "receipt") throw state.failure;
    return receipts;
  });

  return state;
};

const invokeImport = (buffer) =>
  importAtmBulkUpload({
    buffer,
    actorId: ACTOR_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
  });

test("imports every valid row atomically with the same transaction session", async (t) => {
  const state = createHarness(t);
  const buffer = await workbookBuffer([
    uploadRow("CLIENT-0001"),
    uploadRow("CLIENT-0002"),
  ]);

  const result = await invokeImport(buffer);

  assert.deepEqual(result, { totalRows: 2, createdCount: 2 });
  assert.equal(state.sequenceValue, 2);
  assert.equal(state.insertedATMs.length, 2);
  assert.deepEqual(
    state.insertedATMs.map((atm) => atm.atmId),
    ["ATM0001", "ATM0002"],
  );
  assert.ok(state.insertedATMs.every((atm) => atm.assignedEmployeeId.length === 0));
  assert.strictEqual(state.sequenceOptions.session, state.session);
  assert.strictEqual(state.atmInsertOptions.session, state.session);
  assert.equal(state.atmInsertOptions.ordered, true);
  assert.strictEqual(state.customerWriteOptions.session, state.session);
  assert.strictEqual(state.receiptCreateOptions.session, state.session);
  assert.ok(state.districtOptions.every((options) => options.session === state.session));
  assert.ok(
    state.readCalls
      .filter((call) => call.session)
      .every((call) => call.session === state.session),
  );
  assert.equal(state.customerWriteOperations.length, 1);
  assert.deepEqual(
    state.customerAtmIds.get(CUSTOMER_ID).map(String),
    state.insertedATMs.map((atm) => String(atm._id)),
  );
  assert.deepEqual(state.receipts[0].result, result);
  assert.equal(state.transactionAttempts, 1);
  assert.equal(state.bankFenceWrites, 1);
  assert.deepEqual(state.fenceOrder, ["bank", "district"]);
});

test("one invalid row blocks the entire import before transaction writes", async (t) => {
  const state = createHarness(t);
  const buffer = await workbookBuffer([
    uploadRow("CLIENT-0001"),
    uploadRow("CLIENT-0002", "MOBILE"),
  ]);

  await assert.rejects(
    invokeImport(buffer),
    (error) =>
      error.statusCode === 400 &&
      error.errors.some((entry) => entry.field === "Installation Type"),
  );

  assert.equal(state.fenceWrites, 0);
  assert.equal(state.bankFenceWrites, 0);
  assert.equal(state.sequenceValue, 0);
  assert.equal(state.insertedATMs.length, 0);
  assert.equal(state.customerWriteOperations, null);
  assert.equal(state.receipts.length, 0);
});

test("write-stage failures propagate and transaction state rolls back", async (t) => {
  for (const stage of ["fence", "sequence", "atm", "customer", "receipt"]) {
    await t.test(stage, async (subtest) => {
      const state = createHarness(subtest, { failStage: stage });
      const buffer = await workbookBuffer([
        uploadRow("CLIENT-0001"),
        uploadRow("CLIENT-0002"),
      ]);

      await assert.rejects(
        invokeImport(buffer),
        (error) => error === state.failure,
      );

      assert.equal(state.sequenceValue, 0);
      assert.equal(state.fenceWrites, 0);
      assert.equal(state.bankFenceWrites, 0);
      assert.equal(state.insertedATMs.length, 0);
      assert.deepEqual(state.customerAtmIds.get(CUSTOMER_ID), []);
      assert.equal(state.receipts.length, 0);
    });
  }
});

test("replays the stored counts for the same key and workbook", async (t) => {
  const buffer = await workbookBuffer([
    uploadRow("CLIENT-0001"),
    uploadRow("CLIENT-0002"),
  ]);
  const receipt = {
    actorId: new mongoose.Types.ObjectId(ACTOR_ID),
    idempotencyKeyHash: sha256(IDEMPOTENCY_KEY),
    workbookSha256: sha256(buffer),
    result: { totalRows: 2, createdCount: 2 },
  };
  const state = createHarness(t, { initialReceipts: [receipt] });

  assert.deepEqual(await invokeImport(buffer), receipt.result);
  assert.equal(state.transactionAttempts, 0);
  assert.equal(state.sequenceValue, 0);
  assert.equal(state.receiptCreateCalls, 0);
});

test("conflicts when a key is reused for a different workbook", async (t) => {
  const firstBuffer = await workbookBuffer([uploadRow("CLIENT-0001")]);
  const secondBuffer = await workbookBuffer([uploadRow("CLIENT-0002")]);
  const receipt = {
    actorId: new mongoose.Types.ObjectId(ACTOR_ID),
    idempotencyKeyHash: sha256(IDEMPOTENCY_KEY),
    workbookSha256: sha256(firstBuffer),
    result: { totalRows: 1, createdCount: 1 },
  };
  createHarness(t, { initialReceipts: [receipt] });

  await assert.rejects(
    invokeImport(secondBuffer),
    (error) =>
      error.statusCode === 409 &&
      /different workbook/.test(error.message),
  );
});

test("reads and replays the winning receipt after a concurrent duplicate-key race", async (t) => {
  const state = createHarness(t, { duplicateReceiptOnCreate: true });
  const buffer = await workbookBuffer([
    uploadRow("CLIENT-0001"),
    uploadRow("CLIENT-0002"),
  ]);

  assert.deepEqual(await invokeImport(buffer), {
    totalRows: 2,
    createdCount: 2,
  });
  assert.equal(state.receiptCreateCalls, 1);
  assert.equal(state.sequenceValue, 0);
  assert.equal(state.insertedATMs.length, 0);
  assert.equal(state.receipts.length, 0);
  assert.ok(state.concurrentWinner);
});

test("replays a winner committed during preliminary duplicate resolution", async (t) => {
  const buffer = await workbookBuffer([uploadRow("CLIENT-0001")]);
  const winner = {
    actorId: new mongoose.Types.ObjectId(ACTOR_ID),
    idempotencyKeyHash: sha256(IDEMPOTENCY_KEY),
    workbookSha256: sha256(buffer),
    result: { totalRows: 1, createdCount: 1 },
  };
  const state = createHarness(t, { preflightWinner: winner });

  assert.deepEqual(await invokeImport(buffer), winner.result);
  assert.equal(state.transactionAttempts, 0);
  assert.equal(state.sequenceValue, 0);
  assert.equal(state.receiptCreateCalls, 0);
});

test("does not report success when an unknown transaction outcome has no receipt", async (t) => {
  const state = createHarness(t, { unknownCommitOnce: true });
  const buffer = await workbookBuffer();

  await assert.rejects(
    invokeImport(buffer),
    (error) =>
      error.statusCode === 503 &&
      /same idempotency key/.test(error.message),
  );

  assert.equal(state.sequenceValue, 0);
  assert.equal(state.insertedATMs.length, 0);
  assert.equal(state.receipts.length, 0);
});

test("transaction callback retries do not create duplicate logical imports", async (t) => {
  const state = createHarness(t, { retryTransientOnce: true });
  const buffer = await workbookBuffer([
    uploadRow("CLIENT-0001"),
    uploadRow("CLIENT-0002"),
  ]);

  assert.deepEqual(await invokeImport(buffer), {
    totalRows: 2,
    createdCount: 2,
  });
  assert.equal(state.transactionAttempts, 2);
  assert.equal(state.atmInsertCalls, 2);
  assert.equal(state.sequenceValue, 2);
  assert.equal(state.insertedATMs.length, 2);
  assert.equal(state.customerAtmIds.get(CUSTOMER_ID).length, 2);
  assert.equal(state.receipts.length, 1);
});
