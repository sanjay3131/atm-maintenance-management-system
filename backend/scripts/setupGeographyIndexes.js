import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { preflightDistrictIndexes } from "../src/modules/districts/districtIndexSetup.js";
import {
  planGeographyIndexOperations,
  planGeographyIndexes,
  verifyGeographyIndexes,
} from "../src/modules/districts/geographyIndexSetup.js";
import { findGeographyUniqueKeyConflicts } from "../src/modules/districts/geographySetupVerification.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

const CONFIRMATION = "REPAIR-BANK-SCOPED-GEOGRAPHY-INDEXES";
const args = new Set(process.argv.slice(2));
const valueFor = (prefix) =>
  process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
const targetDatabase = valueFor("--target-database=");
const apply = args.has("--apply");
const verifyOnly = args.has("--verify");
const confirmed = valueFor("--confirm=") === CONFIRMATION;
const backupConfirmed = args.has("--backup-confirmed");
const writersStopped = args.has("--writers-stopped");
const fail = (message) => {
  throw new Error(message);
};

export const validateTargetDatabase = (targetDatabase, mongodbUrl) => {
  if (targetDatabase !== "test") {
    fail("--target-database must be exactly test");
  }
  if (!mongodbUrl) fail("MONGODB_URL is required");

  let uri;
  try {
    uri = new URL(mongodbUrl);
  } catch {
    fail("MONGODB_URL must be a valid URL");
  }
  if (uri.protocol !== "mongodb:" && uri.protocol !== "mongodb+srv:") {
    fail("MONGODB_URL must use a MongoDB URI scheme");
  }
  if (uri.pathname !== "/test") {
    fail("MONGODB_URL must target database test");
  }
};

const readIndexes = async (collection) => {
  try {
    return await collection.listIndexes().toArray();
  } catch (error) {
    if (error.codeName === "NamespaceNotFound") return [];
    throw error;
  }
};

const describeIndexFindings = ({ regions, districts }) =>
  JSON.stringify(
    {
      regions: {
        missing: regions.missing.map(({ name }) => name),
        mismatched: regions.mismatched.map(({ name }) => name),
        unexpected: regions.unexpected.map(({ name }) => name),
        obsolete: regions.obsoleteIndexes.map(({ name }) => name),
        replacements: regions.replacements.map(({ obsolete, desired }) => ({
          obsolete: obsolete.name,
          desired: desired.name,
        })),
      },
      districts: {
        missing: districts.missing.map(({ name }) => name),
        mismatched: districts.mismatched.map(({ name }) => name),
        unexpected: districts.unexpected.map(({ name }) => name),
        obsolete: districts.obsoleteIndexes.map(({ name }) => name),
        replacements: districts.replacements.map(({ obsolete, desired }) => ({
          obsolete: obsolete.name,
          desired: desired.name,
        })),
      },
    },
    null,
    2,
  );

