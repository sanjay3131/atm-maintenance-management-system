import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import {
  DISTRICT_INDEXES,
} from "../src/modules/districts/districtIndexSetup.js";
import District from "../src/modules/districts/district.models.js";
import {
  OBSOLETE_GEOGRAPHY_INDEXES,
  REGION_INDEXES,
  planGeographyIndexOperations,
  planGeographyIndexes,
  verifyGeographyIndexes,
} from "../src/modules/districts/geographyIndexSetup.js";
import Region from "../src/modules/region/region.model.js";

const actualFor = (indexes, namespace) => [
  {
    name: "_id_",
    key: { _id: 1 },
    v: 2,
    ns: namespace,
  },
  ...indexes.map((index) => ({
    ...index,
    v: 2,
    ns: namespace,
  })),
];

const exactIndexes = {
  regionIndexes: actualFor(REGION_INDEXES, "fresh.regions"),
  districtIndexes: actualFor(DISTRICT_INDEXES, "fresh.districts"),
};

const schemaIndexSpecifications = (model) =>
  model.schema.indexes().map(([key, options]) => {
    const index = {
      name:
        options.name ??
        Object.entries(key)
          .map(([field, direction]) => `${field}_${direction}`)
          .join("_"),
      key,
    };
    for (const option of ["unique", "partialFilterExpression"]) {
      if (options[option] !== undefined) index[option] = options[option];
    }
    return index;
  });

test("Region and District setup specifications match their model indexes", () => {
  assert.deepEqual(schemaIndexSpecifications(Region), REGION_INDEXES);
  assert.deepEqual(schemaIndexSpecifications(District), DISTRICT_INDEXES);
});

test("geography index plan accepts the exact Bank-scoped specifications", () => {
  const verification = verifyGeographyIndexes(exactIndexes);

  assert.equal(verification.isExact, true);
  assert.deepEqual(verification.regions.missing, []);
  assert.deepEqual(verification.districts.missing, []);
});

test("geography index plan stages the exact same-name sort-index replacement", () => {
  const regionLegacy = OBSOLETE_GEOGRAPHY_INDEXES.regions.find(
    ({ name }) => name === "districtId_1_name_1",
  );
  const districtLegacy = OBSOLETE_GEOGRAPHY_INDEXES.districts.find(
    ({ name }) => name === "districtName_1",
  );
  const plan = planGeographyIndexes({
    regionIndexes: [
      ...exactIndexes.regionIndexes,
      { ...regionLegacy, ns: "fresh.regions", v: 2 },
    ],
    districtIndexes: [
      { name: "_id_", key: { _id: 1 } },
      { ...districtLegacy, ns: "fresh.districts", v: 2 },
    ],
  });

  assert.equal(plan.regions.isRepairable, true);
  assert.equal(plan.districts.isRepairable, true);
  assert.deepEqual(
    plan.regions.obsoleteIndexes.map(({ name }) => name),
    ["districtId_1_name_1"],
  );
  assert.deepEqual(
    plan.districts.obsoleteIndexes.map(({ name }) => name),
    ["districtName_1"],
  );
  assert.deepEqual(
    plan.districts.createIndexes.map(({ name }) => name),
    DISTRICT_INDEXES.filter(({ name }) => name !== "districtName_1").map(
      ({ name }) => name,
    ),
  );
  assert.deepEqual(
    plan.districts.replacements.map(({ obsolete, desired }) => [
      obsolete.name,
      desired.name,
      obsolete.unique,
      desired.unique,
    ]),
    [["districtName_1", "districtName_1", true, undefined]],
  );
});

test("geography index plan refuses mismatched and unrecognized indexes", () => {
  const regionNameIndex = exactIndexes.regionIndexes.find(
    ({ name }) => name === "bankId_1_name_1",
  );
  const plan = planGeographyIndexes({
    regionIndexes: [
      ...exactIndexes.regionIndexes.filter(
        (index) => index !== regionNameIndex,
      ),
      {
        ...regionNameIndex,
        partialFilterExpression: { bankId: { $type: "string" } },
      },
      { name: "unexpected_1", key: { unexpected: 1 } },
    ],
    districtIndexes: exactIndexes.districtIndexes,
  });

  assert.equal(plan.regions.isRepairable, false);
  assert.deepEqual(
    plan.regions.mismatched.map(({ name }) => name),
    ["bankId_1_name_1"],
  );
  assert.deepEqual(
    plan.regions.unexpected.map(({ name }) => name),
    ["unexpected_1"],
  );
});

test("a mismatched same-name District index is not treated as obsolete", () => {
  const legacy = OBSOLETE_GEOGRAPHY_INDEXES.districts.find(
    ({ name }) => name === "districtName_1",
  );
  const plan = planGeographyIndexes({
    regionIndexes: exactIndexes.regionIndexes,
    districtIndexes: [
      {
        ...legacy,
        partialFilterExpression: { districtName: { $type: "string" } },
      },
      ...exactIndexes.districtIndexes.filter(
        ({ name }) => name !== "districtName_1",
      ),
    ],
  });

  assert.equal(plan.districts.isRepairable, false);
  assert.deepEqual(plan.districts.obsoleteIndexes, []);
  assert.deepEqual(
    plan.districts.mismatched.map(({ name }) => name),
    ["districtName_1"],
  );
  assert.deepEqual(plan.districts.replacements, []);
});

