import assert from "node:assert/strict";
import mongoose from "mongoose";
import test from "node:test";
import Employee from "../../src/modules/employees/employee.model.js";
import User from "../../src/modules/users/user.model.js";
import Vehicle from "../../src/modules/vehicles/vehicle.model.js";
import VehicleAssignment from "../../src/modules/vehicles/vehicleAssignment.model.js";
import VehicleDailyMileage from "../../src/modules/vehicles/vehicleDailyMileage.model.js";
import VehicleOdometerCorrection from "../../src/modules/vehicles/vehicleOdometerCorrection.model.js";
import VehicleService from "../../src/modules/vehicles/vehicleService.model.js";
import VehicleServicePolicy from "../../src/modules/vehicles/vehicleServicePolicy.model.js";
import VehicleServiceReminder from "../../src/modules/vehicles/vehicleServiceReminder.model.js";
import VehicleUsageSession from "../../src/modules/vehicles/vehicleUsageSession.model.js";
import {
  changeVehicleStatus,
  createOdometerCorrection,
  recordVehicleService,
  transferVehicleAssignment,
  withVehicleTransaction,
} from "../../src/modules/vehicles/vehicle.service.js";
import {
  closeDailyMileage,
  handoverDailyMileage,
  getDailyMileageState,
  joinDailyMileage,
  listDailyMileageRolloverPending,
  recoverDailyMileageRollover,
  reopenDailyMileage,
  startDailyMileage,
} from "../../src/modules/vehicles/vehicleDailyMileage.service.js";
import { toAsiaKolkataDateKey } from "../../src/modules/vehicles/vehicle.utils.js";

const expectedDatabaseName = "atm_vehicle_rollover_integration_test";
const testMongoUri = process.env.TEST_MONGODB_URI;
const enabled =
  testMongoUri && process.env.ALLOW_LOCAL_MONGODB_INTEGRATION_TESTS === "1";
const integrationTest = enabled ? test : test.skip;
const models = [
  User,
  Employee,
  Vehicle,
  VehicleAssignment,
  VehicleUsageSession,
  VehicleDailyMileage,
  VehicleService,
  VehicleServicePolicy,
  VehicleServiceReminder,
  VehicleOdometerCorrection,
];
const fixtureVehicleIds = [];
const fixtureEmployeeIds = [];
const fixtureUserIds = [];
const unique = () => new mongoose.Types.ObjectId().toString();
const fixedBeforeMidnight = new Date("2026-03-19T18:29:00.000Z");
const fixedAfterMidnight = new Date("2026-03-19T18:31:00.000Z");

const assertSafeUri = (uri) => {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error("TEST_MONGODB_URI is malformed");
  }
  assert.equal(parsed.protocol, "mongodb:");
  assert.ok(["localhost", "127.0.0.1"].includes(parsed.hostname));
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.equal(
    decodeURIComponent(parsed.pathname.slice(1)),
    expectedDatabaseName,
  );
  assert.deepEqual([...parsed.searchParams.keys()], ["replicaSet"]);
  assert.deepEqual(parsed.searchParams.getAll("replicaSet"), ["rs0"]);
};

const createUser = async (userType, name = "Fixture") => {
  const suffix = unique();
  const user = await User.create({
    firstName: `${name} ${userType}`,
    lastName: "Rollover",
    email: `${userType}-${suffix}@vehicle-integration.invalid`,
    password: "integration-test-password",
    phoneNumber: `it-${userType}-${suffix}`,
    userType,
    status: "active",
  });
  fixtureUserIds.push(user._id);
  return user;
};

const createEmployee = async (actorId, label = "Employee") => {
  const user = await createUser("employee", label);
  const employee = await Employee.create({
    userId: user._id,
    employeeCode: `VR-${unique()}`,
    designation: "Integration technician",
    department: "Maintenance",
    joiningDate: new Date("2026-01-01T00:00:00.000Z"),
    employmentType: "full-time",
    status: "active",
    createdBy: actorId,
  });
  fixtureEmployeeIds.push(employee._id);
  return employee;
};

