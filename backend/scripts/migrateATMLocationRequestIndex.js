import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import mongoose from "mongoose";
import dotenv from "dotenv";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });

mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const confirmation = "APPLY-ATM-LOCATION-REQUEST-INDEX";
const args = new Set(process.argv.slice(2));
const valueFor = (prefix) =>
  process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
const targetDatabase = valueFor("--target-database=");
const apply = args.has("--apply");
const confirmed = valueFor("--confirm=") === confirmation;
const backupConfirmed = args.has("--backup-confirmed");

const collectionName = "atmlocationrequests";
const expectedIndex = {
  name: "atmId_pending_unique",
  key: { atmId: 1 },
  unique: true,
  partialFilterExpression: { status: "PENDING" },
};
const legacyIndex = {
  name: "atmId_1",
  key: { atmId: 1 },
};
const indexMetadata = new Set(["v", "ns", "background"]);

const fail = (message) => {
  throw new Error(message);
};

const specificationOf = (index) =>
  Object.fromEntries(
    Object.entries(index).filter(([key]) => !indexMetadata.has(key)),
  );

const sameSpecification = (actual, expected) =>
  isDeepStrictEqual(specificationOf(actual), expected);

const readIndexes = async (collection) =>
  collection.listIndexes().toArray().catch((error) => {
    if (error.codeName === "NamespaceNotFound") return [];
    throw error;
  });

const main = async () => {
  if (!process.env.MONGODB_URL) fail("MONGODB_URL is required");
  if (!targetDatabase) fail("--target-database=<database-name> is required");
  if (apply && (!confirmed || !backupConfirmed)) {
    fail(
      `Apply requires --confirm=${confirmation} and --backup-confirmed after a verified backup`,
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

  const database = mongoose.connection.db;
  const collection = database.collection(collectionName);
  const indexes = await readIndexes(collection);
  console.log("Current ATM location request index specifications:");
  console.log(JSON.stringify(indexes, null, 2));

  for (const knownIndex of [expectedIndex, legacyIndex]) {
    const sameName = indexes.find((index) => index.name === knownIndex.name);
    if (sameName && !sameSpecification(sameName, knownIndex)) {
      fail(
        `Existing index ${knownIndex.name} does not match its known specification`,
      );
    }
  }

  const collectionExists = await database
    .listCollections({ name: collectionName }, { nameOnly: true })
    .hasNext();
  const duplicateRequests = collectionExists
    ? await collection
        .aggregate([
          { $match: { status: "PENDING" } },
          {
            $group: {
              _id: "$atmId",
              count: { $sum: 1 },
            },
          },
          { $match: { count: { $gt: 1 } } },
          { $limit: 10 },
        ])
        .toArray()
    : [];

  if (duplicateRequests.length) {
    fail(
      `Duplicate PENDING ATM location requests require manual resolution; no documents were changed: ${JSON.stringify(duplicateRequests)}`,
    );
  }

  console.log(
    `Expected index specification: ${JSON.stringify(expectedIndex, null, 2)}`,
  );
  if (!apply) {
    console.log("Dry run only. No index changes were made.");
    return;
  }

  if (!indexes.some((index) => sameSpecification(index, expectedIndex))) {
    await collection.createIndex(expectedIndex.key, {
      name: expectedIndex.name,
      unique: expectedIndex.unique,
      partialFilterExpression: expectedIndex.partialFilterExpression,
    });
  }

  const afterCreate = await readIndexes(collection);
  const verifiedIndex = afterCreate.find(
    (index) => index.name === expectedIndex.name,
  );
  if (!verifiedIndex || !sameSpecification(verifiedIndex, expectedIndex)) {
    fail("The new ATM location request index could not be verified");
  }

  const oldIndex = afterCreate.find((index) => index.name === legacyIndex.name);
  if (oldIndex) {
    if (!sameSpecification(oldIndex, legacyIndex)) {
      fail(
        `Refusing to drop ${legacyIndex.name}: its full identity does not match the known legacy index`,
      );
    }
    await collection.dropIndex(legacyIndex.name);
  }

  const finalIndexes = await readIndexes(collection);
  const finalExpectedIndex = finalIndexes.find(
    (index) => index.name === expectedIndex.name,
  );
  if (
    !finalExpectedIndex ||
    !sameSpecification(finalExpectedIndex, expectedIndex)
  ) {
    fail("The final ATM location request index state could not be verified");
  }
  if (finalIndexes.some((index) => index.name === legacyIndex.name)) {
    fail(`Legacy index ${legacyIndex.name} is still present`);
  }

  console.log("ATM location request index transition completed and verified.");
  console.log(JSON.stringify(finalIndexes, null, 2));
};

main()
  .catch((error) => {
    console.error("ATM location request index migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
