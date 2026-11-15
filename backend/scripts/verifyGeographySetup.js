import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import dotenv from "dotenv";
import {
  auditDistrictGeography,
  countDistrictGeographyIssues,
} from "../src/modules/districts/districtGeographyAudit.js";
import { verifyDistrictIndexes } from "../src/modules/districts/districtIndexSetup.js";
import {
  excludeSoftDeletedAtms,
  findGeographyUniqueKeyConflicts,
} from "../src/modules/districts/geographySetupVerification.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });

const valueFor = (prefix) =>
  process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
const targetDatabase = valueFor("--target-database=");
const fail = (message) => {
  throw new Error(message);
};

const readRecords = async (db, collectionName, projection) =>
  db.collection(collectionName).find({}, { projection }).toArray();

const readIndexes = async (collection) => {
  try {
    return await collection.listIndexes().toArray();
  } catch (error) {
    if (error.codeName === "NamespaceNotFound") return [];
    throw error;
  }
};

const main = async () => {
  if (!process.env.MONGODB_URL) fail("MONGODB_URL is required");
  if (!targetDatabase) fail("--target-database=<database-name> is required");

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

  const db = mongoose.connection.db;
  const [banks, regions, districts, atms] = await Promise.all([
    readRecords(db, "banks", { _id: 1, bankName: 1, bankCode: 1 }),
    readRecords(db, "regions", {
      _id: 1,
      bankId: 1,
      name: 1,
      code: 1,
      geographyStatus: 1,
    }),
    readRecords(db, "districts", {
      _id: 1,
      bankId: 1,
      regionId: 1,
      geographyStatus: 1,
      districtName: 1,
      districtNameNormalized: 1,
      pinCode: 1,
      pinCodeNormalized: 1,
      isActive: 1,
    }),
    readRecords(db, "atms", {
      _id: 1,
      bankId: 1,
      regionId: 1,
      districtId: 1,
      geographyStatus: 1,
      isDeleted: 1,
    }),
  ]);
  const operationalAtms = excludeSoftDeletedAtms(atms);
  const report = auditDistrictGeography({
    banks,
    regions,
    districts,
    atms: operationalAtms,
  });
  const issueCounts = countDistrictGeographyIssues(report.issues);
  const uniqueKeyConflicts = findGeographyUniqueKeyConflicts({ banks, regions });
  const uniquenessIsValid = Object.values(uniqueKeyConflicts).every(
    (conflicts) => conflicts.length === 0,
  );
  const unmapped = {
    regions: regions.filter((region) => region.geographyStatus !== "MAPPED").length,
    districts: districts.filter((district) => district.geographyStatus !== "MAPPED").length,
    atms: operationalAtms.filter((atm) => atm.geographyStatus !== "MAPPED").length,
  };
  const indexes = await readIndexes(db.collection("districts"));
  const indexVerification = verifyDistrictIndexes(indexes);
  const geographyIsValid =
    report.issues.length === 0 &&
    report.duplicateNames.length === 0 &&
    report.duplicatePincodes.length === 0 &&
    Object.values(unmapped).every((count) => count === 0);
  const result = {
    geographyIsValid,
    issueCounts,
    issues: report.issues,
    duplicateNames: report.duplicateNames,
    duplicatePincodes: report.duplicatePincodes,
    uniqueKeyConflicts,
    uniquenessIsValid,
    unmapped,
    excludedSoftDeletedAtms: atms.length - operationalAtms.length,
    indexesAreExact: indexVerification.isExact,
    indexVerification,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!geographyIsValid || !uniquenessIsValid || !indexVerification.isExact) {
    fail("Fresh geography setup verification failed");
  }
  console.log("Fresh geography and District index verification passed.");
};

main()
  .catch((error) => {
    console.error("Fresh geography verification failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
