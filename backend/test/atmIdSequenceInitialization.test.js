import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATM_ID_SEQUENCE_CONFIRMATION,
  ATMIdSequenceInitializationError,
  initializeATMIdSequence,
  validateInitializationArguments,
} from "../scripts/initializeATMIdSequence.js";

const cursorFor = (documents) => ({
  async *[Symbol.asyncIterator]() {
    for (const document of documents) yield structuredClone(document);
  },
});

const createCollections = ({ atms = [], sequence = null } = {}) => {
  const state = {
    atms: structuredClone(atms),
    sequence: structuredClone(sequence),
    inserts: [],
    findCalls: [],
  };

  return {
    state,
    atmCollection: {
      countDocuments: async () => state.atms.length,
      find: (filter, options) => {
        state.findCalls.push({ filter, options });
        return cursorFor(state.atms);
      },
    },
    sequenceCollection: {
      findOne: async (filter) => {
        assert.deepEqual(filter, { _id: "atmId" });
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
  initializeATMIdSequence({
    atmCollection: collections.atmCollection,
    sequenceCollection: collections.sequenceCollection,
  });

test("requires explicit database target, confirmation, and paused ATM writes", () => {
  const input = {
    env: {
      MONGODB_URL: "mongodb://localhost:27017/atm_test",
      MONGODB_EXPECTED_DATABASE: "atm_test",
    },
    targetDatabase: "atm_test",
    confirmation: ATM_ID_SEQUENCE_CONFIRMATION,
    atmWritesPaused: true,
  };

  assert.equal(validateInitializationArguments(input), "atm_test");
  assert.throws(
    () =>
      validateInitializationArguments({
        ...input,
        atmWritesPaused: false,
      }),
    /ATM writes must be paused/,
  );
  const inputWithoutPausedWriteFlag = { ...input };
  delete inputWithoutPausedWriteFlag.atmWritesPaused;
  assert.throws(
    () => validateInitializationArguments(inputWithoutPausedWriteFlag),
    /ATM writes must be paused/,
  );
  assert.throws(
    () =>
      validateInitializationArguments({
        ...input,
        confirmation: "incorrect-confirmation",
      }),
    /Explicit confirmation required/,
  );
  assert.throws(
    () =>
      validateInitializationArguments({
        ...input,
        targetDatabase: "other",
      }),
    /must exactly match MONGODB_EXPECTED_DATABASE/,
  );
  assert.throws(
      () =>
        validateInitializationArguments({
          ...input,
          env: {
            ...input.env,
            MONGODB_URL: "mongodb://localhost:27017/unexpected_database",
          },
        }),
      /targets "unexpected_database"/,
  );
});

test("initializes to the maximum ATM suffix, including soft-deleted ATMs", async () => {
  const collections = createCollections({
    atms: [
      { _id: "active-atm", atmId: "ATM0007", isDeleted: false },
      { _id: "deleted-atm", atmId: "ATM0042", isDeleted: true },
    ],
  });

  const result = await initialize(collections);

  assert.deepEqual(result, {
    status: "initialized",
    value: 42,
    atmCount: 2,
  });
  assert.deepEqual(collections.state.inserts, [{ _id: "atmId", value: 42 }]);
  assert.deepEqual(collections.state.findCalls[0], {
    filter: {},
    options: { projection: { _id: 1, atmId: 1 } },
  });
});

test("initializes an empty ATM collection at zero", async () => {
  const collections = createCollections();

  const result = await initialize(collections);

  assert.deepEqual(result, {
    status: "initialized",
    value: 0,
    atmCount: 0,
  });
  assert.deepEqual(collections.state.inserts, [{ _id: "atmId", value: 0 }]);
});

test("refuses missing, malformed, duplicate, zero, or unsafe ATM IDs", async (t) => {
  const cases = [
    {
      name: "missing ID",
      atms: [{ _id: "atm-1" }],
    },
    {
      name: "malformed ID",
      atms: [{ _id: "atm-1", atmId: "ATM-1" }],
    },
    {
      name: "duplicate IDs",
      atms: [
        { _id: "atm-1", atmId: "ATM0001" },
        { _id: "atm-2", atmId: "ATM0001" },
      ],
    },
    {
      name: "zero suffix",
      atms: [{ _id: "atm-1", atmId: "ATM0000" }],
    },
    {
      name: "unsafe suffix",
      atms: [
        {
          _id: "atm-1",
          atmId: `ATM${BigInt(Number.MAX_SAFE_INTEGER) + 1n}`,
        },
      ],
    },
  ];

  for (const { name, atms } of cases) {
    await t.test(name, async () => {
      const collections = createCollections({ atms });

      await assert.rejects(
        initialize(collections),
        (error) =>
          error instanceof ATMIdSequenceInitializationError &&
          error.code === "ATM_IDS_REQUIRE_REVIEW",
      );
      assert.deepEqual(collections.state.inserts, []);
      assert.equal(collections.state.sequence, null);
    });
  }
});

test("refuses duplicate numeric suffixes with different padding", async () => {
  const collections = createCollections({
    atms: [
      { _id: "atm-1", atmId: "ATM0001" },
      { _id: "atm-2", atmId: "ATM00001" },
    ],
  });

  await assert.rejects(
    initialize(collections),
    (error) =>
      error instanceof ATMIdSequenceInitializationError &&
      error.code === "ATM_IDS_REQUIRE_REVIEW" &&
      error.details.duplicates[0].suffix === "1" &&
      error.details.duplicates[0].atms.length === 2,
  );
  assert.deepEqual(collections.state.inserts, []);
});

test("preserves a valid initialized sequence and refuses to repair a lagging one", async (t) => {
  await t.test("never overwrites an existing sequence", async () => {
    const existingSequence = { _id: "atmId", value: 50 };
    const collections = createCollections({
      atms: [{ _id: "atm-1", atmId: "ATM0042" }],
      sequence: existingSequence,
    });

    assert.deepEqual(await initialize(collections), {
      status: "already-initialized",
      value: 50,
      atmCount: 1,
    });
    assert.deepEqual(collections.state.inserts, []);
    assert.deepEqual(collections.state.sequence, existingSequence);
  });

  await t.test("rejects a sequence behind an existing ATM ID", async () => {
    const collections = createCollections({
      atms: [{ _id: "atm-1", atmId: "ATM0042" }],
      sequence: { _id: "atmId", value: 41 },
    });

    await assert.rejects(
      initialize(collections),
      (error) =>
        error instanceof ATMIdSequenceInitializationError &&
        error.code === "ATM_ID_SEQUENCE_BEHIND",
    );
    assert.deepEqual(collections.state.inserts, []);
    assert.equal(collections.state.sequence.value, 41);
  });
});

test("rejects malformed existing sequence documents without changing them", async () => {
  const collections = createCollections({
    sequence: { _id: "wrongId", value: 1 },
  });

  await assert.rejects(
    initialize(collections),
    (error) =>
      error instanceof ATMIdSequenceInitializationError &&
      error.code === "ATM_ID_SEQUENCE_INVALID",
  );
  assert.deepEqual(collections.state.inserts, []);
});
