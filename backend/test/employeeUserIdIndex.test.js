import test from "node:test";
import assert from "node:assert/strict";
import Employee from "../src/modules/employees/employee.model.js";
import {
  DuplicateEmployeeUserIdError,
  EmployeeUserIdIndexCreationError,
  EmployeeUserIdLegacyIndexRemovalError,
  EMPLOYEE_USER_ID_INDEX,
  ensureEmployeeUserIdUniqueIndex,
  findDuplicateEmployeeUserIds,
  isEmployeeUserIdDuplicateKeyError,
} from "../src/modules/employees/employeeUserIdIndex.js";

const collectionWith = ({
  duplicates = [],
  indexes = [],
  listIndexesError,
  dropIndexError,
  createIndexError,
} = {}) => {
  const calls = [];
  const currentIndexes = indexes.map((index) => structuredClone(index));
  return {
    calls,
    currentIndexes,
    aggregate(pipeline) {
      calls.push(["aggregate", pipeline]);
      return { toArray: async () => duplicates };
    },
    listIndexes() {
      calls.push(["listIndexes"]);
      if (listIndexesError) {
        return {
          toArray: async () => {
            throw listIndexesError;
          },
        };
      }
      return { toArray: async () => structuredClone(currentIndexes) };
    },
    async dropIndex(name) {
      calls.push(["dropIndex", name]);
      const error =
        typeof dropIndexError === "function"
          ? dropIndexError(name)
          : dropIndexError;
      if (error) throw error;
      const index = currentIndexes.findIndex((entry) => entry.name === name);
      if (index !== -1) currentIndexes.splice(index, 1);
    },
    async createIndex(fields, options) {
      calls.push(["createIndex", fields, options]);
      if (createIndexError) throw createIndexError;
      currentIndexes.push({
        key: structuredClone(fields),
        ...structuredClone(options),
      });
      return options.name;
    },
  };
};

test("Employee.userId is declared as a unique partial index", () => {
  const userIdIndex = Employee.schema
    .indexes()
    .find(([fields]) => fields.userId === 1);

  assert.deepEqual(userIdIndex, [
    EMPLOYEE_USER_ID_INDEX.fields,
    EMPLOYEE_USER_ID_INDEX.options,
  ]);
  assert.equal(userIdIndex[1].unique, true);
  assert.deepEqual(userIdIndex[1].partialFilterExpression, {
    userId: { $type: "objectId" },
  });
});

test("duplicate preflight returns every conflicting employee ID", async () => {
  const duplicate = {
    userId: "64b000000000000000000001",
    employeeIds: ["64b000000000000000000002", "64b000000000000000000003"],
    count: 2,
  };
  const collection = collectionWith({ duplicates: [duplicate] });

  assert.deepEqual(await findDuplicateEmployeeUserIds(collection), [duplicate]);
  assert.deepEqual(collection.calls[0][1][0], {
    $match: { userId: { $type: "objectId" } },
  });
});

test("index preflight stops before index changes when duplicate users exist", async () => {
  const collection = collectionWith({
    duplicates: [
      {
        userId: "64b000000000000000000001",
        employeeIds: ["64b000000000000000000002", "64b000000000000000000003"],
        count: 2,
      },
    ],
    indexes: [{ name: "userId_1", key: { userId: 1 } }],
  });

  await assert.rejects(
    ensureEmployeeUserIdUniqueIndex(collection),
    DuplicateEmployeeUserIdError,
  );
  assert.deepEqual(
    collection.calls.map(([name]) => name),
    ["aggregate"],
  );
  assert.deepEqual(
    collection.currentIndexes.map(({ name }) => name),
    ["userId_1"],
  );
});

test("index preflight replaces the old non-unique index after a clean audit", async () => {
  const collection = collectionWith({
    indexes: [
      { name: "_id_", key: { _id: 1 }, unique: true },
      { name: "userId_1", key: { userId: 1 } },
    ],
  });

  const name = await ensureEmployeeUserIdUniqueIndex(collection);
  assert.equal(name, EMPLOYEE_USER_ID_INDEX.options.name);
  assert.deepEqual(
    collection.calls.map(([call]) => call),
    ["aggregate", "listIndexes", "createIndex", "dropIndex"],
  );
  assert.deepEqual(
    collection.currentIndexes.map(({ name }) => name).sort(),
    ["_id_", EMPLOYEE_USER_ID_INDEX.options.name],
  );
});

