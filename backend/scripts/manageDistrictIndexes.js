import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import dotenv from "dotenv";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });

const confirmation = "APPLY-DISTRICT-INDEXES";
const args = new Set(process.argv.slice(2));
const valueFor = (prefix) =>
  process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
const targetDatabase = valueFor("--target-database=");
const apply = args.has("--apply");
const confirmed = valueFor("--confirm=") === confirmation;
const backupConfirmed = args.has("--backup-confirmed");
const compatibleWritersConfirmed = args.has("--compatible-writers-confirmed");

const expectedIndexes = [
  {
    name: "regionId_1",
    key: { regionId: 1 },
  },
  {
    name: "uniq_district_bank_name_normalized",
    key: { bankId: 1, districtNameNormalized: 1 },
    unique: true,
    partialFilterExpression: { geographyStatus: "MAPPED" },
  },
  {
    name: "uniq_district_bank_pin_normalized",
    key: { bankId: 1, pinCodeNormalized: 1 },
    unique: true,
    partialFilterExpression: { geographyStatus: "MAPPED" },
  },
];

const legacyIndexes = [
  {
    name: "regionId_1_districtName_1",
    key: { regionId: 1, districtName: 1 },
    unique: true,
    partialFilterExpression: { regionId: { $type: "objectId" } },
  },
  {
    name: "regionId_1_pinCode_1",
    key: { regionId: 1, pinCode: 1 },
    unique: true,
    partialFilterExpression: { regionId: { $type: "objectId" } },
  },
];

const fail = (message) => {
  throw new Error(message);
};

const specificationOf = (index) => {
  const specification = {
    name: index.name,
    key: index.key,
  };
  for (const option of [
    "unique",
    "sparse",
    "expireAfterSeconds",
    "partialFilterExpression",
    "collation",
    "wildcardProjection",
    "hidden",
  ]) {
    if (index[option] !== undefined) specification[option] = index[option];
  }
  return specification;
};

const sameSpecification = (actual, expected) =>
  JSON.stringify(specificationOf(actual)) ===
  JSON.stringify(specificationOf(expected));

const isLegacyIndex = (index, legacy) =>
  sameSpecification(index, legacy);

const main = async () => {
  if (!process.env.MONGODB_URL) fail("MONGODB_URL is required");
  if (!targetDatabase) fail("--target-database=<database-name> is required");
  if (
    apply &&
    (!confirmed || !backupConfirmed || !compatibleWritersConfirmed)
  ) {
    fail(
      `Apply requires --confirm=${confirmation}, --backup-confirmed, and --compatible-writers-confirmed after a verified backup and coordinated writer rollout`,
    );
  }

  const uri = new URL(process.env.MONGODB_URL);
  const uriDatabase = decodeURIComponent(uri.pathname.replace(/^\/+/, ""));
  if (!uriDatabase || uriDatabase !== targetDatabase) {
    fail("The target database must exactly match the database name in MONGODB_URL");
  }

  await mongoose.connect(process.env.MONGODB_URL, {
    autoIndex: false,
    autoCreate: false,
    readPreference: "primary",
    readConcern: { level: "majority" },
    serverSelectionTimeoutMS: 10000,
  });
  const collection = mongoose.connection.db.collection("districts");
  const indexes = await collection.listIndexes().toArray().catch((error) => {
    if (error.codeName === "NamespaceNotFound") return [];
    throw error;
  });
  console.log("Current District index specifications:");
  console.log(JSON.stringify(indexes, null, 2));

  for (const expected of expectedIndexes) {
    const sameName = indexes.find((index) => index.name === expected.name);
    if (sameName && !sameSpecification(sameName, expected)) {
      fail(`Existing index ${expected.name} does not match the expected specification`);
    }
  }
  console.log(
    `Expected index specifications: ${JSON.stringify(expectedIndexes, null, 2)}`,
  );
  if (!apply) {
    console.log(
      "Dry run only. Build new indexes only after the data audit, manual duplicate resolution, compatible-writer rollout, and approved maintenance window.",
    );
    return;
  }

  for (const expected of expectedIndexes) {
    if (!indexes.some((index) => sameSpecification(index, expected))) {
      await collection.createIndex(expected.key, {
        name: expected.name,
        ...(expected.unique ? { unique: true } : {}),
        ...(expected.partialFilterExpression
          ? { partialFilterExpression: expected.partialFilterExpression }
          : {}),
      });
    }
  }
  const afterBuild = await collection.listIndexes().toArray();
  const missing = expectedIndexes.filter(
    (expected) => !afterBuild.some((index) => sameSpecification(index, expected)),
  );
  if (missing.length) {
    fail(`New District indexes were not verified: ${missing.map(({ name }) => name).join(", ")}`);
  }

  for (const legacy of legacyIndexes) {
    const oldIndex = afterBuild.find((index) => index.name === legacy.name);
    if (!oldIndex) continue;
    if (!isLegacyIndex(oldIndex, legacy)) {
      console.warn(
        `Retaining ${legacy.name}: its full identity does not match the known legacy unique index`,
      );
      continue;
    }
    await collection.dropIndex(legacy.name);
  }
  const finalIndexes = await collection.listIndexes().toArray();
  const unverified = expectedIndexes.filter(
    (expected) => !finalIndexes.some((index) => sameSpecification(index, expected)),
  );
  if (unverified.length) {
    fail(`Final District indexes could not be verified: ${unverified.map(({ name }) => name).join(", ")}`);
  }
  console.log("District index transition completed and verified.");
  console.log(JSON.stringify(finalIndexes, null, 2));
};

main()
  .catch((error) => {
    console.error("District index management failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