const main = async () => {
  validateTargetDatabase(targetDatabase, process.env.MONGODB_URL);
  if (apply && verifyOnly) fail("--apply and --verify cannot be combined");
  if (apply && (!confirmed || !backupConfirmed || !writersStopped)) {
    fail(
      `Apply requires --confirm=${CONFIRMATION}, --backup-confirmed, and --writers-stopped`,
    );
  }

  await mongoose.connect(process.env.MONGODB_URL, {
    autoIndex: false,
    autoCreate: false,
    readPreference: "primary",
    readConcern: { level: "majority" },
    serverSelectionTimeoutMS: 10000,
  });

  const db = mongoose.connection.db;
  const regionsCollection = db.collection("regions");
  const districtsCollection = db.collection("districts");
  const [regionIndexes, districtIndexes, regions, mappedDistricts] =
    await Promise.all([
      readIndexes(regionsCollection),
      readIndexes(districtsCollection),
      db
        .collection("regions")
        .find({}, { projection: { _id: 1, bankId: 1, name: 1, code: 1 } })
        .toArray(),
      db
        .collection("districts")
        .find(
          { geographyStatus: "MAPPED" },
          {
            projection: {
              _id: 1,
              bankId: 1,
              geographyStatus: 1,
              districtName: 1,
              districtNameNormalized: 1,
              pinCode: 1,
              pinCodeNormalized: 1,
            },
          },
        )
        .toArray(),
    ]);
  const plan = planGeographyIndexes({ regionIndexes, districtIndexes });
  console.log("Current Region indexes:");
  console.log(JSON.stringify(regionIndexes, null, 2));
  console.log("Current District indexes:");
  console.log(JSON.stringify(districtIndexes, null, 2));
  console.log("Bank-scoped geography index plan:");
  console.log(JSON.stringify(plan, null, 2));

  const districtPreflight = preflightDistrictIndexes(mappedDistricts);
  const regionConflicts = findGeographyUniqueKeyConflicts({
    banks: [],
    regions,
  });
  const regionPreflight = {
    duplicateNames: regionConflicts.regionNames,
    duplicateCodes: regionConflicts.regionCodes,
    isClean:
      regionConflicts.regionNames.length === 0 &&
      regionConflicts.regionCodes.length === 0,
  };
  const preflight = {
    regions: regionPreflight,
    districts: districtPreflight,
    isClean: regionPreflight.isClean && districtPreflight.isClean,
  };
  console.log("Bank-scoped geography unique-index preflight:");
  console.log(JSON.stringify(preflight, null, 2));
  if (!preflight.isClean) {
    fail("Geography data contains invalid mapped Districts or within-Bank duplicates");
  }

  if (!plan.regions.isRepairable || !plan.districts.isRepairable) {
    fail(
      `Index state contains mismatched or unrecognized specifications:\n${describeIndexFindings(plan)}`,
    );
  }

  if (verifyOnly) {
    const verification = verifyGeographyIndexes({
      regionIndexes,
      districtIndexes,
    });
    if (!verification.isExact) {
      fail(
        `Geography indexes do not match the exact Bank-scoped specifications:\n${describeIndexFindings(verification)}`,
      );
    }
    console.log("Region and District indexes exactly match the Bank-scoped specifications.");
    return;
  }

  if (!apply) {
    console.log(
      "Dry run only. Stop application writers, then use --apply with explicit confirmation to replace only the recognized obsolete geography indexes.",
    );
    return;
  }

  const collections = {
    regions: regionsCollection,
    districts: districtsCollection,
  };
  const createIndex = async (collection, index) => {
    const { name, key, ...options } = index;
    return collection.createIndex(key, { name, ...options });
  };
  const operations = planGeographyIndexOperations(plan);
  for (const operation of operations) {
    const collection = collections[operation.collection];
    if (operation.type === "create") {
      await createIndex(collection, operation.index);
      continue;
    }
    if (operation.type === "replace") {
      await collection.dropIndex(operation.obsolete.name);
      try {
        await createIndex(collection, operation.desired);
      } catch (replacementError) {
        const previousOptions = Object.fromEntries(
          Object.entries(operation.obsolete).filter(
            ([option]) =>
              !["name", "key", "v", "ns", "background"].includes(option),
          ),
        );
        try {
          await collection.createIndex(operation.obsolete.key, {
            name: operation.obsolete.name,
            ...previousOptions,
          });
        } catch (restoreError) {
          throw new AggregateError(
            [replacementError, restoreError],
            `Index replacement failed and the previous index could not be restored: ${operation.obsolete.name}`,
          );
        }
        throw replacementError;
      }
      continue;
    }
    await collection.dropIndex(operation.index.name);
  }

  const [finalRegionIndexes, finalDistrictIndexes] = await Promise.all([
    readIndexes(regionsCollection),
    readIndexes(districtsCollection),
  ]);
  const verification = verifyGeographyIndexes({
    regionIndexes: finalRegionIndexes,
    districtIndexes: finalDistrictIndexes,
  });
  if (!verification.isExact) {
    fail(
      `Final geography indexes are incorrect:\n${describeIndexFindings(verification)}`,
    );
  }
  console.log("Bank-scoped Region and District indexes were repaired and exactly verified.");
  console.log(
    JSON.stringify(
      { regions: finalRegionIndexes, districts: finalDistrictIndexes },
      null,
      2,
    ),
  );
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });
  main()
    .catch((error) => {
      console.error("Geography index setup failed:", error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
