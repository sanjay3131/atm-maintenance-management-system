import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import dotenv from "dotenv";
import {
  auditDistrictGeography,
  countDistrictGeographyIssues,
  DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES,
} from "../src/modules/districts/districtGeographyAudit.js";
import { buildDistrictGeographyBackfill } from "../src/modules/districts/districtNormalization.js";

const CONFIRMATION = "APPLY-GEOGRAPHY-MAPPING";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });
const args = new Set(process.argv.slice(2));
const valueFor = (prefix) =>
  process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
const apply = args.has("--apply");
const verify = args.has("--verify");
const mappingPath = valueFor("--mapping=");
const targetDatabase = valueFor("--target-database=");
const confirmed = valueFor("--confirm=") === CONFIRMATION;
const backupConfirmed = args.has("--backup-confirmed");

const validId = (value) => /^[a-fA-F0-9]{24}$/.test(String(value ?? ""));
const normalized = (value) => String(value ?? "").trim().toLowerCase();
const fail = (message) => {
  throw new Error(message);
};

const validateMapping = (mapping) => {
  for (const key of ["banks", "regions", "districts", "atmAssignments"]) {
    if (!Array.isArray(mapping[key])) fail(`Mapping field "${key}" must be an array`);
  }
  for (const key of ["banks", "regions", "districts"]) {
    if (mapping[key].length === 0) fail(`Mapping field "${key}" cannot be empty`);
  }

  const idsFor = (key, rows) => {
    const ids = new Set();
    for (const row of rows) {
      if (!validId(row.id)) fail(`${key} contains an invalid id`);
      if (ids.has(row.id.toLowerCase())) fail(`${key} contains duplicate id ${row.id}`);
      ids.add(row.id.toLowerCase());
    }
    return ids;
  };
  const bankIds = idsFor("banks", mapping.banks);
  const regionIds = idsFor("regions", mapping.regions);
  const districtIds = idsFor("districts", mapping.districts);
  const atmIds = new Set();
  const regionById = new Map(
    mapping.regions.map((region) => [region.id.toLowerCase(), region]),
  );

  const bankCodes = new Set();
  const bankNames = new Set();
  for (const bank of mapping.banks) {
    if (!bank.bankName?.trim() || !bank.bankCode?.trim() || typeof bank.isActive !== "boolean") {
      fail(`Bank ${bank.id} requires bankName, bankCode, and explicit isActive`);
    }
    if (bankCodes.has(normalized(bank.bankCode))) fail(`Duplicate bank code ${bank.bankCode}`);
    if (bankNames.has(normalized(bank.bankName))) fail(`Duplicate bank name ${bank.bankName}`);
    bankCodes.add(normalized(bank.bankCode));
    bankNames.add(normalized(bank.bankName));
  }

  const regionNames = new Set();
  const regionCodes = new Set();
  for (const region of mapping.regions) {
    if (!bankIds.has(String(region.bankId).toLowerCase())) {
      fail(`Region ${region.id} references an unmapped bank`);
    }
    if (!region.name?.trim() || typeof region.isActive !== "boolean") {
      fail(`Region ${region.id} requires a name and explicit isActive`);
    }
    const nameKey = `${region.bankId}:${normalized(region.name)}`;
    if (regionNames.has(nameKey)) fail(`Duplicate region name ${region.name} within bank ${region.bankId}`);
    regionNames.add(nameKey);
    if (region.code?.trim()) {
      const codeKey = `${region.bankId}:${normalized(region.code)}`;
      if (regionCodes.has(codeKey)) fail(`Duplicate region code ${region.code} within bank ${region.bankId}`);
      regionCodes.add(codeKey);
    }
  }

  const districtNames = new Set();
  const districtPins = new Set();
  for (const district of mapping.districts) {
    const regionId = String(district.regionId).toLowerCase();
    const region = regionById.get(regionId);
    if (!regionIds.has(regionId) || !region) {
      fail(`District ${district.id} references an unmapped region`);
    }
    if (
      Object.prototype.hasOwnProperty.call(district, "bankId") ||
      Object.prototype.hasOwnProperty.call(district, "districtNameNormalized") ||
      Object.prototype.hasOwnProperty.call(district, "pinCodeNormalized")
    ) {
      fail(`District ${district.id} must not supply derived geography fields`);
    }
    if (
      !district.districtName?.trim() ||
      !district.pinCode?.trim() ||
      !district.state?.trim() ||
      typeof district.isActive !== "boolean"
    ) {
      fail(`District ${district.id} requires districtName, pinCode, state, and explicit isActive`);
    }
    const bankId = region.bankId.toLowerCase();
    const normalizedName = normalizeDistrictName(district.districtName);
    const normalizedPin = normalizeDistrictPinCode(district.pinCode);
    const nameKey = `${bankId}:${normalizedName}`;
    if (districtNames.has(nameKey)) fail(`Duplicate district name ${district.districtName} within bank ${region.bankId}`);
    districtNames.add(nameKey);
    const pinKey = `${bankId}:${normalizedPin}`;
    if (districtPins.has(pinKey)) fail(`Duplicate PIN code ${district.pinCode} within bank ${region.bankId}`);
    districtPins.add(pinKey);
  }

  for (const assignment of mapping.atmAssignments) {
    if (!assignment.atmId?.trim()) fail("ATM assignments require the business atmId");
    const atmKey = normalized(assignment.atmId);
    if (atmIds.has(atmKey)) fail(`ATM ${assignment.atmId} is mapped more than once`);
    atmIds.add(atmKey);
    if (!bankIds.has(String(assignment.bankId).toLowerCase())) {
      fail(`ATM ${assignment.atmId} references an unmapped bank`);
    }
    if (!regionIds.has(String(assignment.regionId).toLowerCase())) {
      fail(`ATM ${assignment.atmId} references an unmapped region`);
    }
    if (!districtIds.has(String(assignment.districtId).toLowerCase())) {
      fail(`ATM ${assignment.atmId} references an unmapped district`);
    }
    const region = mapping.regions.find(
      (row) => row.id.toLowerCase() === String(assignment.regionId).toLowerCase(),
    );
    const district = mapping.districts.find(
      (row) => row.id.toLowerCase() === String(assignment.districtId).toLowerCase(),
    );
    if (
      region.bankId.toLowerCase() !== String(assignment.bankId).toLowerCase() ||
      district.regionId.toLowerCase() !== String(assignment.regionId).toLowerCase()
    ) {
      fail(`ATM ${assignment.atmId} has an invalid bank-region-district hierarchy`);
    }
    const bank = mapping.banks.find(
      (row) => row.id.toLowerCase() === String(assignment.bankId).toLowerCase(),
    );
    if (!bank.isActive || !region.isActive || !district.isActive) {
      fail(`ATM ${assignment.atmId} references inactive geography`);
    }
  }
  return { mappedATMIds: atmIds, regionById };
};

