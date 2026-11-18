import assert from "node:assert/strict";
import { test } from "node:test";
import CustomerCodeSequence from "../src/modules/customers/customerCodeSequence.model.js";
import {
  CustomerCodeSequenceError,
  formatCustomerCode,
  generateCustomerCode,
} from "../src/modules/customers/customerCode.service.js";

const withSequenceStubs = async ({ findOneAndUpdate, findById }, run) => {
  const originalFindOneAndUpdate = CustomerCodeSequence.findOneAndUpdate;
  const originalFindById = CustomerCodeSequence.findById;
  CustomerCodeSequence.findOneAndUpdate = findOneAndUpdate;
  if (findById) CustomerCodeSequence.findById = findById;
  try {
    return await run();
  } finally {
    CustomerCodeSequence.findOneAndUpdate = originalFindOneAndUpdate;
    CustomerCodeSequence.findById = originalFindById;
  }
};

test("formats customer codes with a minimum of six digits", () => {
  assert.equal(formatCustomerCode(1), "CUS-000001");
  assert.equal(formatCustomerCode(999999), "CUS-999999");
  assert.equal(formatCustomerCode(1000000), "CUS-1000000");
});

test("rejects non-positive, non-integer, and unsafe sequence values", () => {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => formatCustomerCode(value),
      (error) =>
        error instanceof CustomerCodeSequenceError &&
        error.code === "CUSTOMER_CODE_SEQUENCE_INVALID",
    );
  }
});

test("allocates by atomically incrementing the fixed sequence document", async () => {
  let call;
  await withSequenceStubs(
    {
      findOneAndUpdate: async (...args) => {
        call = args;
        return { value: 42 };
      },
    },
    async () => {
      assert.equal(await generateCustomerCode(), "CUS-000042");
    },
  );

  assert.deepEqual(call, [
    {
      _id: "customerCode",
      value: { $lt: Number.MAX_SAFE_INTEGER },
    },
    { $inc: { value: 1 } },
    { new: true, upsert: false },
  ]);
});

test("fails clearly when the sequence document is missing", async () => {
  await withSequenceStubs(
    {
      findOneAndUpdate: async () => null,
      findById: async () => null,
    },
    async () => {
      await assert.rejects(
        generateCustomerCode(),
        (error) =>
          error instanceof CustomerCodeSequenceError &&
          error.code === "CUSTOMER_CODE_SEQUENCE_NOT_INITIALIZED" &&
          error.message === "Customer code sequence is not initialized",
      );
    },
  );
});

test("fails without incrementing when the sequence reaches its maximum", async () => {
  let updateCall;
  await withSequenceStubs(
    {
      findOneAndUpdate: async (...args) => {
        updateCall = args;
        return null;
      },
      findById: async () => ({ value: Number.MAX_SAFE_INTEGER }),
    },
    async () => {
      await assert.rejects(
        generateCustomerCode(),
        (error) =>
          error instanceof CustomerCodeSequenceError &&
          error.code === "CUSTOMER_CODE_SEQUENCE_EXHAUSTED" &&
          error.message === "Customer code sequence is exhausted",
      );
    },
  );

  assert.deepEqual(updateCall, [
    {
      _id: "customerCode",
      value: { $lt: Number.MAX_SAFE_INTEGER },
    },
    { $inc: { value: 1 } },
    { new: true, upsert: false },
  ]);
});

test("concurrent callers receive distinct values from atomic allocations", async () => {
  let value = 0;
  await withSequenceStubs(
    {
      findOneAndUpdate: async (filter, update, options) => {
        assert.deepEqual(filter, {
          _id: "customerCode",
          value: { $lt: Number.MAX_SAFE_INTEGER },
        });
        assert.deepEqual(update, { $inc: { value: 1 } });
        assert.equal(options.upsert, false);
        value += 1;
        return { value };
      },
    },
    async () => {
      const codes = await Promise.all(
        Array.from({ length: 20 }, () => generateCustomerCode()),
      );

      assert.equal(new Set(codes).size, 20);
      assert.deepEqual(
        [...codes].sort(),
        Array.from({ length: 20 }, (_, index) =>
          `CUS-${String(index + 1).padStart(6, "0")}`,
        ),
      );
    },
  );
});

test("sequence model relies only on MongoDB's built-in _id index", () => {
  assert.deepEqual(CustomerCodeSequence.schema.indexes(), []);
  assert.equal(
    CustomerCodeSequence.schema.options.collection,
    "customer_code_sequences",
  );
  assert.equal(CustomerCodeSequence.schema.path("_id").instance, "String");
  assert.equal(CustomerCodeSequence.schema.path("value").instance, "Number");
});
