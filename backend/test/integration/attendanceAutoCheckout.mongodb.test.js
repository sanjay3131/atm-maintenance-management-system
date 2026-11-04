import assert from "node:assert/strict";
import mongoose from "mongoose";
import test from "node:test";
import Attendance from "../../src/modules/attendance/attendance.model.js";
import {
  AUTO_CHECKOUT_AFTER_MS,
  processDueAttendanceCheckouts,
} from "../../src/modules/attendance/attendanceAutoCheckout.service.js";
import Employee from "../../src/modules/employees/employee.model.js";
import User from "../../src/modules/users/user.model.js";

const expectedDatabaseName =
  "atm_attendance_auto_checkout_integration_test";
const testMongoUri = process.env.TEST_MONGODB_URI;

if (process.env.ALLOW_LOCAL_MONGODB_INTEGRATION_TESTS !== "1") {
  throw new Error(
    "Set ALLOW_LOCAL_MONGODB_INTEGRATION_TESTS=1 to enable this integration test",
  );
}
if (!testMongoUri) {
  throw new Error("TEST_MONGODB_URI is required for this integration test");
}

const validateTestUri = (uri) => {
  let parsedUri;
  try {
    parsedUri = new URL(uri);
  } catch {
    throw new Error("TEST_MONGODB_URI is malformed");
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(parsedUri.pathname.slice(1));
  } catch {
    throw new Error("TEST_MONGODB_URI has an invalid database name");
  }

  const optionNames = [...parsedUri.searchParams.keys()];
  if (
    parsedUri.protocol !== "mongodb:" ||
    !["localhost", "127.0.0.1"].includes(parsedUri.hostname) ||
    parsedUri.username ||
    parsedUri.password ||
    parsedUri.hash ||
    databaseName !== expectedDatabaseName ||
    parsedUri.searchParams.getAll("replicaSet").length !== 1 ||
    parsedUri.searchParams.get("replicaSet") !== "rs0" ||
    optionNames.length !== 1 ||
    optionNames[0] !== "replicaSet"
  ) {
    throw new Error(
      "TEST_MONGODB_URI must target the local dedicated attendance test database with replicaSet=rs0 and no credentials or other options",
    );
  }
};

validateTestUri(testMongoUri);

const registeredModels = [Attendance, Employee, User];
const ownedIds = new Map(registeredModels.map((model) => [model, []]));
const remember = (model, document) => {
  ownedIds.get(model).push(document._id);
  return document;
};

const fixedNow = new Date("2026-10-10T12:00:00.000Z");
const objectId = () => new mongoose.Types.ObjectId();

const createUser = async (userType, suffix) =>
  remember(
    User,
    await User.create({
      firstName: `Integration ${userType}`,
      lastName: "Fixture",
      email: `${userType}-${suffix}@integration.invalid`,
      password: "test-only-password",
      phoneNumber: `integration-${userType}-${suffix}`,
      userType,
      status: "active",
    }),
  );

const createEmployeeAttendance = async ({ checkInAt }) => {
  const suffix = objectId().toString();
  const employeeUser = await createUser("employee", suffix);
  const employee = remember(
    Employee,
    await Employee.create({
      userId: employeeUser._id,
      employeeCode: `ATTENDANCE-IT-${suffix}`,
      designation: "Integration technician",
      department: "Maintenance",
      joiningDate: new Date("2026-01-01T00:00:00.000Z"),
      employmentType: "full-time",
      status: "active",
      createdBy: fixtureAdmin._id,
    }),
  );
  const attendance = remember(
    Attendance,
    await Attendance.create({
      employeeId: employee._id,
      attendanceDate: checkInAt.toISOString().slice(0, 10),
      checkInAt,
      checkInRecordedBy: employeeUser._id,
      checkInSource: "employee",
    }),
  );
  return { employee, attendance };
};

const createSupervisorAttendance = async (checkInAt) =>
  remember(
    Attendance,
    await Attendance.create({
      supervisorUserId: fixtureSupervisor._id,
      attendanceDate: checkInAt.toISOString().slice(0, 10),
      checkInAt,
      checkInRecordedBy: fixtureSupervisor._id,
      checkInSource: "supervisor",
    }),
  );

const reloadAttendance = (attendance) => Attendance.findById(attendance._id);