const countCollections = async (db) => {
  const counts = {};
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections) {
    counts[name] = await db.collection(name).countDocuments();
  }
  return counts;
};

const printIndexes = async (db) => {
  for (const name of ["banks", "regions", "districts", "atms"]) {
    let indexes = [];
    try {
      indexes = await db.collection(name).listIndexes().toArray();
    } catch (error) {
      if (error.codeName !== "NamespaceNotFound") throw error;
    }
    console.log(`${name} indexes:`);
    console.log(JSON.stringify(indexes, null, 2));
  }
};

const countDuplicateGroups = async (collection, fields) => {
  const rows = await collection
    .aggregate([
      { $group: { _id: fields, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: "count" },
    ])
    .toArray();
  return rows[0]?.count ?? 0;
};

const main = async () => {
  if (!process.env.MONGODB_URL) fail("MONGODB_URL is required");
  if (apply && (!mappingPath || !confirmed || !backupConfirmed)) {
    fail(
      `Apply requires --mapping=<json>, --confirm=${CONFIRMATION}, and --backup-confirmed after a verified database backup`,
    );
  }

  const mapping = mappingPath
    ? JSON.parse(await fs.readFile(path.resolve(mappingPath), "utf8"))
    : null;
  if (!targetDatabase) fail("--target-database=<database-name> is required");
  const mappingValidation = mapping ? validateMapping(mapping) : null;
  const uri = new URL(process.env.MONGODB_URL);
  const uriDatabase = decodeURIComponent(uri.pathname.replace(/^\//, ""));
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
  const counts = await countCollections(db);
  const banks = await db.collection("banks").find({}, {
    projection: { _id: 1, bankName: 1, isActive: 1 },
  }).toArray();
  const regions = await db.collection("regions").find({}, {
    projection: { _id: 1, bankId: 1, name: 1, geographyStatus: 1, isActive: 1 },
  }).toArray();
  const districts = await db.collection("districts").find({}, {
    projection: {
      _id: 1,
      regionId: 1,
      bankId: 1,
      districtName: 1,
      districtNameNormalized: 1,
      pinCode: 1,
      pinCodeNormalized: 1,
      geographyStatus: 1,
      isActive: 1,
    },
  }).toArray();
  const atms = await db.collection("atms").find({}, {
    projection: { _id: 1, atmId: 1, bankId: 1, regionId: 1, districtId: 1 },
  }).toArray();
  const geographyAudit = auditDistrictGeography({ banks, regions, districts, atms });
  const bankIds = new Set(banks.map((row) => String(row._id).toLowerCase()));
  const regionIds = new Set(regions.map((row) => String(row._id).toLowerCase()));
  const [unmappedATMCount, mismatchedATMCount] = await Promise.all([
    db.collection("atms").countDocuments({
      $or: [
        { bankId: { $exists: false } },
        { regionId: { $exists: false } },
        { districtId: { $exists: false } },
        { geographyStatus: { $ne: "MAPPED" } },
      ],
    }),
    db.collection("atms").aggregate([
      {
        $lookup: {
          from: "regions",
          localField: "regionId",
          foreignField: "_id",
          as: "region",
        },
      },
      {
        $lookup: {
          from: "districts",
          localField: "districtId",
          foreignField: "_id",
          as: "district",
        },
      },
      {
        $match: {
          $expr: {
            $or: [
              { $ne: ["$bankId", { $arrayElemAt: ["$region.bankId", 0] }] },
              { $ne: ["$bankId", { $arrayElemAt: ["$district.bankId", 0] }] },
              {
                $ne: [
                  { $arrayElemAt: ["$district.bankId", 0] },
                  { $arrayElemAt: ["$region.bankId", 0] },
                ],
              },
              { $ne: ["$regionId", { $arrayElemAt: ["$district.regionId", 0] }] },
            ],
          },
        },
      },
      { $count: "count" },
    ]).toArray(),
  ]);
  const geographyIssueCounts = countDistrictGeographyIssues(
    geographyAudit.issues,
  );
  const orphanedRegions =
    geographyIssueCounts[
      DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES.REGION_MISSING_OR_INVALID_BANK
    ];
  const orphanedDistricts =
    geographyIssueCounts[
      DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES.DISTRICT_MISSING_OR_INVALID_REGION
    ];
  const atmMatches = mapping
    ? await db
        .collection("atms")
        .find(
          { atmId: { $in: mapping.atmAssignments.map((row) => row.atmId) } },
          { projection: { _id: 1, atmId: 1 } },
        )
        .toArray()
    : [];
  const mappedATMCount = atmMatches.length;
  const knownATMCount = counts.atms;
  const missingMappingIds = mapping
    ? [
        ...mapping.banks
          .filter((row) => !bankIds.has(row.id.toLowerCase()))
          .map((row) => `bank:${row.id}`),
        ...mapping.regions
          .filter((row) => !regionIds.has(row.id.toLowerCase()))
          .map((row) => `region:${row.id}`),
        ...mapping.districts
          .filter(
            (row) =>
              !districts.some(
                (district) =>
                  String(district._id).toLowerCase() === row.id.toLowerCase(),
              ),
          )
          .map((row) => `district:${row.id}`),
      ]
    : [];
  const duplicateBankNames = await countDuplicateGroups(db.collection("banks"), {
    bankName: { $toLower: { $trim: { input: "$bankName" } } },
  });
  const duplicateBankCodes = await countDuplicateGroups(db.collection("banks"), {
    bankCode: { $toUpper: { $trim: { input: "$bankCode" } } },
  });
  const duplicateRegionNames = await countDuplicateGroups(db.collection("regions"), {
    bankId: "$bankId",
    name: { $toLower: { $trim: { input: "$name" } } },
  });
  const duplicateDistrictNames = geographyAudit.duplicateNames.length;
  const duplicateRegionCodes = await countDuplicateGroups(db.collection("regions"), {
    bankId: "$bankId",
    code: { $toUpper: { $trim: { input: "$code" } } },
  });
  const duplicateDistrictPins = geographyAudit.duplicatePincodes.length;

  console.log("Geography migration audit (no operational collections are modified):");
  console.table(counts);
  console.log(`Currently unmapped/incomplete ATMs: ${unmappedATMCount}`);
  console.log(`Orphaned regions: ${orphanedRegions}`);
  console.log(`Orphaned districts: ${orphanedDistricts}`);
  console.log("District and ATM audit category counts:");
  console.table(geographyIssueCounts);
  console.log("District and ATM integrity findings:");
  console.log(JSON.stringify(geographyAudit.issues, null, 2));
  console.log("Bank-wide duplicate District groups (inactive rows included):");
  console.log(JSON.stringify({
    names: geographyAudit.duplicateNames,
    pincodes: geographyAudit.duplicatePincodes,
  }, null, 2));
  console.log("Affected ATM counts by District:");
  console.log(JSON.stringify(geographyAudit.affectedATMCounts, null, 2));
  console.log(`ATMs with inconsistent current references: ${mismatchedATMCount[0]?.count ?? 0}`);
  console.log(
    `Duplicate current geography groups: banks(name=${duplicateBankNames}, code=${duplicateBankCodes}), regions(name=${duplicateRegionNames}, code=${duplicateRegionCodes}), districts(name=${duplicateDistrictNames}, PIN=${duplicateDistrictPins})`,
  );
  console.log(
    mapping
      ? `Mapping rows: ${mapping.atmAssignments.length}; matching ATM records: ${mappedATMCount}; unmapped by supplied mapping: ${Math.max(0, knownATMCount - mappedATMCount)}`
      : "No mapping file supplied; no geography changes can be applied.",
  );
  if (missingMappingIds.length) {
    console.log(`Mapping IDs not found in this database: ${missingMappingIds.join(", ")}`);
  }
  await printIndexes(db);

  if (
    verify &&
    (geographyAudit.issues.length > 0 ||
      geographyAudit.duplicateNames.length > 0 ||
      geographyAudit.duplicatePincodes.length > 0)
  ) {
    fail("Geography verification failed; review the reported findings and resolve them manually.");
  }

  if (!apply) {
    console.log("Dry run complete. Add --apply, explicit confirmation, and verified backup acknowledgement only after reviewing the mapping report.");
    return;
  }

  if (mappedATMCount !== mapping.atmAssignments.length) {
    fail("Every supplied ATM mapping must match exactly one existing ATM.");
  }

  const mappedBankIds = mapping.banks.map((row) => new mongoose.Types.ObjectId(row.id));
  const mappedRegionIds = mapping.regions.map((row) => new mongoose.Types.ObjectId(row.id));
  const mappedDistrictIds = mapping.districts.map((row) => new mongoose.Types.ObjectId(row.id));
  if (missingMappingIds.length) {
    fail(`Mapping references geography records that do not exist: ${missingMappingIds.join(", ")}`);
  }
  const mappedATMIds = mapping.atmAssignments.map((row) => row.atmId);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const bank of mapping.banks) {
        await db.collection("banks").updateOne(
          { _id: new mongoose.Types.ObjectId(bank.id) },
          {
            $set: {
              bankName: bank.bankName.trim(),
              bankCode: bank.bankCode.trim().toUpperCase(),
              isActive: bank.isActive,
            },
          },
          { session },
        );
      }
      await db.collection("banks").updateMany(
        { _id: { $nin: mappedBankIds } },
        { $set: { isActive: false } },
        { session },
      );

      for (const region of mapping.regions) {
        await db.collection("regions").updateOne(
          { _id: new mongoose.Types.ObjectId(region.id) },
          {
            $set: {
              bankId: new mongoose.Types.ObjectId(region.bankId),
              geographyStatus: "MAPPED",
              name: region.name.trim(),
              ...(region.code?.trim() ? { code: region.code.trim().toUpperCase() } : {}),
              description: region.description?.trim() || "",
              isActive: region.isActive,
            },
            $unset: {
              districtId: "",
              ...(!region.code?.trim() ? { code: "" } : {}),
            },
          },
          { session },
        );
      }
      await db.collection("regions").updateMany(
        { _id: { $nin: mappedRegionIds } },
        {
          $set: { isActive: false, geographyStatus: "UNMAPPED" },
          $unset: { districtId: "" },
        },
        { session },
      );

      for (const district of mapping.districts) {
        const districtGeography = buildDistrictGeographyBackfill(
          district,
          mappingValidation.regionById.get(district.regionId.toLowerCase()),
        );
        const result = await db.collection("districts").updateOne(
          { _id: new mongoose.Types.ObjectId(district.id) },
          {
            $set: {
              regionId: new mongoose.Types.ObjectId(district.regionId),
              bankId: new mongoose.Types.ObjectId(districtGeography.bankId),
              geographyStatus: "MAPPED",
              districtName: district.districtName.trim(),
              districtNameNormalized: districtGeography.districtNameNormalized,
              pinCode: district.pinCode.trim(),
              pinCodeNormalized: districtGeography.pinCodeNormalized,
              state: district.state.trim(),
              isActive: district.isActive,
            },
            $unset: { regions: "" },
          },
          { session },
        );
        if (result.matchedCount !== 1) {
          fail(`District ${district.id} changed during backfill`);
        }
      }
      await db.collection("districts").updateMany(
        { _id: { $nin: mappedDistrictIds } },
        {
          $set: { isActive: false, geographyStatus: "UNMAPPED" },
          $unset: { regions: "" },
        },
        { session },
      );

      for (const assignment of mapping.atmAssignments) {
        await db.collection("atms").updateOne(
          { atmId: assignment.atmId },
          {
            $set: {
              bankId: new mongoose.Types.ObjectId(assignment.bankId),
              regionId: new mongoose.Types.ObjectId(assignment.regionId),
              districtId: new mongoose.Types.ObjectId(assignment.districtId),
              geographyStatus: "MAPPED",
            },
          },
          { session },
        );
      }
      await db.collection("atms").updateMany(
        { atmId: { $nin: mappedATMIds } },
        { $set: { geographyStatus: "UNMAPPED" } },
        { session },
      );
    }, { maxCommitTimeMS: 30000 });
  } finally {
    await session.endSession();
  }
  console.log("Mapping applied. No jobs, AMC records, complaints, attendance, financial, or audit records were deleted or rewritten.");
};

main()
  .catch((error) => {
    console.error("Geography migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
