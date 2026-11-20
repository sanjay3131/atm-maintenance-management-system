import assert from "node:assert/strict";
import { test } from "node:test";
import ATM from "../src/modules/atms/atm.model.js";
import ATMIdSequence from "../src/modules/atms/atmIdSequence.model.js";
import {
  ATMIdSequenceError,
  formatATMId,
  generateATMId,
  reserveATMIds,
} from "../src/modules/atms/atm.utils.js";

const withSequenceStubs = async (
  { findOneAndUpdate, findOne },
  run,
) => {
  const originalFindOneAndUpdate = ATMIdSequence.findOneAndUpdate;
  const originalFindOne = ATMIdSequence.findOne;
  ATMIdSequence.findOneAndUpdate = findOneAndUpdate;
  if (findOne) ATMIdSequence.findOne = findOne;
  try {
    return await run();
  } finally {
    ATMIdSequence.findOneAndUpdate = originalFindOneAndUpdate;
    ATMIdSequence.findOne = originalFindOne;
  }
};

test("formats ATM IDs with at least four digits", () => {
  assert.equal(formatATMId(1), "ATM0001");
  assert.equal(formatATMId(9999), "ATM9999");
  assert.equal(formatATMId(10000), "ATM10000");
});

test("rejects invalid reservation counts and formatted values", async () => {
  for (const count of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      reserveATMIds(count),
      (error) =>
        error instanceof ATMIdSequenceError &&
        error.code === "ATM_ID_SEQUENCE_INVALID_COUNT",
    );
  }

  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => formatATMId(value),
      (error) =>
        error instanceof ATMIdSequenceError &&
        error.code === "ATM_ID_SEQUENCE_INVALID",
    );
  }
});

test("rejects reservations over 1000 before database operations", async () => {
  let updateCalls = 0;
  let lookupCalls = 0;

  await withSequenceStubs(
    {
      findOneAndUpdate: async () => {
        updateCalls += 1;
        return null;
      },
      findOne: async () => {
        lookupCalls += 1;
        return null;
      },
    },
    async () => {
      await assert.rejects(
        reserveATMIds(1001),
        (error) =>
          error instanceof ATMIdSequenceError &&
          error.code === "ATM_ID_SEQUENCE_INVALID_COUNT",
      );
    },
  );

  assert.equal(updateCalls, 0);
  assert.equal(lookupCalls, 0);
});

test("atomically reserves a contiguous range and passes the session", async () => {
  const session = { id: "session" };
  let updateCall;

  await withSequenceStubs(
    {
      findOneAndUpdate: async (...args) => {
        updateCall = args;
        return { value: 42 };
      },
    },
    async () => {
      assert.deepEqual(await reserveATMIds(3, { session }), [
        "ATM0040",
        "ATM0041",
        "ATM0042",
      ]);
    },
  );

  assert.deepEqual(updateCall, [
    {
      _id: "atmId",
      value: {
        $type: "number",
        $gte: 0,
        $lte: Number.MAX_SAFE_INTEGER - 3,
      },
      $expr: { $eq: [{ $mod: ["$value", 1] }, 0] },
    },
    { $inc: { value: 3 } },
    { new: true, upsert: false, session },
  ]);
});

test("fails clearly when the sequence has not been initialized", async () => {
  await withSequenceStubs(
    {
      findOneAndUpdate: async () => null,
      findOne: async () => null,
    },
    async () => {
      await assert.rejects(
        reserveATMIds(1),
        (error) =>
          error instanceof ATMIdSequenceError &&
          error.code === "ATM_ID_SEQUENCE_NOT_INITIALIZED",
      );
    },
  );
});

test("passes the session to the diagnostic read when allocation cannot proceed", async () => {
  const session = { id: "session" };
  let lookupCall;

  await withSequenceStubs(
    {
      findOneAndUpdate: async () => null,
      findOne: async (...args) => {
        lookupCall = args;
        return null;
      },
    },
    async () => {
      await assert.rejects(
        reserveATMIds(1, { session }),
        (error) =>
          error instanceof ATMIdSequenceError &&
          error.code === "ATM_ID_SEQUENCE_NOT_INITIALIZED",
      );
    },
  );

  assert.deepEqual(lookupCall, [{ _id: "atmId" }, null, { session }]);
});

test("does not increment an invalid or exhausted sequence", async (t) => {
  const cases = [
    {
      name: "invalid counter",
      sequence: { value: 1.5 },
      errorCode: "ATM_ID_SEQUENCE_INVALID",
    },
    {
      name: "exhausted counter",
      sequence: { value: Number.MAX_SAFE_INTEGER },
      errorCode: "ATM_ID_SEQUENCE_EXHAUSTED",
    },
  ];

  for (const { name, sequence, errorCode } of cases) {
    await t.test(name, async () => {
      let updates = 0;
      await withSequenceStubs(
        {
          findOneAndUpdate: async () => {
            updates += 1;
            return null;
          },
          findOne: async () => sequence,
        },
        async () => {
          await assert.rejects(
            reserveATMIds(1),
            (error) =>
              error instanceof ATMIdSequenceError &&
              error.code === errorCode,
          );
        },
      );
      assert.equal(updates, 1);
    });
  }
});

test("concurrent callers receive distinct ranges", async () => {
  let value = 0;
  await withSequenceStubs(
    {
      findOneAndUpdate: async (filter, update, options) => {
        assert.deepEqual(filter._id, "atmId");
        assert.equal(options.upsert, false);
        value += update.$inc.value;
        return { value };
      },
    },
    async () => {
      const ranges = await Promise.all(
        Array.from({ length: 10 }, () => reserveATMIds(2)),
      );
      const ids = ranges.flat();

      assert.equal(new Set(ids).size, 20);
      assert.deepEqual(
        ids.sort(),
        Array.from({ length: 20 }, (_, index) =>
          `ATM${String(index + 1).padStart(4, "0")}`,
        ),
      );
    },
  );
});

test("does not change existing single-ATM ID generation", async () => {
  const originalATMFindOne = ATM.findOne;
  let receivedSort;

  ATM.findOne = () => ({
    sort(sort) {
      receivedSort = sort;
      return this;
    },
    select: async () => ({ atmId: "ATM0007" }),
  });

  try {
    assert.equal(await generateATMId(), "ATM0008");
    assert.deepEqual(receivedSort, { createdAt: -1 });
  } finally {
    ATM.findOne = originalATMFindOne;
  }
});

test("sequence model uses a dedicated collection and the built-in _id index", () => {
  assert.deepEqual(ATMIdSequence.schema.indexes(), []);
  assert.equal(ATMIdSequence.schema.options.collection, "atm_id_sequences");
  assert.equal(ATMIdSequence.schema.path("_id").instance, "String");
  assert.equal(ATMIdSequence.schema.path("value").instance, "Number");
});