test("index preflight leaves the desired index in place", async () => {
  const collection = collectionWith({
    indexes: [
      {
        name: EMPLOYEE_USER_ID_INDEX.options.name,
        key: { userId: 1 },
        unique: true,
        partialFilterExpression: { userId: { $type: "objectId" } },
      },
    ],
  });

  await ensureEmployeeUserIdUniqueIndex(collection);
  assert.deepEqual(
    collection.calls.map(([call]) => call),
    ["aggregate", "listIndexes"],
  );
});

test("missing Employee collection metadata fails before index creation", async () => {
  const namespaceError = Object.assign(new Error("namespace missing"), {
    code: 26,
  });
  const collection = collectionWith({ listIndexesError: namespaceError });

  await assert.rejects(
    ensureEmployeeUserIdUniqueIndex(collection),
    namespaceError,
  );
  assert.deepEqual(
    collection.calls.map(([call]) => call),
    ["aggregate", "listIndexes"],
  );
  assert.deepEqual(collection.currentIndexes, []);
});

test("index preflight replaces a same-key index with a narrower partial filter", async () => {
  const collection = collectionWith({
    indexes: [
      {
        name: "legacy_userId_partial",
        key: { userId: 1 },
        unique: true,
        partialFilterExpression: {
          userId: { $type: "objectId" },
          status: "active",
        },
      },
    ],
  });

  await ensureEmployeeUserIdUniqueIndex(collection);
  assert.deepEqual(
    collection.calls.map(([call]) => call),
    ["aggregate", "listIndexes", "createIndex", "dropIndex"],
  );
  assert.deepEqual(collection.currentIndexes, [
    {
      key: { userId: 1 },
      ...EMPLOYEE_USER_ID_INDEX.options,
    },
  ]);
});

test("failed index creation preserves the existing index", async () => {
  const createError = new Error("index creation failed");
  const collection = collectionWith({
    indexes: [{ name: "userId_1", key: { userId: 1 } }],
    createIndexError: createError,
  });

  await assert.rejects(
    ensureEmployeeUserIdUniqueIndex(collection),
    (error) =>
      error instanceof EmployeeUserIdIndexCreationError &&
      error.cause === createError &&
      /Existing userId indexes were left unchanged/.test(error.message),
  );
  assert.deepEqual(
    collection.calls.map(([call]) => call),
    ["aggregate", "listIndexes", "createIndex"],
  );
  assert.deepEqual(
    collection.currentIndexes.map(({ name }) => name),
    ["userId_1"],
  );
});

test("failed removal leaves the unique index and remaining legacy index for retry", async () => {
  const dropError = new Error("old index removal failed");
  let failLegacyDrop = true;
  const collection = collectionWith({
    indexes: [
      { name: "userId_1", key: { userId: 1 } },
      { name: "userId_1_legacy", key: { userId: 1 }, sparse: true },
    ],
    dropIndexError: (name) =>
      failLegacyDrop && name === "userId_1_legacy" ? dropError : undefined,
  });

  await assert.rejects(
    ensureEmployeeUserIdUniqueIndex(collection),
    (error) =>
      error instanceof EmployeeUserIdLegacyIndexRemovalError &&
      error.indexName === "userId_1_legacy" &&
      error.cause === dropError &&
      /Rerun the migration to retry cleanup/.test(error.message),
  );
  assert.deepEqual(
    collection.calls.map(([call]) => call),
    [
      "aggregate",
      "listIndexes",
      "createIndex",
      "dropIndex",
      "dropIndex",
    ],
  );
  assert.deepEqual(
    collection.currentIndexes.map(({ name }) => name).sort(),
    ["userId_1_legacy", EMPLOYEE_USER_ID_INDEX.options.name],
  );

  failLegacyDrop = false;
  await ensureEmployeeUserIdUniqueIndex(collection);
  assert.deepEqual(
    collection.currentIndexes.map(({ name }) => name),
    [EMPLOYEE_USER_ID_INDEX.options.name],
  );
});

test("duplicate-key classifier only recognizes employee userId conflicts", () => {
  assert.equal(
    isEmployeeUserIdDuplicateKeyError({
      code: 11000,
      keyPattern: { userId: 1 },
      message: "duplicate key",
    }),
    true,
  );
  assert.equal(
    isEmployeeUserIdDuplicateKeyError({
      code: 11000,
      keyPattern: { employeeCode: 1 },
      message: "duplicate key",
    }),
    false,
  );
});
