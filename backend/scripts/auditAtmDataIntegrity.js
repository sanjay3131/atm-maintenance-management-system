import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyATMDataIntegrity } from "../src/modules/atms/atmDataIntegrityAudit.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });

mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const loadModelCollections = async () => {
  const modelPaths = [
    ["atms", "../src/modules/atms/atm.model.js"],
    ["districts", "../src/modules/districts/district.models.js"],
    ["regions", "../src/modules/region/region.model.js"],
    ["employees", "../src/modules/employees/employee.model.js"],
    ["customers", "../src/modules/customers/customer.model.js"],
    ["jobs", "../src/modules/jobs/jobs.model.js"],
    ["amcs", "../src/modules/amc/amc.model.js"],
    [
      "recurringPlans",
      "../src/modules/jobs/recurringMaintenancePlan.model.js",
    ],
  ];
  const collections = {};
  for (const [key, modulePath] of modelPaths) {
    const { default: model } = await import(
      new URL(modulePath, import.meta.url)
    );
    collections[key] = model.collection.collectionName;
  }
  return collections;
};

const projection = {
  atms: { _id: 1, districtId: 1, regionId: 1, assignedEmployeeId: 1, customer: 1 },
  districts: { _id: 1 },
  regions: { _id: 1, districtId: 1, isActive: 1 },
  employees: { _id: 1, assignedAtmIds: 1 },
  customers: { _id: 1, atmIds: 1 },
  jobs: { _id: 1, atmId: 1 },
  amcs: { _id: 1, atmId: 1 },
  recurringPlans: { _id: 1, atmId: 1 },
};

const classifyConfiguredTarget = (uri) => {
  const parsed = new URL(uri);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  const combined = `${parsed.hostname}/${databaseName}`.toLowerCase();
  if (/test|dev|local/.test(combined)) return "test-or-development";
  if (/prod|production/.test(combined)) return "production-like";
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    return "local-unclassified";
  }
  return "remote-unclassified";
};

const run = async () => {
  const uri = process.env.MONGODB_URL;
  if (!uri) {
    throw new Error("MONGODB_URL is not configured");
  }

  const collections = await loadModelCollections();
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
    readPreference: "primary",
    readConcern: { level: "majority" },
    serverSelectionTimeoutMS: 10000,
  });

  const records = {};
  for (const [key, collectionName] of Object.entries(collections)) {
    records[key] = await mongoose.connection
      .collection(collectionName)
      .find({}, { projection: projection[key] })
      .toArray();
  }

  const report = classifyATMDataIntegrity(records);
  console.log(
    JSON.stringify(
      {
        databaseTarget: classifyConfiguredTarget(uri),
        totals: report.totals,
        softDeletedIncluded: report.softDeletedIncluded,
        issues: report.issues,
      },
      null,
      2,
    ),
  );
};

try {
  await run();
} catch (error) {
  console.error(
    "ATM data integrity audit failed; connection details were omitted.",
    error?.name ?? "Error",
    error?.code ?? "unknown",
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
