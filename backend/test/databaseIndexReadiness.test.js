import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseIndexInitializer } from "../src/config/databaseIndexReadiness.js";

test("initializes every registered model before creating explicit District indexes", async () => {
  const events = [];
  const models = [
    { modelName: "Bank", init: async () => events.push("Bank") },
    { modelName: "Region", init: async () => events.push("Region") },
    { modelName: "District", init: async () => events.push("District") },
  ];
  const districtModel = {
    schema: {
      indexes: () => [
        [{ regionId: 1 }, { name: "regionId_1" }],
        [{ bankId: 1, districtNameNormalized: 1 }, { unique: true }],
      ],
    },
    collection: {
      createIndex: async (fields, options) => {
        events.push(`index:${options.name ?? Object.keys(fields).join("_")}`);
      },
    },
  };

  const initialize = createDatabaseIndexInitializer({ models, districtModel });
  const result = await initialize();

  assert.deepEqual(events, [
    "Bank",
    "Region",
    "District",
    "index:regionId_1",
    "index:bankId_districtNameNormalized",
  ]);
  assert.deepEqual(result, {
    initializedModels: ["Bank", "Region", "District"],
    districtIndexes: 2,
  });
});

test("memoizes initialization and does not rebuild indexes on subsequent calls", async () => {
  let modelInitCount = 0;
  let indexCreateCount = 0;
  const initialize = createDatabaseIndexInitializer({
    models: [{ modelName: "Bank", init: async () => modelInitCount++ }],
    districtModel: {
      schema: { indexes: () => [[{ districtName: 1 }, { name: "districtName_1" }]] },
      collection: { createIndex: async () => indexCreateCount++ },
    },
  });

  await initialize();
  await initialize();

  assert.equal(modelInitCount, 1);
  assert.equal(indexCreateCount, 1);
});

test("does not create District indexes when a model index initialization fails", async () => {
  let indexCreateCount = 0;
  const initialize = createDatabaseIndexInitializer({
    models: [
      { modelName: "Bank", init: async () => {} },
      { modelName: "Broken", init: async () => { throw new Error("index failure"); } },
    ],
    districtModel: {
      schema: { indexes: () => [[{ districtName: 1 }, { name: "districtName_1" }]] },
      collection: { createIndex: async () => indexCreateCount++ },
    },
  });

  await assert.rejects(initialize(), /index failure/);
  assert.equal(indexCreateCount, 0);
});