const createVehicle = async ({
  actorId,
  odometer = 500,
  primaryEmployeeId = null,
} = {}) => {
  const suffix = unique();
  const vehicle = await Vehicle.create({
    registrationNumber: `IT-${suffix.slice(-8)}`,
    registrationNumberNormalized: `IT${suffix.slice(-8)}`,
    make: "Integration",
    model: "Mileage test",
    initialOdometerKm: odometer,
    currentOdometerKm: odometer,
    primaryAssignedEmployeeId: primaryEmployeeId,
    status: "ACTIVE",
    serviceStateRevision: 0,
    createdBy: actorId ?? fixtureUserIds[0],
  });
  fixtureVehicleIds.push(vehicle._id);
  return vehicle;
};

const assign = async (vehicle, employee, actorId) =>
  VehicleAssignment.create({
    vehicleId: vehicle._id,
    employeeId: employee._id,
    assignedAt: fixedBeforeMidnight,
    assignedBy: actorId,
    reason: "Integration fixture",
  });

const assertReplicaSetAndCleanDatabase = async () => {
  assertSafeUri(testMongoUri);
  await mongoose.connect(testMongoUri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });
  assert.equal(mongoose.connection.name, expectedDatabaseName);
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  assert.equal(hello.setName, "rs0", "MongoDB must be a replica set");
  assert.equal(hello.isWritablePrimary, true, "replica-set primary is required");
  assert.ok(hello.logicalSessionTimeoutMinutes);
  const collections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const allowedCollections = new Set(
    models.map((model) => model.collection.collectionName),
  );
  assert.ok(
    collections.every(({ name }) => allowedCollections.has(name)),
    "the dedicated database contains an unexpected collection",
  );
  for (const { name } of collections) {
    assert.equal(
      await mongoose.connection.db.collection(name).countDocuments(),
      0,
      `test collection ${name} must be empty before the suite runs`,
    );
  }
  await Promise.all(models.map((model) => model.createIndexes()));
  const mileageIndexes = await VehicleDailyMileage.collection.indexes();
  assert.ok(
    mileageIndexes.some(
      (index) => index.name === "vehicle_daily_mileage_date_unique",
    ),
  );
  assert.ok(
    mileageIndexes.some(
      (index) => index.name === "vehicle_active_daily_mileage_unique",
    ),
  );
};

const cleanupFixtures = async () => {
  if (mongoose.connection.readyState !== 1) return;
  const vehicleFilter = { vehicleId: { $in: fixtureVehicleIds } };
  const employeeFilter = { _id: { $in: fixtureEmployeeIds } };
  await Promise.all([
    VehicleDailyMileage.deleteMany(vehicleFilter),
    VehicleUsageSession.deleteMany(vehicleFilter),
    VehicleService.deleteMany(vehicleFilter),
    VehicleServiceReminder.deleteMany(vehicleFilter),
    VehicleOdometerCorrection.deleteMany(vehicleFilter),
    VehicleAssignment.deleteMany({
      $or: [
        { vehicleId: { $in: fixtureVehicleIds } },
        { employeeId: { $in: fixtureEmployeeIds } },
      ],
    }),
  ]);
  await Employee.deleteMany(employeeFilter);
  await Vehicle.deleteMany({ _id: { $in: fixtureVehicleIds } });
  await User.deleteMany({ _id: { $in: fixtureUserIds } });
};

const createAdmin = async () => createUser("admin", "Test");
const vehicleUser = (user) => ({ _id: user._id, userType: "employee" });
const rejectionCode = (code) => (error) => error?.code === code;