test("the expected non-unique District name index is retained and verified", () => {
  const plan = planGeographyIndexes({
    regionIndexes: exactIndexes.regionIndexes,
    districtIndexes: exactIndexes.districtIndexes,
  });

  assert.equal(plan.districts.isExact, true);
  assert.deepEqual(plan.districts.obsoleteIndexes, []);
  assert.deepEqual(plan.districts.replacements, []);
  assert.deepEqual(plan.districts.createIndexes, []);
});

test("index operations create constraints before replacement and unrelated drops", () => {
  const regionLegacy = OBSOLETE_GEOGRAPHY_INDEXES.regions.find(
    ({ name }) => name === "districtId_1",
  );
  const districtNameLegacy = OBSOLETE_GEOGRAPHY_INDEXES.districts.find(
    ({ name }) => name === "districtName_1",
  );
  const districtPinLegacy = OBSOLETE_GEOGRAPHY_INDEXES.districts.find(
    ({ name, unique }) => name === "pinCode_1" && unique === true,
  );
  const plan = planGeographyIndexes({
    regionIndexes: [
      ...exactIndexes.regionIndexes,
      { ...regionLegacy, ns: "fresh.regions", v: 2 },
    ],
    districtIndexes: [
      { name: "_id_", key: { _id: 1 } },
      { name: "regionId_1", key: { regionId: 1 } },
      { ...districtNameLegacy, ns: "fresh.districts", v: 2 },
      { ...districtPinLegacy, ns: "fresh.districts", v: 2 },
    ],
  });
  const operations = planGeographyIndexOperations({
    regions: plan.regions,
    districts: plan.districts,
  });

  assert.equal(plan.regions.isRepairable, true);
  assert.equal(plan.districts.isRepairable, true);
  assert.deepEqual(
    operations.map(({ type, collection, index, obsolete, desired }) => [
      type,
      collection,
      index?.name ?? obsolete?.name ?? desired?.name,
    ]),
    [
      ["create", "districts", "uniq_district_bank_name_normalized"],
      ["create", "districts", "uniq_district_bank_pin_normalized"],
      ["replace", "districts", "districtName_1"],
      ["drop", "regions", "districtId_1"],
      ["drop", "districts", "pinCode_1"],
    ],
  );
});

test("unrelated indexes make a plan non-repairable", () => {
  const regionLegacy = OBSOLETE_GEOGRAPHY_INDEXES.regions.find(
    ({ name }) => name === "districtId_1",
  );
  const plan = planGeographyIndexes({
    regionIndexes: [
      ...exactIndexes.regionIndexes,
      { ...regionLegacy, ns: "fresh.regions", v: 2 },
      { name: "custom_region_lookup", key: { customField: 1 } },
    ],
    districtIndexes: exactIndexes.districtIndexes,
  });

  assert.equal(plan.regions.isRepairable, false);
  assert.deepEqual(
    plan.regions.obsoleteIndexes.map(({ name }) => name),
    ["districtId_1"],
  );
  assert.deepEqual(
    plan.regions.unexpected.map(({ name }) => name),
    ["custom_region_lookup"],
  );
  assert.throws(
    () =>
      planGeographyIndexOperations({
        regions: plan.regions,
        districts: plan.districts,
      }),
    /non-repairable index set/,
  );
});

test("setup script import is inert and target validation is test-only", async () => {
  const originalConnect = mongoose.connect;
  const originalDisconnect = mongoose.disconnect;
  const originalArgv = process.argv;
  const originalMongoUrl = process.env.MONGODB_URL;
  let connectCalls = 0;

  mongoose.connect = async () => {
    connectCalls += 1;
    throw new Error("Unexpected connection attempt");
  };
  mongoose.disconnect = async () => mongoose;
  process.argv = [
    originalArgv[0],
    originalArgv[1],
    "--target-database=test",
  ];
  process.env.MONGODB_URL = "mongodb://localhost/test";

  try {
    const setup = await import("../scripts/setupGeographyIndexes.js");
    assert.equal(connectCalls, 0);

    assert.doesNotThrow(() =>
      setup.validateTargetDatabase("test", "mongodb://localhost/test"),
    );
    assert.throws(
      () => setup.validateTargetDatabase(undefined, "mongodb://localhost/test"),
      /--target-database must be exactly test/,
    );
    assert.throws(
      () => setup.validateTargetDatabase("stage", "mongodb://localhost/stage"),
      /--target-database must be exactly test/,
    );
    assert.throws(
      () => setup.validateTargetDatabase("test", "mongodb://localhost/stage"),
      /MONGODB_URL must target database test/,
    );
    assert.throws(
      () => setup.validateTargetDatabase("test", "mongodb://localhost/"),
      /MONGODB_URL must target database test/,
    );
    assert.throws(
      () => setup.validateTargetDatabase("test", undefined),
      /MONGODB_URL is required/,
    );
    assert.throws(
      () => setup.validateTargetDatabase("test", "not a URL"),
      /MONGODB_URL must be a valid URL/,
    );
    assert.throws(
      () => setup.validateTargetDatabase("test", "https://localhost/test"),
      /MONGODB_URL must use a MongoDB URI scheme/,
    );
  } finally {
    mongoose.connect = originalConnect;
    mongoose.disconnect = originalDisconnect;
    process.argv = originalArgv;
    if (originalMongoUrl === undefined) {
      delete process.env.MONGODB_URL;
    } else {
      process.env.MONGODB_URL = originalMongoUrl;
    }
  }
});