const runWithCompetingUpdate = async ({
  competingUpdate,
  competingFilter,
}) => {
  const originalFindOneAndUpdate = Attendance.findOneAndUpdate;
  let competitionApplied = false;

  Attendance.findOneAndUpdate = async function (filter, update, options) {
    if (update.$set?.checkOutSource === "system" && !competitionApplied) {
      competitionApplied = true;
      const competingResult = await originalFindOneAndUpdate.call(
        this,
        competingFilter,
        competingUpdate,
        { new: true, runValidators: true },
      );
      assert.ok(competingResult, "the competing update must persist first");
    }

    return originalFindOneAndUpdate.call(this, filter, update, options);
  };

  try {
    const result = await processDueAttendanceCheckouts({ now: fixedNow });
    assert.equal(competitionApplied, true);
    return result;
  } finally {
    Attendance.findOneAndUpdate = originalFindOneAndUpdate;
  }
};

let fixtureAdmin;
let fixtureSupervisor;

test("automatic attendance checkout persists safely in MongoDB", async (t) => {
  t.after(async () => {
    const cleanupErrors = [];
    for (const model of registeredModels) {
      const ids = ownedIds.get(model);
      if (!ids.length) continue;
      try {
        await model.deleteMany({ _id: { $in: ids } });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    try {
      await mongoose.disconnect();
    } catch (error) {
      cleanupErrors.push(error);
    }

    if (cleanupErrors.length) {
      throw new AggregateError(
        cleanupErrors,
        "Attendance integration fixture cleanup or disconnect failed",
      );
    }
  });

  await mongoose.connect(testMongoUri, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: false,
    autoCreate: false,
  });

  assert.equal(
    mongoose.connection.name,
    expectedDatabaseName,
    "connected database must be the dedicated test database",
  );
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  assert.equal(hello.setName, "rs0", "MongoDB must be a replica set");
  assert.equal(hello.isWritablePrimary, true, "replica-set primary is required");

  const existingCollections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const expectedCollections = new Set(
    registeredModels.map((model) => model.collection.collectionName),
  );
  assert.ok(
    existingCollections.every(({ name }) => expectedCollections.has(name)),
    "dedicated database contains an unexpected collection",
  );
  for (const { name } of existingCollections) {
    assert.equal(
      await mongoose.connection.db.collection(name).countDocuments(),
      0,
      "dedicated database must contain no documents before the suite",
    );
  }

  for (const model of registeredModels) await model.init();
  fixtureAdmin = await createUser("admin", objectId().toString());
  fixtureSupervisor = await createUser("supervisor", objectId().toString());

  await t.test("checks out due employee attendance at the exact deadline", async () => {
    const checkInAt = new Date(
      fixedNow.getTime() - AUTO_CHECKOUT_AFTER_MS - 4321,
    );
    const { attendance } = await createEmployeeAttendance({ checkInAt });
    const expectedCheckoutAt = new Date(
      checkInAt.getTime() + AUTO_CHECKOUT_AFTER_MS,
    );

    const result = await processDueAttendanceCheckouts({ now: fixedNow });
    const persisted = await reloadAttendance(attendance);

    assert.deepEqual(result, {
      candidates: 1,
      updated: 1,
      raceLost: 0,
      failed: 0,
    });
    assert.equal(persisted.checkOutAt.getTime(), expectedCheckoutAt.getTime());
    assert.notEqual(persisted.checkOutAt.getTime(), fixedNow.getTime());
    assert.equal(persisted.checkOutSource, "system");
    assert.equal(persisted.checkOutRecordedBy, null);
  });

  await t.test("leaves not-yet-due employee attendance open", async () => {
    const checkInAt = new Date(
      fixedNow.getTime() - AUTO_CHECKOUT_AFTER_MS + 1,
    );
    const { attendance } = await createEmployeeAttendance({ checkInAt });

    const result = await processDueAttendanceCheckouts({ now: fixedNow });
    const persisted = await reloadAttendance(attendance);

    assert.equal(result.candidates, 0);
    assert.equal(persisted.checkOutAt, null);
    assert.equal(persisted.checkOutSource, null);
    assert.equal(persisted.checkOutRecordedBy, null);
  });

  await t.test("leaves due supervisor attendance unchanged", async () => {
    const checkInAt = new Date(
      fixedNow.getTime() - AUTO_CHECKOUT_AFTER_MS - 1000,
    );
    const attendance = await createSupervisorAttendance(checkInAt);

    const result = await processDueAttendanceCheckouts({ now: fixedNow });
    const persisted = await reloadAttendance(attendance);

    assert.equal(result.candidates, 0);
    assert.equal(persisted.checkOutAt, null);
    assert.equal(persisted.checkOutSource, null);
    assert.equal(persisted.checkOutRecordedBy, null);
  });

  await t.test("does not overwrite a competing human checkout", async () => {
    const checkInAt = new Date(
      fixedNow.getTime() - AUTO_CHECKOUT_AFTER_MS - 1000,
    );
    const { attendance } = await createEmployeeAttendance({ checkInAt });
    const humanCheckoutAt = new Date(checkInAt.getTime() + 8 * 60 * 60 * 1000);

    const result = await runWithCompetingUpdate({
      competingFilter: {
        _id: attendance._id,
        checkInAt,
        checkOutAt: null,
      },
      competingUpdate: {
        $set: {
          checkOutAt: humanCheckoutAt,
          checkOutRecordedBy: fixtureAdmin._id,
          checkOutSource: "admin",
        },
      },
    });
    const persisted = await reloadAttendance(attendance);

    assert.deepEqual(result, {
      candidates: 1,
      updated: 0,
      raceLost: 1,
      failed: 0,
    });
    assert.equal(persisted.checkOutAt.getTime(), humanCheckoutAt.getTime());
    assert.equal(String(persisted.checkOutRecordedBy), String(fixtureAdmin._id));
    assert.equal(persisted.checkOutSource, "admin");
  });

  await t.test("does not update a candidate after its check-in is corrected", async () => {
    const checkInAt = new Date(
      fixedNow.getTime() - AUTO_CHECKOUT_AFTER_MS - 1000,
    );
    const { attendance } = await createEmployeeAttendance({ checkInAt });
    const correctedCheckInAt = new Date(fixedNow.getTime() - 60 * 60 * 1000);

    const result = await runWithCompetingUpdate({
      competingFilter: {
        _id: attendance._id,
        checkInAt,
        checkOutAt: null,
      },
      competingUpdate: { $set: { checkInAt: correctedCheckInAt } },
    });
    const persisted = await reloadAttendance(attendance);

    assert.deepEqual(result, {
      candidates: 1,
      updated: 0,
      raceLost: 1,
      failed: 0,
    });
    assert.equal(persisted.checkInAt.getTime(), correctedCheckInAt.getTime());
    assert.equal(persisted.checkOutAt, null);
    assert.equal(persisted.checkOutSource, null);
    assert.equal(persisted.checkOutRecordedBy, null);
  });

  await t.test("recovers a due record on a later run after interruption", async () => {
    const checkInAt = new Date(
      fixedNow.getTime() - AUTO_CHECKOUT_AFTER_MS - 1000,
    );
    const { attendance } = await createEmployeeAttendance({ checkInAt });
    const originalFindOneAndUpdate = Attendance.findOneAndUpdate;
    let interrupted = false;
    Attendance.findOneAndUpdate = async function (...args) {
      if (!interrupted && args[1].$set?.checkOutSource === "system") {
        interrupted = true;
        throw new Error("simulated interruption before persistence");
      }
      return originalFindOneAndUpdate.apply(this, args);
    };

    let firstResult;
    try {
      firstResult = await processDueAttendanceCheckouts({ now: fixedNow });
    } finally {
      Attendance.findOneAndUpdate = originalFindOneAndUpdate;
    }
    const afterInterruption = await reloadAttendance(attendance);
    assert.equal(interrupted, true);
    assert.equal(firstResult.failed, 1);
    assert.equal(afterInterruption.checkOutAt, null);

    const laterResult = await processDueAttendanceCheckouts({ now: fixedNow });
    const recovered = await reloadAttendance(attendance);
    assert.equal(laterResult.updated, 1);
    assert.equal(recovered.checkOutAt.getTime(), checkInAt.getTime() + AUTO_CHECKOUT_AFTER_MS);
    assert.equal(recovered.checkOutSource, "system");
    assert.equal(recovered.checkOutRecordedBy, null);
  });

  await t.test("reprocessing is idempotent for a closed attendance record", async () => {
    const checkInAt = new Date(
      fixedNow.getTime() - AUTO_CHECKOUT_AFTER_MS - 1000,
    );
    const { attendance } = await createEmployeeAttendance({ checkInAt });

    const firstResult = await processDueAttendanceCheckouts({ now: fixedNow });
    const afterFirstRun = await reloadAttendance(attendance);
    const secondResult = await processDueAttendanceCheckouts({ now: fixedNow });
    const afterSecondRun = await reloadAttendance(attendance);

    assert.equal(firstResult.updated, 1);
    assert.equal(secondResult.candidates, 0);
    assert.equal(afterSecondRun.checkOutAt.getTime(), afterFirstRun.checkOutAt.getTime());
    assert.equal(afterSecondRun.checkOutSource, afterFirstRun.checkOutSource);
    assert.equal(
      afterSecondRun.checkOutRecordedBy,
      afterFirstRun.checkOutRecordedBy,
    );
  });
});
