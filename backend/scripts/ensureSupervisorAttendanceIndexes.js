import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertEmployeeUserIdMigrationDatabase,
  employeeUserIdMigrationConnectionOptions,
} from "./employeeUserIdMigrationDatabase.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });

mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const employeeIndexName = "employeeId_1_attendanceDate_1_partial";
const legacyEmployeeIndexName = "employeeId_1_attendanceDate_1";
const supervisorIndexName = "supervisorUserId_1_attendanceDate_1";
const supervisorOpenIndexName = "supervisorUserId_1_open_session";

const assertNoDuplicateSubjects = async (collection, subjectField) => {
  const duplicates = await collection
    .aggregate([
      { $match: { [subjectField]: { $type: "objectId" } } },
      {
        $group: {
          _id: {
            subjectId: `$${subjectField}`,
            attendanceDate: "$attendanceDate",
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ])
    .toArray();
  if (duplicates.length > 0) {
    throw new Error(`Duplicate ${subjectField}/attendanceDate records exist`);
  }
};

const assertNoDuplicateOpenSupervisors = async (collection) => {
  const duplicates = await collection
    .aggregate([
      {
        $match: {
          supervisorUserId: { $type: "objectId" },
          checkOutAt: null,
        },
      },
      {
        $group: {
          _id: "$supervisorUserId",
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ])
    .toArray();
  if (duplicates.length > 0) {
    throw new Error("Supervisors with multiple open attendance records exist");
  }
};

const isExpectedIndex = (index, subjectField) =>
  index &&
  index.unique === true &&
  index.key?.[subjectField] === 1 &&
  index.key?.attendanceDate === 1 &&
  index.partialFilterExpression?.[subjectField]?.$type === "objectId" &&
  Object.keys(index.key).length === 2;

const migrate = async () => {
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

  const collectionName = "attendances";
  const collectionExists = await mongoose.connection.db
    .listCollections({ name: collectionName })
    .hasNext();
  const collection = mongoose.connection.collection(collectionName);
  const malformed = await collection.countDocuments({
    $expr: {
      $eq: [
        { $eq: [{ $type: "$employeeId" }, "objectId"] },
        { $eq: [{ $type: "$supervisorUserId" }, "objectId"] },
      ],
    },
  });
  if (malformed > 0) {
    throw new Error("Attendance records must identify exactly one employee or supervisor");
  }
  await assertNoDuplicateSubjects(collection, "employeeId");
  await assertNoDuplicateSubjects(collection, "supervisorUserId");
  await assertNoDuplicateOpenSupervisors(collection);

  const indexes = collectionExists
    ? await collection.listIndexes().toArray()
    : [];
  const employeeIndex = indexes.find(({ name }) => name === employeeIndexName);
  const legacyEmployeeIndex = indexes.find(
    ({ name }) => name === legacyEmployeeIndexName,
  );
  const supervisorIndex = indexes.find(({ name }) => name === supervisorIndexName);
  const supervisorOpenIndex = indexes.find(
    ({ name }) => name === supervisorOpenIndexName,
  );
  if (
    legacyEmployeeIndex &&
    (legacyEmployeeIndex.key?.employeeId !== 1 ||
      legacyEmployeeIndex.key?.attendanceDate !== 1 ||
      legacyEmployeeIndex.unique !== true ||
      Object.keys(legacyEmployeeIndex.key).length !== 2)
  ) {
    throw new Error(
      `Unexpected index definition for ${legacyEmployeeIndexName}`,
    );
  }
  if (employeeIndex && !isExpectedIndex(employeeIndex, "employeeId")) {
    throw new Error(`Unexpected index definition for ${employeeIndexName}`);
  }
  if (
    supervisorIndex &&
    (supervisorIndex.key?.supervisorUserId !== 1 ||
      supervisorIndex.key?.attendanceDate !== 1 ||
      supervisorIndex.unique !== true ||
      Object.keys(supervisorIndex.key).length !== 2 ||
      !isExpectedIndex(supervisorIndex, "supervisorUserId"))
  ) {
    throw new Error(`Unexpected index definition for ${supervisorIndexName}`);
  }
  if (
    supervisorOpenIndex &&
    (!supervisorOpenIndex.unique ||
      supervisorOpenIndex.key?.supervisorUserId !== 1 ||
      Object.keys(supervisorOpenIndex.key).length !== 1 ||
      supervisorOpenIndex.partialFilterExpression?.supervisorUserId?.$type !==
        "objectId" ||
      supervisorOpenIndex.partialFilterExpression?.checkOutAt !== null)
  ) {
    throw new Error(`Unexpected index definition for ${supervisorOpenIndexName}`);
  }

  if (legacyEmployeeIndex) {
    await collection.dropIndex(legacyEmployeeIndexName);
  }
  try {
    if (!employeeIndex) {
      await collection.createIndex(
        { employeeId: 1, attendanceDate: 1 },
        {
          name: employeeIndexName,
          unique: true,
          partialFilterExpression: { employeeId: { $type: "objectId" } },
        },
      );
    }
  } catch (error) {
    if (legacyEmployeeIndex) {
      await collection.createIndex(
        { employeeId: 1, attendanceDate: 1 },
        { name: legacyEmployeeIndexName, unique: true },
      );
    }
    throw error;
  }
  if (!supervisorIndex) {
    await collection.createIndex(
      { supervisorUserId: 1, attendanceDate: 1 },
      {
        name: supervisorIndexName,
        unique: true,
        partialFilterExpression: { supervisorUserId: { $type: "objectId" } },
      },
    );
  }
  if (!supervisorOpenIndex) {
    await collection.createIndex(
      { supervisorUserId: 1 },
      {
        name: supervisorOpenIndexName,
        unique: true,
        partialFilterExpression: {
          supervisorUserId: { $type: "objectId" },
          checkOutAt: null,
        },
      },
    );
  }
  console.log("Supervisor attendance indexes are ready; existing records were preserved.");
};

try {
  await migrate();
} catch (error) {
  console.error(
    "Supervisor attendance index migration failed.",
    error?.message ?? "Unknown error",
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
