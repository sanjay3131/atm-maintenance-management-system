import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CUSTOMER_CODE_SEQUENCE_CONFIRMATION,
  CustomerCodeSequenceInitializationError,
  initializeCustomerCodeSequence,
  validateInitializationArguments,
} from "../scripts/initializeCustomerCodeSequence.js";

const cursorFor = (documents) => ({
  async *[Symbol.asyncIterator]() {
    for (const document of documents) yield structuredClone(document);
  },
});

const createCollections = ({ customers = [], sequence = null } = {}) => {
  const state = {
    customers: structuredClone(customers),
    sequence: structuredClone(sequence),
    inserts: [],
  };

  return {
    state,
    customerCollection: {
      countDocuments: async () => state.customers.length,
      find: (filter, options) => {
        assert.deepEqual(filter, {});
        assert.deepEqual(options, {
          projection: { _id: 1, customerCode: 1 },
        });
        return cursorFor(state.customers);
      },
    },
    sequenceCollection: {
      findOne: async (filter) => {
        assert.deepEqual(filter, { _id: "customerCode" });
        return structuredClone(state.sequence);
      },
      insertOne: async (document) => {
        state.inserts.push(structuredClone(document));
        if (state.sequence) {
          const error = new Error("duplicate sequence key");
          error.code = 11000;
          throw error;
        }
        state.sequence = structuredClone(document);
        return { acknowledged: true };
      },
    },
  };
};

const initialize = (collections) =>
  initializeCustomerCodeSequence({
    customerCollection: collections.customerCollection,
    sequenceCollection: collections.sequenceCollection,
  });

test("requires explicit database target, confirmation, and paused customer writes", () => {
  const input = {
    env: {
      MONGODB_URL: "mongodb://localhost:27017/atm_test",
      MONGODB_EXPECTED_DATABASE: "atm_test",
    },
    targetDatabase: "atm_test",
    confirmation: CUSTOMER_CODE_SEQUENCE_CONFIRMATION,
    customerWritesPaused: true,
  };

  assert.equal(validateInitializationArguments(input), "atm_test");
  assert.throws(
    () =>
      validateInitializationArguments({
        ...input,
        customerWritesPaused: false,
      }),
    /Customer writes must be paused/,
  );
  assert.throws(
    () =>
      validateInitializationArguments({
        ...input,
        targetDatabase: "other",
      }),
    /must exactly match MONGODB_EXPECTED_DATABASE/,
  );
});

test("inserts zero only for an empty customer collection and verifies it", async () => {
  const collections = createCollections();

  const result = await initialize(collections);

  assert.deepEqual(result, {
    status: "initialized",
    value: 0,
    customerCount: 0,
  });
  assert.deepEqual(collections.state.inserts, [
    { _id: "customerCode", value: 0 },
  ]);
  assert.deepEqual(collections.state.sequence, {
    _id: "customerCode",
    value: 0,
  });
});

test("does not initialize when customer documents already exist", async () => {
  const collections = createCollections({
    customers: [{ _id: "customer-1" }],
  });

  await assert.rejects(
    initialize(collections),
    (error) =>
      error instanceof CustomerCodeSequenceInitializationError &&
      error.code === "CUSTOMER_CODES_REQUIRE_REVIEW",
  );
  assert.deepEqual(collections.state.inserts, []);
  assert.equal(collections.state.sequence, null);
});

test("preserves a valid existing sequence and safely handles a rerun", async () => {
  const collections = createCollections({
    customers: [{ _id: "customer-1", customerCode: "CUS-000042" }],
    sequence: { _id: "customerCode", value: 42 },
  });

  const result = await initialize(collections);

  assert.deepEqual(result, {
    status: "already-initialized",
    value: 42,
    customerCount: 1,
  });
  assert.deepEqual(collections.state.inserts, []);
  assert.equal(collections.state.sequence.value, 42);
});

