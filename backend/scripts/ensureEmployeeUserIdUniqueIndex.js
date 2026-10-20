import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DuplicateEmployeeUserIdError,
  EmployeeUserIdIndexCreationError,
  EmployeeUserIdLegacyIndexRemovalError,
  ensureEmployeeUserIdUniqueIndex,
} from "../src/modules/employees/employeeUserIdIndex.js";
import {
  assertEmployeeUserIdMigrationDatabase,
  employeeUserIdMigrationConnectionOptions,
} from "./employeeUserIdMigrationDatabase.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });

mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const formatDuplicateIds = (duplicates) =>
  duplicates.map(({ userId, employeeIds, count }) => ({
    userId: String(userId),
    employeeIds: employeeIds.map(String),
    count,
  }));

const run = async () => {
  const uri = process.env.MONGODB_URL;
  if (!uri) throw new Error("MONGODB_URL is not configured");

  await mongoose.connect(uri, {
    ...employeeUserIdMigrationConnectionOptions,
    autoIndex: false,
    autoCreate: false,
    readPreference: "primary",
    readConcern: { level: "majority" },
    serverSelectionTimeoutMS: 10000,
  });
  assertEmployeeUserIdMigrationDatabase(mongoose.connection.name);

  const { default: Employee } = await import(
    "../src/modules/employees/employee.model.js"
  );
  const indexName = await ensureEmployeeUserIdUniqueIndex(
    mongoose.connection.collection(Employee.collection.collectionName),
  );
  console.log(`Employee userId unique index is ready: ${indexName}`);
};

try {
  await run();
} catch (error) {
  if (error instanceof DuplicateEmployeeUserIdError) {
    console.error(
      "Duplicate Employee.userId values found. Resolve these records manually, then rerun this command:",
    );
    console.error(JSON.stringify(formatDuplicateIds(error.duplicates), null, 2));
  } else if (error instanceof EmployeeUserIdLegacyIndexRemovalError) {
    console.error(error.message);
  } else if (error instanceof EmployeeUserIdIndexCreationError) {
    console.error(error.message);
  } else {
    console.error(
      "Employee userId index preflight failed; connection details were omitted.",
      error?.name ?? "Error",
      error?.code ?? "unknown",
    );
  }
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