integrationTest(
  "vehicle rollover transactions and concurrency invariants on a replica set",
  async (t) => {
    t.after(async () => {
      try {
        await cleanupFixtures();
      } finally {
        await mongoose.disconnect();
      }
    });
    await assertReplicaSetAndCleanDatabase();
    const admin = await createAdmin();

    await t.test("transaction rollback leaves no partial vehicle write", async () => {
      const registration = `ROLLBACK-${unique()}`;
      await assert.rejects(
        withVehicleTransaction(async (session) => {
          await Vehicle.create(
            [
              {
                registrationNumber: registration,
                registrationNumberNormalized: registration,
                make: "Integration",
                model: "Rollback",
                initialOdometerKm: 10,
                currentOdometerKm: 10,
                status: "ACTIVE",
                createdBy: admin._id,
              },
            ],
            { session },
          );
          throw new Error("force transaction rollback");
        }),
        /force transaction rollback/,
      );
      assert.equal(await Vehicle.exists({ registrationNumber: registration }), null);
    });

    await t.test("concurrent primary transfers preserve assignment invariants", async () => {
      const employeeA = await createEmployee(admin._id, "Source");
      const employeeB = await createEmployee(admin._id, "Target");
      const source = await createVehicle({
        actorId: admin._id,
        primaryEmployeeId: employeeA._id,
      });
      const targetAssigned = await createVehicle({
        actorId: admin._id,
        primaryEmployeeId: employeeB._id,
      });
      const targetUnassigned = await createVehicle({ actorId: admin._id });
      await assign(source, employeeA, admin._id);
      await assign(targetAssigned, employeeB, admin._id);

      const results = await Promise.allSettled([
        transferVehicleAssignment({
          employeeId: employeeA._id,
          sourceVehicleId: source._id,
          targetVehicleId: targetAssigned._id,
          expectedSourceRevision: 0,
          expectedTargetRevision: 0,
          actorId: admin._id,
        }),
        transferVehicleAssignment({
          employeeId: employeeA._id,
          sourceVehicleId: source._id,
          targetVehicleId: targetUnassigned._id,
          expectedSourceRevision: 0,
          expectedTargetRevision: 0,
          actorId: admin._id,
        }),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const [vehicles, assignments] = await Promise.all([
        Vehicle.find({ _id: { $in: [source._id, targetAssigned._id, targetUnassigned._id] } }),
        VehicleAssignment.find({
          vehicleId: { $in: [source._id, targetAssigned._id, targetUnassigned._id] },
          unassignedAt: null,
        }),
      ]);
      assert.equal(assignments.length, 2);
      for (const vehicle of vehicles) {
        const activeAssignment = assignments.find(
          (assignment) => String(assignment.vehicleId) === String(vehicle._id),
        );
        assert.equal(
          String(vehicle.primaryAssignedEmployeeId ?? ""),
          String(activeAssignment?.employeeId ?? ""),
        );
      }
      assert.equal(
        new Set(assignments.map((assignment) => String(assignment.employeeId))).size,
        assignments.length,
      );
    });

    await t.test("duplicate daily mileage starts serialize", async () => {
      const employeeA = await createEmployee(admin._id, "Daily A");
      const employeeB = await createEmployee(admin._id, "Daily B");
      const vehicle = await createVehicle({ actorId: admin._id, odometer: 900 });
      const attempts = await Promise.allSettled(
        [employeeA, employeeB].map((employee) =>
          startDailyMileage({
            user: vehicleUser(employee.userId),
            vehicleId: vehicle._id,
            startingOdometerKm: 900,
            expectedVehicleRevision: 0,
            now: fixedBeforeMidnight,
          }),
        ),
      );
      assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(
        await VehicleDailyMileage.countDocuments({ vehicleId: vehicle._id }),
        1,
      );
      assert.equal(
        await VehicleDailyMileage.countDocuments({
          vehicleId: vehicle._id,
          activeRecordLock: true,
        }),
        1,
      );
    });

    await t.test("concurrent employee handovers allow one revision winner", async () => {
      const employee = await createEmployee(admin._id, "Handover");
      const vehicle = await createVehicle({ actorId: admin._id, odometer: 1200 });
      const opened = await startDailyMileage({
        user: vehicleUser(employee.userId),
        vehicleId: vehicle._id,
        startingOdometerKm: 1200,
        expectedVehicleRevision: 0,
        now: fixedBeforeMidnight,
      });
      const handoverService = await import(
        "../../src/modules/vehicles/vehicleDailyMileage.service.js"
      );
      const results = await Promise.allSettled(
        [1250, 1260].map((endingOdometerKm) =>
          handoverService.handoverDailyMileage({
            dailyMileageId: opened._id,
            user: vehicleUser(employee.userId),
            endingOdometerKm,
            expectedVehicleRevision: 1,
            expectedDailyRevision: 0,
            now: fixedBeforeMidnight,
          }),
        ),
      );
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const record = await VehicleDailyMileage.findById(opened._id);
      assert.equal(record.revision, 1);
      assert.equal(record.segments.filter((segment) => segment.endedAt).length, 1);
      assert.ok([1250, 1260].includes(record.latestOdometerKm));
    });

    await t.test("same-day reopen is authorized, auditable, and single-winner", async () => {
      const employeeA = await createEmployee(admin._id, "Reopen owner");
      const employeeB = await createEmployee(admin._id, "Other employee");
      const vehicle = await createVehicle({ actorId: admin._id, odometer: 1300 });
      const opened = await startDailyMileage({
        user: vehicleUser(employeeA.userId),
        vehicleId: vehicle._id,
        startingOdometerKm: 1300,
        expectedVehicleRevision: 0,
        now: fixedBeforeMidnight,
      });
      const closed = await closeDailyMileage({
        user: vehicleUser(employeeA.userId),
        dailyMileageId: opened._id,
        endingOdometerKm: 1330,
        expectedVehicleRevision: 1,
        expectedDailyRevision: 0,
        now: fixedBeforeMidnight,
      });
      assert.equal(closed.status, "CLOSED");
      assert.equal(closed.auditHistory.at(-1).action, "CLOSED");
      assert.equal(
        closed.auditHistory.at(-1).employeeNameSnapshot,
        "Reopen owner employee Rollover",
      );
      const stateAfterClose = await getDailyMileageState(
        vehicleUser(employeeA.userId),
        fixedBeforeMidnight,
      );
      assert.ok(
        stateAfterClose.reopenableRecords.some(
          (record) => String(record._id) === String(closed._id),
        ),
      );

      await assert.rejects(
        reopenDailyMileage({
          dailyMileageId: closed._id,
          user: vehicleUser(employeeA.userId),
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: fixedAfterMidnight,
        }),
        rejectionCode("DAILY_MILEAGE_DATE_CLOSED"),
      );
      await assert.rejects(
        reopenDailyMileage({
          dailyMileageId: closed._id,
          user: vehicleUser(employeeB.userId),
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: fixedBeforeMidnight,
        }),
        rejectionCode("PERMISSION_DENIED"),
      );
      const attempts = await Promise.allSettled([
        reopenDailyMileage({
          dailyMileageId: closed._id,
          user: vehicleUser(employeeA.userId),
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: fixedBeforeMidnight,
        }),
        reopenDailyMileage({
          dailyMileageId: closed._id,
          user: vehicleUser(employeeA.userId),
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: fixedBeforeMidnight,
        }),
      ]);
      assert.equal(
        attempts.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const reopened = await VehicleDailyMileage.findById(closed._id);
      assert.equal(reopened.status, "OPEN");
      assert.equal(reopened.activeRecordLock, true);
      assert.equal(reopened.activeEmployeeId.toString(), employeeA._id.toString());
      assert.equal(reopened.latestOdometerKm, 1330);
      assert.equal(reopened.segments.at(-1).startOdometerKm, 1330);
      assert.equal(
        await VehicleDailyMileage.countDocuments({ vehicleId: vehicle._id }),
        1,
      );
      assert.deepEqual(
        reopened.auditHistory.map((event) => event.action),
        ["STARTED", "CLOSED", "REOPENED"],
      );
      assert.equal(reopened.auditHistory[1].odometerKm, 1330);
      assert.equal(
        reopened.auditHistory[2].employeeNameSnapshot,
        "Reopen owner employee Rollover",
      );
      await closeDailyMileage({
        dailyMileageId: closed._id,
        user: vehicleUser(employeeA.userId),
        endingOdometerKm: 1340,
        expectedVehicleRevision: 3,
        expectedDailyRevision: 2,
        now: fixedBeforeMidnight,
      });

      const handoverVehicle = await createVehicle({
        actorId: admin._id,
        odometer: 2000,
      });
      const handoverRecord = await startDailyMileage({
        user: vehicleUser(employeeA.userId),
        vehicleId: handoverVehicle._id,
        startingOdometerKm: 2000,
        expectedVehicleRevision: 0,
        now: fixedBeforeMidnight,
      });
      const handedOver = await handoverDailyMileage({
        dailyMileageId: handoverRecord._id,
        user: vehicleUser(employeeA.userId),
        endingOdometerKm: 2010,
        expectedVehicleRevision: 1,
        expectedDailyRevision: 0,
        now: fixedBeforeMidnight,
      });
      const joined = await joinDailyMileage({
        dailyMileageId: handedOver._id,
        user: vehicleUser(employeeB.userId),
        expectedVehicleRevision: 2,
        expectedDailyRevision: 1,
        now: fixedBeforeMidnight,
      });
      const closedAfterHandover = await closeDailyMileage({
        dailyMileageId: joined._id,
        user: vehicleUser(employeeB.userId),
        endingOdometerKm: 2020,
        expectedVehicleRevision: 3,
        expectedDailyRevision: 2,
        now: fixedBeforeMidnight,
      });
      await assert.rejects(
        reopenDailyMileage({
          dailyMileageId: closedAfterHandover._id,
          user: vehicleUser(employeeB.userId),
          expectedVehicleRevision: 4,
          expectedDailyRevision: 3,
          now: fixedBeforeMidnight,
        }),
        rejectionCode("DAILY_MILEAGE_HANDOVER_NOT_REOPENABLE"),
      );

      const raceVehicle = await createVehicle({
        actorId: admin._id,
        odometer: 2400,
      });
      const raceRecord = await startDailyMileage({
        user: vehicleUser(employeeA.userId),
        vehicleId: raceVehicle._id,
        startingOdometerKm: 2400,
        expectedVehicleRevision: 0,
        now: fixedBeforeMidnight,
      });
      const closeAndReopen = await Promise.allSettled([
        closeDailyMileage({
          dailyMileageId: raceRecord._id,
          user: vehicleUser(employeeA.userId),
          endingOdometerKm: 2410,
          expectedVehicleRevision: 1,
          expectedDailyRevision: 0,
          now: fixedBeforeMidnight,
        }),
        reopenDailyMileage({
          dailyMileageId: raceRecord._id,
          user: vehicleUser(employeeA.userId),
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: fixedBeforeMidnight,
        }),
      ]);
      assert.equal(closeAndReopen[0].status, "fulfilled");
      const finalRaceRecord = await VehicleDailyMileage.findById(raceRecord._id);
      assert.ok(["CLOSED", "OPEN"].includes(finalRaceRecord.status));
      assert.equal(
        closeAndReopen[1].status === "fulfilled",
        finalRaceRecord.status === "OPEN",
      );
      assert.deepEqual(
        finalRaceRecord.auditHistory.map((event) => event.action),
        finalRaceRecord.status === "OPEN"
          ? ["STARTED", "CLOSED", "REOPENED"]
          : ["STARTED", "CLOSED"],
      );
    });

    await t.test("service and current odometer update remain revision-fenced", async () => {
      const vehicle = await createVehicle({ actorId: admin._id, odometer: 700 });
      const serviceDate = toAsiaKolkataDateKey(new Date());
      const results = await Promise.allSettled([
        recordVehicleService({
          vehicleId: vehicle._id,
          input: {
            serviceType: "OIL_CHANGE",
            serviceDate,
            serviceOdometerKm: 730,
            expectedVehicleRevision: 0,
          },
          actorId: admin._id,
        }),
        createOdometerCorrection({
          vehicleId: vehicle._id,
          correctedOdometerKm: 750,
          expectedVehicleRevision: 0,
          reason: "Concurrent integration odometer update",
          actorId: admin._id,
        }),
      ]);
      assert.ok(results.some((result) => result.status === "fulfilled"));
      const [updatedVehicle, services] = await Promise.all([
        Vehicle.findById(vehicle._id),
        VehicleService.find({ vehicleId: vehicle._id }),
      ]);
      assert.ok(services.every((service) => service.serviceOdometerKm <= updatedVehicle.currentOdometerKm));
      assert.ok([1, 2].includes(updatedVehicle.serviceStateRevision));
    });

    await t.test("rollover recovery is atomic, auditable, and idempotent", async () => {
      const employeeA = await createEmployee(admin._id, "Overnight");
      const employeeB = await createEmployee(admin._id, "Morning");
      const employeeC = await createEmployee(admin._id, "Separate");
      const vehicle = await createVehicle({ actorId: admin._id, odometer: 1500 });
      const opened = await startDailyMileage({
        user: vehicleUser(employeeA.userId),
        vehicleId: vehicle._id,
        startingOdometerKm: 1500,
        expectedVehicleRevision: 0,
        now: fixedBeforeMidnight,
      });
      await assert.rejects(
        startDailyMileage({
          user: vehicleUser(employeeB.userId),
          vehicleId: vehicle._id,
          startingOdometerKm: 1500,
          expectedVehicleRevision: 1,
          now: fixedAfterMidnight,
        }),
        rejectionCode("ROLLOVER_RECOVERY_REQUIRED"),
      );

      let pending = await VehicleDailyMileage.findById(opened._id);
      assert.equal(pending.status, "ROLLOVER_PENDING");
      assert.ok(pending.auditHistory.some((event) => event.action === "ROLLOVER_PENDING"));
      const vehicleAfterPending = await Vehicle.findById(vehicle._id);
      await assert.rejects(
        reopenDailyMileage({
          dailyMileageId: opened._id,
          user: vehicleUser(employeeA.userId),
          expectedVehicleRevision: vehicleAfterPending.serviceStateRevision,
          expectedDailyRevision: pending.revision,
          now: fixedAfterMidnight,
        }),
        rejectionCode("ROLLOVER_RECOVERY_REQUIRED"),
      );
      const adminUser = { _id: admin._id, userType: "admin" };
      const pendingList = await listDailyMileageRolloverPending(
        adminUser,
        fixedAfterMidnight,
      );
      assert.ok(pendingList.records.some((record) => String(record._id) === String(opened._id)));
      const alternateVehicle = await createVehicle({
        actorId: admin._id,
        odometer: 300,
      });
      await assert.rejects(
        startDailyMileage({
          user: vehicleUser(employeeA.userId),
          vehicleId: alternateVehicle._id,
          startingOdometerKm: 300,
          expectedVehicleRevision: 0,
          now: fixedAfterMidnight,
        }),
        rejectionCode("DAILY_MILEAGE_SEGMENT_EXISTS"),
      );
      await assert.rejects(
        changeVehicleStatus({
          vehicleId: vehicle._id,
          status: "INACTIVE",
          expectedRevision: vehicleAfterPending.serviceStateRevision,
          actorId: admin._id,
        }),
        (error) => error?.statusCode === 409,
      );

      await assert.rejects(
        recoverDailyMileageRollover({
          dailyMileageId: opened._id,
          recoveryOdometerKm: 1499,
          expectedVehicleRevision: vehicleAfterPending.serviceStateRevision,
          expectedDailyRevision: pending.revision,
          user: adminUser,
          now: fixedAfterMidnight,
        }),
        rejectionCode("ODOMETER_CONFLICT"),
      );
      for (const invalidReading of [-1, 1540.5, "1540", Number.NaN]) {
        await assert.rejects(
          recoverDailyMileageRollover({
            dailyMileageId: opened._id,
            recoveryOdometerKm: invalidReading,
            expectedVehicleRevision: vehicleAfterPending.serviceStateRevision,
            expectedDailyRevision: pending.revision,
            user: adminUser,
            now: fixedAfterMidnight,
          }),
          /Recovery odometer must be a non-negative whole number/,
        );
      }

      const conflictingNextDate = await VehicleDailyMileage.create({
        vehicleId: vehicle._id,
        vehicleRegistrationSnapshot: vehicle.registrationNumber,
        businessDate: "2026-03-20",
        startOdometerKm: 1500,
        endOdometerKm: 1500,
        dailyDistanceKm: 0,
        latestOdometerKm: 1500,
        status: "CLOSED",
        activeRecordLock: false,
        createdBy: admin._id,
        updatedBy: admin._id,
      });
      try {
        await assert.rejects(
          recoverDailyMileageRollover({
            dailyMileageId: opened._id,
            recoveryOdometerKm: 1540,
            expectedVehicleRevision: vehicleAfterPending.serviceStateRevision,
            expectedDailyRevision: pending.revision,
            user: adminUser,
            now: fixedAfterMidnight,
          }),
        );
        const [unchangedPrevious, unchangedVehicle] = await Promise.all([
          VehicleDailyMileage.findById(opened._id),
          Vehicle.findById(vehicle._id),
        ]);
        assert.equal(unchangedPrevious.status, "ROLLOVER_PENDING");
        assert.equal(
          unchangedVehicle.serviceStateRevision,
          vehicleAfterPending.serviceStateRevision,
        );
      } finally {
        await VehicleDailyMileage.deleteOne({ _id: conflictingNextDate._id });
      }

      const expectedVehicleRevision = vehicleAfterPending.serviceStateRevision;
      const expectedDailyRevision = pending.revision;
      const attempts = await Promise.allSettled([
        recoverDailyMileageRollover({
          dailyMileageId: opened._id,
          recoveryOdometerKm: 1540,
          expectedVehicleRevision,
          expectedDailyRevision,
          user: adminUser,
          now: fixedAfterMidnight,
        }),
        recoverDailyMileageRollover({
          dailyMileageId: opened._id,
          recoveryOdometerKm: 1540,
          expectedVehicleRevision,
          expectedDailyRevision,
          user: adminUser,
          now: fixedAfterMidnight,
        }),
      ]);
      assert.equal(
        attempts.filter((result) => result.status === "fulfilled").length,
        2,
        JSON.stringify(
          attempts.map((result) =>
            result.status === "rejected"
              ? {
                  code: result.reason?.code,
                  message: result.reason?.message,
                  stack: result.reason?.stack,
                }
              : { replayed: result.value.replayed },
          ),
        ),
      );
      assert.equal(
        attempts.filter(
          (result) => result.status === "fulfilled" && !result.value.replayed,
        ).length,
        1,
      );
      assert.equal(
        attempts.filter(
          (result) => result.status === "fulfilled" && result.value.replayed,
        ).length,
        1,
      );
      const recoveryResult = attempts.find(
        (result) => result.status === "fulfilled" && !result.value.replayed,
      )?.value ?? attempts.find((result) => result.status === "fulfilled")?.value;
      assert.ok(recoveryResult);
      const [previous, next, vehicleAfterRecovery] = await Promise.all([
        VehicleDailyMileage.findById(opened._id),
        VehicleDailyMileage.findOne({
          vehicleId: vehicle._id,
          businessDate: "2026-03-20",
        }),
        Vehicle.findById(vehicle._id),
      ]);
      assert.equal(previous.status, "CLOSED");
      assert.equal(previous.endOdometerKm, 1540);
      assert.equal(previous.dailyDistanceKm, 40);
      assert.equal(previous.segments[0].distanceKm, 40);
      assert.equal(previous.activeEmployeeId, null);
      assert.equal(next.startOdometerKm, 1540);
      assert.equal(String(next.activeEmployeeId), String(employeeA._id));
      assert.equal(next.segments[0].startOdometerKm, 1540);
      assert.equal(vehicleAfterRecovery.currentOdometerKm, 1540);
      const recoveredAudit = previous.auditHistory.find(
        (event) => event.action === "ROLLOVER_RECOVERED",
      );
      assert.match(recoveredAudit.details, /allocated to the previous business date/);
      assert.equal(recoveredAudit.nextBusinessDate, "2026-03-20");
      assert.ok(next.auditHistory.some((event) => event.action === "ROLLOVER_STARTED"));
      assert.equal(
        await VehicleDailyMileage.countDocuments({
          vehicleId: vehicle._id,
          businessDate: "2026-03-20",
        }),
        1,
      );

      const retry = await recoverDailyMileageRollover({
        dailyMileageId: opened._id,
        recoveryOdometerKm: 1540,
        expectedVehicleRevision,
        expectedDailyRevision,
        user: adminUser,
        now: new Date("2026-03-20T12:00:00.000Z"),
      });
      assert.equal(retry.replayed, true);

      const explicitVehicle = await createVehicle({
        actorId: admin._id,
        odometer: 1700,
      });
      const explicitStart = await startDailyMileage({
        user: vehicleUser(employeeC.userId),
        vehicleId: explicitVehicle._id,
        startingOdometerKm: 1700,
        expectedVehicleRevision: 0,
        now: fixedBeforeMidnight,
      });
      const explicitPending = await listDailyMileageRolloverPending(
        adminUser,
        fixedAfterMidnight,
      );
      const explicitRecord = explicitPending.records.find(
        (record) => String(record._id) === String(explicitStart._id),
      );
      const explicitVehicleState = await Vehicle.findById(explicitVehicle._id);
      const explicitRecovery = await recoverDailyMileageRollover({
        dailyMileageId: explicitStart._id,
        recoveryOdometerKm: 1710,
        expectedVehicleRevision: explicitVehicleState.serviceStateRevision,
        expectedDailyRevision: explicitRecord.revision,
        nextEmployeeId: employeeB._id,
        user: adminUser,
        now: fixedAfterMidnight,
      });
      assert.equal(
        String(explicitRecovery.dailyRecord.activeEmployeeId),
        String(employeeB._id),
      );
      assert.equal(
        explicitRecovery.previousRecord.segments[0].employeeId.toString(),
        employeeC._id.toString(),
      );
    });
  },
);