test("aborts when existing codes are malformed, duplicated, or missing", async () => {
  const customers = [
    { _id: "customer-1", customerCode: "CUS-000007" },
    { _id: "customer-2", customerCode: "not-a-code" },
    { _id: "customer-3", customerCode: "CUS-000007" },
    { _id: "customer-4" },
  ];
  const collections = createCollections({
    customers,
    sequence: { _id: "customerCode", value: 7 },
  });

  await assert.rejects(
    initialize(collections),
    (error) =>
      error instanceof CustomerCodeSequenceInitializationError &&
      error.code === "CUSTOMER_CODES_REQUIRE_REVIEW" &&
      error.details.missing.length === 1 &&
      error.details.malformed.length === 1 &&
      error.details.duplicates.length === 1,
  );
  assert.deepEqual(collections.state.inserts, []);
  assert.equal(collections.state.sequence.value, 7);
});

test("treats a zero customer code suffix as requiring manual review", async () => {
  const collections = createCollections({
    customers: [{ _id: "customer-1", customerCode: "CUS-000000" }],
    sequence: { _id: "customerCode", value: 0 },
  });

  await assert.rejects(
    initialize(collections),
    (error) =>
      error instanceof CustomerCodeSequenceInitializationError &&
      error.code === "CUSTOMER_CODES_REQUIRE_REVIEW" &&
      error.details.malformed[0].customerCode === "CUS-000000",
  );
  assert.deepEqual(collections.state.inserts, []);
  assert.equal(collections.state.sequence.value, 0);
});

test("accepts the maximum safe integer customer-code suffix", async () => {
  const customerCode = `CUS-${Number.MAX_SAFE_INTEGER}`;
  const collections = createCollections({
    customers: [{ _id: "customer-1", customerCode }],
    sequence: {
      _id: "customerCode",
      value: Number.MAX_SAFE_INTEGER,
    },
  });

  const result = await initialize(collections);

  assert.deepEqual(result, {
    status: "already-initialized",
    value: Number.MAX_SAFE_INTEGER,
    customerCount: 1,
  });
});

test("rejects customer codes with a trailing newline or an unsafe suffix", async (t) => {
  const invalidCodes = [
    "CUS-000001\n",
    `CUS-${BigInt(Number.MAX_SAFE_INTEGER) + 1n}`,
  ];

  for (const customerCode of invalidCodes) {
    await t.test(JSON.stringify(customerCode), async () => {
      const collections = createCollections({
        customers: [{ _id: "customer-1", customerCode }],
        sequence: { _id: "customerCode", value: 1 },
      });

      await assert.rejects(
        initialize(collections),
        (error) =>
          error instanceof CustomerCodeSequenceInitializationError &&
          error.code === "CUSTOMER_CODES_REQUIRE_REVIEW" &&
          error.details.malformed[0].customerCode === customerCode,
      );
    });
  }
});

test("aborts without repairing a sequence behind existing codes", async () => {
  const collections = createCollections({
    customers: [{ _id: "customer-1", customerCode: "CUS-000043" }],
    sequence: { _id: "customerCode", value: 42 },
  });

  await assert.rejects(
    initialize(collections),
    (error) =>
      error instanceof CustomerCodeSequenceInitializationError &&
      error.code === "CUSTOMER_CODE_SEQUENCE_BEHIND",
  );
  assert.deepEqual(collections.state.inserts, []);
  assert.equal(collections.state.sequence.value, 42);
});

test("recovers from an insert race without replacing the sequence", async () => {
  const collections = createCollections();
  collections.sequenceCollection.insertOne = async (document) => {
    collections.state.sequence = { ...document, value: 3 };
    const error = new Error("duplicate sequence key");
    error.code = 11000;
    throw error;
  };

  const result = await initialize(collections);

  assert.deepEqual(result, {
    status: "already-initialized",
    value: 3,
    customerCount: 0,
  });
  assert.equal(collections.state.sequence.value, 3);
});
