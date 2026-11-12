import assert from "node:assert/strict";
import mongoose from "mongoose";
import test from "node:test";
import Employee from "../../src/modules/employees/employee.model.js";
import User from "../../src/modules/users/user.model.js";
import Vehicle from "../../src/modules/vehicles/vehicle.model.js";
import VehicleDailyMileage from "../../src/modules/vehicles/vehicleDailyMileage.model.js";
import {
  addDailyMileageReading,
  closeDailyMileage,
  completeDailyMileageUsageSession,
  getDailyMileageHistory,
  getDailyMileageState,
  handoverDailyMileage,
  joinDailyMileage,
  recoverDailyMileageRollover,
  reopenDailyMileage,
  startDailyMileage,
  startDailyMileageUsageSession,
} from "../../src/modules/vehicles/vehicleDailyMileage.service.js";

const expectedDatabaseName = "atm_vehicle_rollover_integration_test";
const testMongoUri = process.env.TEST_MONGODB_URI;
const enabled =
  testMongoUri && process.env.ALLOW_LOCAL_MONGODB_INTEGRATION_TESTS === "1";
const integrationTest = enabled ? test : test.skip;
const fixtureVehicleIds = [];
const fixtureEmployeeIds = [];
const fixtureUserIds = [];
const unique = () => new mongoose.Types.ObjectId().toString();
const fixedNow = new Date("2026-03-19T17:00:00.000Z");
const fixedAfterMidnight = new Date("2026-03-19T18:31:00.000Z");
const vehicleUser = (user) => ({ _id: user._id, userType: "employee" });

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

const createEmployee = async () => {
  const suffix = unique();
  const user = await User.create({
    firstName: "Mileage Integration",
    lastName: "Employee",
    email: `mileage-${suffix}@vehicle-integration.invalid`,
    password: "integration-test-password",
    phoneNumber: `it-${suffix}`,
    userType: "employee",
    status: "active",
  });
  fixtureUserIds.push(user._id);
  const employee = await Employee.create({
    userId: user._id,
    employeeCode: `MI-${suffix}`,
    designation: "Integration technician",
    department: "Maintenance",
    joiningDate: new Date("2026-01-01T00:00:00.000Z"),
    employmentType: "full-time",
    status: "active",
    createdBy: user._id,
  });
  fixtureEmployeeIds.push(employee._id);
  return { employee, user };
};

const createVehicle = async (actorId, odometerKm) => {
  const suffix = unique();
  const vehicle = await Vehicle.create({
    registrationNumber: `MI-${suffix.slice(-8)}`,
    registrationNumberNormalized: `MI${suffix.slice(-8)}`,
    make: "Integration",
    model: "Mileage idempotency test",
    initialOdometerKm: odometerKm,
    currentOdometerKm: odometerKm,
    status: "ACTIVE",
    serviceStateRevision: 0,
    createdBy: actorId,
  });
  fixtureVehicleIds.push(vehicle._id);
  return vehicle;
};

const createLegacyActiveSegmentState = async ({
  record,
  vehicle,
  existingReadings = [],
}) => {
  const startingOdometerKm = record.startOdometerKm;
  const latestOdometerKm = startingOdometerKm + 20;
  const segment = record.segments[0].toObject();
  await VehicleDailyMileage.updateOne(
    { _id: record._id },
    {
      $set: {
        latestOdometerKm,
        dailyDistanceKm: 20,
        revision: record.revision + 1,
        segments: [
          {
            ...segment,
            endOdometerKm: null,
            distanceKm: 20,
            odometerReadingsComplete: false,
            odometerReadings: existingReadings,
          },
        ],
      },
    },
  );
  await Vehicle.updateOne(
    { _id: vehicle._id },
    {
      $set: { currentOdometerKm: latestOdometerKm },
      $inc: { serviceStateRevision: 1 },
    },
  );
  const [legacyRecord, legacyVehicle] = await Promise.all([
    VehicleDailyMileage.findById(record._id),
    Vehicle.findById(vehicle._id),
  ]);
  return { legacyRecord, legacyVehicle, latestOdometerKm };
};

const createAdmin = async () => {
  const suffix = unique();
  const user = await User.create({
    firstName: "Mileage Integration Admin",
    lastName: "Operator",
    email: `admin-${suffix}@vehicle-integration.invalid`,
    password: "integration-test-password",
    phoneNumber: `admin-${suffix}`,
    userType: "admin",
    status: "active",
  });
  fixtureUserIds.push(user._id);
  return user;
};

const connectToEmptyReplicaSetDatabase = async () => {
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
    [User, Employee, Vehicle, VehicleDailyMileage].map(
      (model) => model.collection.collectionName,
    ),
  );
  assert.ok(
    collections.every(({ name }) => allowedCollections.has(name)),
    "the dedicated database contains an unexpected collection",
  );
  for (const { name } of collections) {
    assert.equal(
      await mongoose.connection.db.collection(name).countDocuments(),
      0,
      `test collection ${name} must be empty before the test runs`,
    );
  }
  await Promise.all(
    [User, Employee, Vehicle, VehicleDailyMileage].map((model) =>
      model.createIndexes(),
    ),
  );
};

const cleanupFixtures = async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Promise.all([
    VehicleDailyMileage.deleteMany({
      vehicleId: { $in: fixtureVehicleIds },
    }),
    Employee.deleteMany({ _id: { $in: fixtureEmployeeIds } }),
    Vehicle.deleteMany({ _id: { $in: fixtureVehicleIds } }),
    User.deleteMany({ _id: { $in: fixtureUserIds } }),
  ]);
};

const readLatestState = async (vehicleId, dailyMileageId) => {
  const [vehicle, record] = await Promise.all([
    Vehicle.findById(vehicleId).lean(),
    VehicleDailyMileage.findById(dailyMileageId).lean(),
  ]);
  return { vehicle, record };
};

integrationTest(
  "daily mileage request idempotency and concurrency on a replica set",
  async (t) => {
    t.after(async () => {
      try {
        await cleanupFixtures();
      } finally {
        await mongoose.disconnect();
      }
    });
    await connectToEmptyReplicaSetDatabase();

    await t.test(
      "handover and close boundaries are recorded once across employee segments",
      async () => {
        const { user: employeeAUser } = await createEmployee();
        const { user: employeeBUser } = await createEmployee();
        const employeeA = vehicleUser(employeeAUser);
        const employeeB = vehicleUser(employeeBUser);
        const vehicle = await createVehicle(employeeAUser._id, 1000);
        const record = await startDailyMileage({
          user: employeeA,
          vehicleId: vehicle._id,
          startingOdometerKm: 1000,
          expectedVehicleRevision: 0,
          now: fixedNow,
        });
        await addDailyMileageReading({
          dailyMileageId: record._id,
          user: employeeA,
          requestId: `before-handover-${unique()}`,
          odometerKm: 1010,
          expectedVehicleRevision: 1,
          expectedDailyRevision: 0,
          now: fixedNow,
        });
        const handedOver = await handoverDailyMileage({
          dailyMileageId: record._id,
          user: employeeA,
          endingOdometerKm: 1020,
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: fixedNow,
        });
        await assert.rejects(
          addDailyMileageReading({
            dailyMileageId: record._id,
            user: employeeA,
            requestId: `after-handover-${unique()}`,
            odometerKm: 1021,
            expectedVehicleRevision: 3,
            expectedDailyRevision: 2,
            now: fixedNow,
          }),
          (error) => error?.code === "PERMISSION_DENIED",
        );
        const joined = await joinDailyMileage({
          dailyMileageId: record._id,
          user: employeeB,
          expectedVehicleRevision: 3,
          expectedDailyRevision: 2,
          now: fixedNow,
        });
        assert.deepEqual(joined.segments[1].odometerReadings, []);
        const closed = await closeDailyMileage({
          dailyMileageId: record._id,
          user: employeeB,
          endingOdometerKm: 1030,
          expectedVehicleRevision: 4,
          expectedDailyRevision: 3,
          now: fixedNow,
        });
        assert.deepEqual(
          closed.segments.map((segment) => [
            segment.distanceKm,
            segment.odometerReadings.reduce(
              (total, reading) => total + reading.distanceKm,
              0,
            ),
          ]),
          [
            [20, 20],
            [10, 10],
          ],
        );
        assert.equal(closed.dailyDistanceKm, 30);
        assert.deepEqual(
          closed.segments.flatMap((segment) =>
            segment.odometerReadings.map((reading) => [
              reading.odometerKm,
              reading.employeeNameSnapshot,
              reading.source,
            ]),
          ),
          [
            [1000, "Mileage Integration Employee", "BASELINE"],
            [1010, "Mileage Integration Employee", "EMPLOYEE_SUBMISSION"],
            [1020, "Mileage Integration Employee", "HANDOVER"],
            [1030, "Mileage Integration Employee", "CLOSE"],
          ],
        );
        const [persistedVehicle, persistedRecord] = await Promise.all([
          Vehicle.findById(vehicle._id),
          VehicleDailyMileage.findById(record._id),
        ]);
        assert.equal(persistedVehicle.currentOdometerKm, 1030);
        assert.equal(persistedRecord.latestOdometerKm, 1030);
      },
    );

    await t.test(
      "repeated daily sessions support A to B to A handovers and fence stale replay data",
      async () => {
        const { employee: employeeAProfile, user: employeeAUser } =
          await createEmployee();
        const { employee: employeeBProfile, user: employeeBUser } =
          await createEmployee();
        const employeeA = vehicleUser(employeeAUser);
        const employeeB = vehicleUser(employeeBUser);
        const vehicle = await createVehicle(employeeAUser._id, 3000);
        const record = await startDailyMileage({
          user: employeeA,
          vehicleId: vehicle._id,
          startingOdometerKm: 3000,
          expectedVehicleRevision: 0,
          now: fixedNow,
        });

        const firstSessionStart = await startDailyMileageUsageSession({
          dailyMileageId: record._id,
          user: employeeA,
          requestId: "employee-a-session-1",
          expectedVehicleRevision: 1,
          expectedDailyRevision: 0,
          now: fixedNow,
        });
        assert.equal(firstSessionStart.segments[0].usageSessions.length, 1);
        const firstSessionEnd = await completeDailyMileageUsageSession({
          dailyMileageId: record._id,
          user: employeeA,
          requestId: "employee-a-complete-1",
          endingOdometerKm: 3010,
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: fixedNow,
        });
        assert.equal(firstSessionEnd.status, "OPEN");
        assert.equal(
          firstSessionEnd.activeEmployeeId.toString(),
          employeeAProfile._id.toString(),
        );
        const readingsAfterFirstCompletion =
          firstSessionEnd.segments[0].odometerReadings.length;
        const replayedFirstCompletion =
          await completeDailyMileageUsageSession({
            dailyMileageId: record._id,
            user: employeeA,
            requestId: "employee-a-complete-1",
            endingOdometerKm: 3010,
            expectedVehicleRevision: 2,
            expectedDailyRevision: 1,
            now: fixedNow,
          });
        assert.equal(replayedFirstCompletion.replayed, true);
        assert.equal(
          replayedFirstCompletion.segments[0].odometerReadings.length,
          readingsAfterFirstCompletion,
        );

        await startDailyMileageUsageSession({
          dailyMileageId: record._id,
          user: employeeA,
          requestId: "employee-a-session-2",
          expectedVehicleRevision: 3,
          expectedDailyRevision: 2,
          now: fixedNow,
        });
        const secondSessionEnd = await completeDailyMileageUsageSession({
          dailyMileageId: record._id,
          user: employeeA,
          requestId: "employee-a-complete-2",
          endingOdometerKm: 3020,
          expectedVehicleRevision: 4,
          expectedDailyRevision: 3,
          now: fixedNow,
        });
        assert.equal(secondSessionEnd.status, "OPEN");
        assert.equal(secondSessionEnd.segments[0].usageSessions.length, 2);

        await handoverDailyMileage({
          dailyMileageId: record._id,
          user: employeeA,
          endingOdometerKm: 3030,
          expectedVehicleRevision: 5,
          expectedDailyRevision: 4,
          now: fixedNow,
        });
        await joinDailyMileage({
          dailyMileageId: record._id,
          user: employeeB,
          expectedVehicleRevision: 6,
          expectedDailyRevision: 5,
          now: fixedNow,
        });
        const employeeAHistory = await getDailyMileageHistory({
          user: employeeA,
          page: 1,
          limit: 10,
        });
        const employeeAHistoryRecord = employeeAHistory.records.find(
          (item) => item._id.toString() === record._id.toString(),
        );
        assert.ok(employeeAHistoryRecord);
        assert.equal(employeeAHistoryRecord.activeEmployeeId, null);
        assert.ok(
          employeeAHistoryRecord.segments.every(
            (segment) =>
              segment.employeeId.toString() ===
              employeeAProfile._id.toString(),
          ),
        );
        assert.ok(
          employeeAHistoryRecord.auditHistory.every(
            (event) =>
              event.employeeId?.toString() ===
                employeeAProfile._id.toString() ||
              event.actorId.toString() === employeeAUser._id.toString(),
          ),
        );

        const staleReplay = await completeDailyMileageUsageSession({
          dailyMileageId: record._id,
          user: employeeA,
          requestId: "employee-a-complete-1",
          endingOdometerKm: 3010,
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: fixedNow,
        });
        assert.equal(staleReplay.replayed, true);
        assert.ok(
          staleReplay.segments.every(
            (segment) =>
              segment.employeeId.toString() ===
              employeeAProfile._id.toString(),
          ),
        );
        assert.equal(staleReplay.activeEmployeeId, null);
        assert.ok(
          staleReplay.auditHistory.every(
            (event) =>
              event.employeeId?.toString() ===
              employeeAProfile._id.toString(),
          ),
        );

        await startDailyMileageUsageSession({
          dailyMileageId: record._id,
          user: employeeB,
          requestId: "employee-b-session-1",
          expectedVehicleRevision: 7,
          expectedDailyRevision: 6,
          now: fixedNow,
        });
        const employeeBCompleted = await completeDailyMileageUsageSession({
          dailyMileageId: record._id,
          user: employeeB,
          requestId: "employee-b-complete-1",
          endingOdometerKm: 3040,
          expectedVehicleRevision: 8,
          expectedDailyRevision: 7,
          now: fixedNow,
        });
        assert.equal(employeeBCompleted.segments[1].usageSessions.length, 1);
        await handoverDailyMileage({
          dailyMileageId: record._id,
          user: employeeB,
          endingOdometerKm: 3050,
          expectedVehicleRevision: 9,
          expectedDailyRevision: 8,
          now: fixedNow,
        });
        await joinDailyMileage({
          dailyMileageId: record._id,
          user: employeeA,
          expectedVehicleRevision: 10,
          expectedDailyRevision: 9,
          now: fixedNow,
        });
        await startDailyMileageUsageSession({
          dailyMileageId: record._id,
          user: employeeA,
          requestId: "employee-a-session-3",
          expectedVehicleRevision: 11,
          expectedDailyRevision: 10,
          now: fixedNow,
        });
        const finalRecord = await completeDailyMileageUsageSession({
          dailyMileageId: record._id,
          user: employeeA,
          requestId: "employee-a-complete-3",
          endingOdometerKm: 3060,
          expectedVehicleRevision: 12,
          expectedDailyRevision: 11,
          now: fixedNow,
        });

        assert.equal(finalRecord.status, "OPEN");
        assert.equal(
          finalRecord.activeEmployeeId.toString(),
          employeeAProfile._id.toString(),
        );
        assert.equal(finalRecord.dailyDistanceKm, 60);
        assert.deepEqual(
          finalRecord.segments.map((segment) => [
            segment.employeeId.toString(),
            segment.distanceKm,
            segment.usageSessions.length,
            segment.usageSessions.reduce(
              (total, usageSession) => total + usageSession.distanceKm,
              0,
            ),
          ]),
          [
            [employeeAProfile._id.toString(), 30, 2, 20],
            [employeeBProfile._id.toString(), 20, 1, 10],
            [employeeAProfile._id.toString(), 10, 1, 10],
          ],
        );
        const persisted = await VehicleDailyMileage.findById(record._id);
        assert.equal(persisted.segments.length, 3);
        assert.equal(
          persisted.segments.flatMap((segment) => segment.usageSessions).length,
          4,
        );
        assert.equal(persisted.latestOdometerKm, 3060);
      },
    );

    await t.test(
      "legacy segments preserve prior distance across readings and lifecycle boundaries",
      async () => {
        const admin = await createAdmin();
        for (const boundary of ["reading", "handover", "close", "rollover"]) {
          const { user: employeeAUser } = await createEmployee();
          const { employee: employeeB, user: employeeBUser } =
            await createEmployee();
          const actor = vehicleUser(employeeAUser);
          const vehicle = await createVehicle(employeeAUser._id, 2000);
          const record = await startDailyMileage({
            user: actor,
            vehicleId: vehicle._id,
            startingOdometerKm: 2000,
            expectedVehicleRevision: 0,
            now: fixedNow,
          });
          const {
            legacyRecord,
            legacyVehicle,
            latestOdometerKm,
          } = await createLegacyActiveSegmentState({ record, vehicle });
          let previousRecord = legacyRecord;

          if (boundary === "reading") {
            await addDailyMileageReading({
              dailyMileageId: record._id,
              user: actor,
              requestId: `legacy-reading-${unique()}`,
              odometerKm: 2030,
              expectedVehicleRevision: legacyVehicle.serviceStateRevision,
              expectedDailyRevision: legacyRecord.revision,
              now: fixedNow,
            });
            previousRecord = await VehicleDailyMileage.findById(record._id);
          } else if (boundary === "handover") {
            await handoverDailyMileage({
              dailyMileageId: record._id,
              user: actor,
              endingOdometerKm: 2030,
              expectedVehicleRevision: legacyVehicle.serviceStateRevision,
              expectedDailyRevision: legacyRecord.revision,
              now: fixedNow,
            });
            previousRecord = await VehicleDailyMileage.findById(record._id);
          } else if (boundary === "close") {
            await closeDailyMileage({
              dailyMileageId: record._id,
              user: actor,
              endingOdometerKm: 2030,
              expectedVehicleRevision: legacyVehicle.serviceStateRevision,
              expectedDailyRevision: legacyRecord.revision,
              now: fixedNow,
            });
            previousRecord = await VehicleDailyMileage.findById(record._id);
          } else {
            await assert.rejects(
              startDailyMileage({
                user: vehicleUser(employeeBUser),
                vehicleId: vehicle._id,
                startingOdometerKm: latestOdometerKm,
                expectedVehicleRevision: legacyVehicle.serviceStateRevision,
                now: fixedAfterMidnight,
              }),
              (error) => error?.code === "ROLLOVER_RECOVERY_REQUIRED",
            );
            previousRecord = await VehicleDailyMileage.findById(record._id);
            const pendingVehicle = await Vehicle.findById(vehicle._id);
            const recovered = await recoverDailyMileageRollover({
              dailyMileageId: record._id,
              recoveryOdometerKm: 2030,
              expectedVehicleRevision: pendingVehicle.serviceStateRevision,
              expectedDailyRevision: previousRecord.revision,
              nextEmployeeId: employeeB._id,
              user: { _id: admin._id, userType: "admin" },
              now: fixedAfterMidnight,
            });
            previousRecord = await VehicleDailyMileage.findById(record._id);
            assert.equal(
              recovered.dailyRecord.startOdometerKm,
              2030,
            );
          }

          assert.equal(previousRecord.startOdometerKm, 2000);
          assert.equal(previousRecord.latestOdometerKm, 2030);
          assert.equal(previousRecord.dailyDistanceKm, 30);
          assert.equal(previousRecord.segments[0].distanceKm, 30);
          assert.equal(previousRecord.segments[0].odometerReadingsComplete, false);
          assert.deepEqual(
            previousRecord.segments[0].odometerReadings.map((reading) => [
              reading.odometerKm,
              reading.distanceKm,
              reading.source,
            ]),
            [[2030, 10, boundary === "reading"
              ? "EMPLOYEE_SUBMISSION"
              : boundary === "handover"
                ? "HANDOVER"
                : boundary === "close"
                  ? "CLOSE"
                  : "ROLLOVER_RECOVERY"]],
          );
          assert.equal(
            (await Vehicle.findById(vehicle._id)).currentOdometerKm,
            2030,
          );
        }
      },
    );

    await t.test(
      "partially tracked legacy readings stay incomplete without synthetic entries",
      async () => {
        const { user } = await createEmployee();
        const actor = vehicleUser(user);
        const vehicle = await createVehicle(user._id, 2100);
        const record = await startDailyMileage({
          user: actor,
          vehicleId: vehicle._id,
          startingOdometerKm: 2100,
          expectedVehicleRevision: 0,
          now: fixedNow,
        });
        const partialReading = {
          odometerKm: 2105,
          distanceKm: 5,
          occurredAt: fixedNow,
          employeeId: record.segments[0].employeeId,
          employeeNameSnapshot: record.segments[0].employeeNameSnapshot,
          employeeCodeSnapshot: record.segments[0].employeeCodeSnapshot,
          source: "EMPLOYEE_SUBMISSION",
        };
        const {
          legacyRecord,
          legacyVehicle,
        } = await createLegacyActiveSegmentState({
          record,
          vehicle,
          existingReadings: [partialReading],
        });
        await addDailyMileageReading({
          dailyMileageId: record._id,
          user: actor,
          requestId: `partial-history-${unique()}`,
          odometerKm: 2130,
          expectedVehicleRevision: legacyVehicle.serviceStateRevision,
          expectedDailyRevision: legacyRecord.revision,
          now: fixedNow,
        });
        const persisted = await VehicleDailyMileage.findById(record._id);
        assert.equal(persisted.segments[0].distanceKm, 30);
        assert.equal(persisted.segments[0].odometerReadingsComplete, false);
        assert.deepEqual(
          persisted.segments[0].odometerReadings.map((reading) => [
            reading.odometerKm,
            reading.distanceKm,
          ]),
          [
            [2105, 5],
            [2130, 10],
          ],
        );
        assert.equal((await Vehicle.findById(vehicle._id)).currentOdometerKm, 2130);
      },
    );

    await t.test(
      "unchanged handover and close do not duplicate readings",
      async () => {
        const { user: employeeAUser } = await createEmployee();
        const { user: employeeBUser } = await createEmployee();
        const vehicle = await createVehicle(employeeAUser._id, 1100);
        const actorA = vehicleUser(employeeAUser);
        const actorB = vehicleUser(employeeBUser);
        const record = await startDailyMileage({
          user: actorA,
          vehicleId: vehicle._id,
          startingOdometerKm: 1100,
          expectedVehicleRevision: 0,
          now: fixedNow,
        });
        const attempts = await Promise.allSettled([
          handoverDailyMileage({
            dailyMileageId: record._id,
            user: actorA,
            endingOdometerKm: 1100,
            expectedVehicleRevision: 1,
            expectedDailyRevision: 0,
            now: fixedNow,
          }),
          handoverDailyMileage({
            dailyMileageId: record._id,
            user: actorA,
            endingOdometerKm: 1100,
            expectedVehicleRevision: 1,
            expectedDailyRevision: 0,
            now: fixedNow,
          }),
        ]);
        assert.equal(
          attempts.filter((result) => result.status === "fulfilled").length,
          1,
        );
        const afterHandover = await VehicleDailyMileage.findById(record._id);
        assert.equal(afterHandover.segments[0].odometerReadings.length, 1);
        assert.equal(
          afterHandover.auditHistory.filter(
            (entry) => entry.action === "HANDOVER",
          ).length,
          1,
        );
        const joined = await joinDailyMileage({
          dailyMileageId: record._id,
          user: actorB,
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: fixedNow,
        });
        const closed = await closeDailyMileage({
          dailyMileageId: record._id,
          user: actorB,
          endingOdometerKm: 1100,
          expectedVehicleRevision: 3,
          expectedDailyRevision: 2,
          now: fixedNow,
        });
        assert.equal(joined.segments[1].odometerReadings.length, 0);
        assert.equal(closed.segments[1].odometerReadings.length, 0);
        assert.equal(closed.dailyDistanceKm, 0);
        assert.equal(
          closed.auditHistory.filter((entry) => entry.action === "CLOSED")
            .length,
          1,
        );
      },
    );

    await t.test(
      "closed record remains undoable after a handover by the employee who closed it",
      async () => {
        const { user: employeeAUser } = await createEmployee();
        const { user: employeeBUser } = await createEmployee();
        const employeeA = vehicleUser(employeeAUser);
        const employeeB = vehicleUser(employeeBUser);
        const vehicle = await createVehicle(employeeAUser._id, 1250);
        const opened = await startDailyMileage({
          user: employeeA,
          vehicleId: vehicle._id,
          startingOdometerKm: 1250,
          expectedVehicleRevision: 0,
          now: fixedNow,
        });
        const handedOver = await handoverDailyMileage({
          dailyMileageId: opened._id,
          user: employeeA,
          endingOdometerKm: 1255,
          expectedVehicleRevision: 1,
          expectedDailyRevision: 0,
          now: fixedNow,
        });
        const joined = await joinDailyMileage({
          dailyMileageId: opened._id,
          user: employeeB,
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: fixedNow,
        });
        const closed = await closeDailyMileage({
          dailyMileageId: opened._id,
          user: employeeB,
          endingOdometerKm: 1260,
          expectedVehicleRevision: 3,
          expectedDailyRevision: 2,
          now: fixedNow,
        });
        const state = await getDailyMileageState(employeeB, fixedNow);
        const undoRecord = state.reopenableRecords.find(
          (record) => record._id.toString() === closed._id.toString(),
        );
        assert.ok(undoRecord, "the employee should see the undo action");
        const reopened = await reopenDailyMileage({
          dailyMileageId: closed._id,
          user: employeeB,
          expectedVehicleRevision: undoRecord.vehicleRevision,
          expectedDailyRevision: undoRecord.revision,
          now: fixedNow,
        });
        assert.equal(reopened.status, "OPEN");
        assert.equal(reopened.latestOdometerKm, 1260);
        assert.equal(reopened.segments.at(-1).startOdometerKm, 1260);
        assert.deepEqual(
          reopened.auditHistory
            .filter((entry) => ["HANDOVER", "JOINED", "CLOSED", "REOPENED"].includes(entry.action))
            .map((entry) => entry.action),
          ["HANDOVER", "JOINED", "CLOSED", "REOPENED"],
        );
        assert.equal(handedOver.status, "OPEN");
        assert.equal(joined.status, "OPEN");
      },
    );

    await t.test(
      "reopen continues the same reading history without another baseline",
      async () => {
        const { user } = await createEmployee();
        const actor = vehicleUser(user);
        const vehicle = await createVehicle(user._id, 1200);
        const opened = await startDailyMileage({
          user: actor,
          vehicleId: vehicle._id,
          startingOdometerKm: 1200,
          expectedVehicleRevision: 0,
          now: fixedNow,
        });
        const closed = await closeDailyMileage({
          dailyMileageId: opened._id,
          user: actor,
          endingOdometerKm: 1210,
          expectedVehicleRevision: 1,
          expectedDailyRevision: 0,
          now: fixedNow,
        });
        const reopened = await reopenDailyMileage({
          dailyMileageId: opened._id,
          user: actor,
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: fixedNow,
        });
        assert.equal(
          reopened.segments.flatMap((segment) => segment.odometerReadings)
            .filter((reading) => reading.source === "BASELINE").length,
          1,
        );
        assert.deepEqual(reopened.segments[1].odometerReadings, []);
        await addDailyMileageReading({
          dailyMileageId: opened._id,
          user: actor,
          requestId: `after-reopen-${unique()}`,
          odometerKm: 1215,
          expectedVehicleRevision: 3,
          expectedDailyRevision: 2,
          now: fixedNow,
        });
        const finalRecord = await closeDailyMileage({
          dailyMileageId: opened._id,
          user: actor,
          endingOdometerKm: 1220,
          expectedVehicleRevision: 4,
          expectedDailyRevision: 3,
          now: fixedNow,
        });
        assert.deepEqual(
          finalRecord.segments[1].odometerReadings.map((reading) => [
            reading.odometerKm,
            reading.distanceKm,
            reading.source,
          ]),
          [
            [1215, 5, "EMPLOYEE_SUBMISSION"],
            [1220, 5, "CLOSE"],
          ],
        );
        assert.equal(finalRecord.dailyDistanceKm, 20);
        assert.equal(
          finalRecord.auditHistory.filter(
            (entry) => entry.action === "CLOSED",
          ).length,
          2,
        );
        assert.equal(
          finalRecord.auditHistory.filter(
            (entry) => entry.action === "REOPENED",
          ).length,
          1,
        );
        assert.equal(closed.endOdometerKm, 1210);
      },
    );

    await t.test(
      "concurrent handover and reading accept one consistent boundary",
      async () => {
        const { user } = await createEmployee();
        const actor = vehicleUser(user);
        const vehicle = await createVehicle(user._id, 1300);
        const record = await startDailyMileage({
          user: actor,
          vehicleId: vehicle._id,
          startingOdometerKm: 1300,
          expectedVehicleRevision: 0,
          now: fixedNow,
        });
        const outcomes = await Promise.allSettled([
          handoverDailyMileage({
            dailyMileageId: record._id,
            user: actor,
            endingOdometerKm: 1310,
            expectedVehicleRevision: 1,
            expectedDailyRevision: 0,
            now: fixedNow,
          }),
          addDailyMileageReading({
            dailyMileageId: record._id,
            user: actor,
            requestId: `concurrent-life-${unique()}`,
            odometerKm: 1320,
            expectedVehicleRevision: 1,
            expectedDailyRevision: 0,
            now: fixedNow,
          }),
        ]);
        assert.equal(
          outcomes.filter((result) => result.status === "fulfilled").length,
          1,
        );
        const [persistedVehicle, persistedRecord] = await Promise.all([
          Vehicle.findById(vehicle._id),
          VehicleDailyMileage.findById(record._id),
        ]);
        assert.equal(
          persistedVehicle.currentOdometerKm,
          persistedRecord.latestOdometerKm,
        );
        const currentSegment = persistedRecord.segments[0];
        assert.equal(
          currentSegment.odometerReadings.reduce(
            (total, reading) => total + reading.distanceKm,
            0,
          ),
          currentSegment.distanceKm,
        );
        assert.equal(
          persistedRecord.dailyDistanceKm,
          persistedRecord.latestOdometerKm -
            persistedRecord.startOdometerKm,
        );
        assert.equal(
          persistedRecord.auditHistory.filter(
            (event) => event.action === "HANDOVER",
          ).length,
          persistedRecord.status === "OPEN" &&
            persistedRecord.activeEmployeeId == null
            ? 1
            : 0,
        );
      },
    );

    await t.test(
      "rollover recovery records only an advancing boundary and one next-day baseline",
      async () => {
        const admin = await createAdmin();
        for (const [startingKm, recoveryKm, expectedDistance] of [
          [1400, 1420, 20],
          [1500, 1500, 0],
        ]) {
          const { employee: overnightEmployee, user: overnightUser } =
            await createEmployee();
          const { employee: nextEmployee } = await createEmployee();
          const vehicle = await createVehicle(overnightUser._id, startingKm);
          const actor = vehicleUser(overnightUser);
          const previous = await startDailyMileage({
            user: actor,
            vehicleId: vehicle._id,
            startingOdometerKm: startingKm,
            expectedVehicleRevision: 0,
            now: fixedNow,
          });
          await assert.rejects(
            startDailyMileage({
              user: vehicleUser(nextEmployee.userId),
              vehicleId: vehicle._id,
              startingOdometerKm: startingKm,
              expectedVehicleRevision: 1,
              now: fixedAfterMidnight,
            }),
            (error) => error?.code === "ROLLOVER_RECOVERY_REQUIRED",
          );
          const pending = await VehicleDailyMileage.findById(previous._id);
          const vehicleAfterPending = await Vehicle.findById(vehicle._id);
          const recoveryInput = {
            dailyMileageId: previous._id,
            user: { _id: admin._id, userType: "admin" },
            recoveryOdometerKm: recoveryKm,
            expectedVehicleRevision: vehicleAfterPending.serviceStateRevision,
            expectedDailyRevision: pending.revision,
            nextEmployeeId: nextEmployee._id,
            now: fixedAfterMidnight,
          };
          const recovered = await recoverDailyMileageRollover(recoveryInput);
          const replay = await recoverDailyMileageRollover(recoveryInput);
          assert.equal(replay.replayed, true);
          assert.equal(recovered.previousRecord.dailyDistanceKm, expectedDistance);
          const previousRecord = await VehicleDailyMileage.findById(previous._id);
          const nextRecord = await VehicleDailyMileage.findOne({
            vehicleId: vehicle._id,
            businessDate: "2026-03-20",
          });
          assert.equal(previousRecord.endOdometerKm, recoveryKm);
          assert.equal(previousRecord.latestOdometerKm, recoveryKm);
          assert.equal(
            previousRecord.segments[0].distanceKm,
            expectedDistance,
          );
          assert.deepEqual(
            previousRecord.segments[0].odometerReadings.map((reading) => [
              reading.odometerKm,
              reading.distanceKm,
              reading.source,
              String(reading.employeeId),
            ]),
            expectedDistance
              ? [
                  [startingKm, 0, "BASELINE", String(overnightEmployee._id)],
                  [
                    recoveryKm,
                    expectedDistance,
                    "ROLLOVER_RECOVERY",
                    String(overnightEmployee._id),
                  ],
                ]
              : [
                  [startingKm, 0, "BASELINE", String(overnightEmployee._id)],
                ],
          );
          assert.equal(nextRecord.startOdometerKm, recoveryKm);
          assert.equal(nextRecord.latestOdometerKm, recoveryKm);
          assert.equal(nextRecord.dailyDistanceKm, 0);
          assert.equal(nextRecord.segments[0].distanceKm, 0);
          assert.equal(
            nextRecord.segments[0].odometerReadings.filter(
              (reading) => reading.source === "BASELINE",
            ).length,
            1,
          );
          assert.equal(
            nextRecord.segments[0].odometerReadings[0].odometerKm,
            recoveryKm,
          );
          const recoveredVehicle = await Vehicle.findById(vehicle._id);
          assert.equal(recoveredVehicle.currentOdometerKm, recoveryKm);
        }
      },
    );

    await t.test(
      "rollover without a next employee stays available and creates one baseline on join",
      async () => {
        const admin = await createAdmin();
        const { employee: overnightEmployee, user: overnightUser } =
          await createEmployee();
        const { employee: nextEmployee, user: nextEmployeeUser } =
          await createEmployee();
        const vehicle = await createVehicle(overnightUser._id, 1600);
        const actor = vehicleUser(overnightUser);
        const opened = await startDailyMileage({
          user: actor,
          vehicleId: vehicle._id,
          startingOdometerKm: 1600,
          expectedVehicleRevision: 0,
          now: fixedNow,
        });
        await handoverDailyMileage({
          dailyMileageId: opened._id,
          user: actor,
          endingOdometerKm: 1600,
          expectedVehicleRevision: 1,
          expectedDailyRevision: 0,
          now: fixedNow,
        });
        await assert.rejects(
          startDailyMileage({
            user: vehicleUser(nextEmployee.userId),
            vehicleId: vehicle._id,
            startingOdometerKm: 1600,
            expectedVehicleRevision: 2,
            now: fixedAfterMidnight,
          }),
          (error) => error?.code === "ROLLOVER_RECOVERY_REQUIRED",
        );
        const pending = await VehicleDailyMileage.findById(opened._id);
        const pendingVehicle = await Vehicle.findById(vehicle._id);
        const recoveryInput = {
          dailyMileageId: opened._id,
          user: { _id: admin._id, userType: "admin" },
          recoveryOdometerKm: 1610,
          expectedVehicleRevision: pendingVehicle.serviceStateRevision,
          expectedDailyRevision: pending.revision,
          now: fixedAfterMidnight,
        };
        const recovered = await recoverDailyMileageRollover(recoveryInput);
        const replay = await recoverDailyMileageRollover(recoveryInput);
        assert.equal(replay.replayed, true);
        assert.equal(recovered.previousRecord.dailyDistanceKm, 10);
        assert.equal(
          String(recovered.previousRecord.segments[0].employeeId),
          String(overnightEmployee._id),
        );
        assert.equal(
          recovered.previousRecord.segments[0].distanceKm,
          0,
          "recovery distance with no active employee must not be assigned to a prior segment",
        );
        assert.equal(recovered.dailyRecord.startOdometerKm, 1610);
        assert.equal(recovered.dailyRecord.latestOdometerKm, 1610);
        assert.equal(recovered.dailyRecord.activeEmployeeId, null);
        assert.equal(recovered.dailyRecord.activeRecordLock, false);
        assert.deepEqual(recovered.dailyRecord.segments, []);
        assert.equal(
          recovered.previousRecord.auditHistory.at(-1).handoverEmployeeId,
          null,
        );

        const state = await getDailyMileageState(
          vehicleUser(nextEmployeeUser),
          fixedAfterMidnight,
        );
        const availableRecord = state.vehicles.find(
          (item) => String(item._id) === String(vehicle._id),
        );
        assert.equal(availableRecord.usageState, "HANDOVER");
        assert.equal(
          String(availableRecord.dailyMileageId),
          String(recovered.dailyRecord._id),
        );
        const joined = await joinDailyMileage({
          dailyMileageId: recovered.dailyRecord._id,
          user: vehicleUser(nextEmployeeUser),
          expectedVehicleRevision: (
            await Vehicle.findById(vehicle._id)
          ).serviceStateRevision,
          expectedDailyRevision: recovered.dailyRecord.revision,
          now: fixedAfterMidnight,
        });
        assert.equal(joined.activeRecordLock, true);
        assert.equal(joined.latestOdometerKm, 1610);
        assert.equal(joined.segments.length, 1);
        assert.equal(
          String(joined.segments[0].employeeId),
          String(nextEmployee._id),
        );
        assert.equal(joined.segments[0].odometerReadingsComplete, true);
        assert.deepEqual(
          joined.segments[0].odometerReadings.map((reading) => [
            reading.odometerKm,
            reading.distanceKm,
            reading.source,
            String(reading.employeeId),
          ]),
          [[1610, 0, "BASELINE", String(nextEmployee._id)]],
        );
        assert.equal(
          await VehicleDailyMileage.countDocuments({ vehicleId: vehicle._id }),
          2,
        );
        assert.equal(
          (await Vehicle.findById(vehicle._id)).currentOdometerKm,
          1610,
        );
      },
    );

    await t.test(
      "different readings with the same starting revisions accept only one",
      async () => {
        const { user } = await createEmployee();
        const actor = vehicleUser(user);
        const vehicle = await createVehicle(user._id, 1000);
        const record = await startDailyMileage({
          user: actor,
          vehicleId: vehicle._id,
          startingOdometerKm: 1000,
          expectedVehicleRevision: 0,
          now: fixedNow,
        });
        const results = await Promise.allSettled([
          addDailyMileageReading({
            dailyMileageId: record._id,
            user: actor,
            requestId: `race-a-${unique()}`,
            odometerKm: 1010,
            expectedVehicleRevision: 1,
            expectedDailyRevision: 0,
            now: fixedNow,
          }),
          addDailyMileageReading({
            dailyMileageId: record._id,
            user: actor,
            requestId: `race-b-${unique()}`,
            odometerKm: 1020,
            expectedVehicleRevision: 1,
            expectedDailyRevision: 0,
            now: fixedNow,
          }),
        ]);
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        assert.equal(
          results.filter((result) => result.status === "rejected").length,
          1,
        );
        const { vehicle: persistedVehicle, record: persistedRecord } =
          await readLatestState(vehicle._id, record._id);
        assert.equal(persistedRecord.revision, 1);
        assert.equal(persistedRecord.segments[0].odometerReadings.length, 2);
        assert.equal(
          persistedRecord.latestOdometerKm,
          persistedVehicle.currentOdometerKm,
        );
        assert.equal(
          persistedRecord.dailyDistanceKm,
          persistedVehicle.currentOdometerKm - persistedRecord.startOdometerKm,
        );
        assert.equal(persistedVehicle.serviceStateRevision, 2);
      },
    );

    await t.test(
      "concurrent duplicate request IDs return the same accepted result",
      async () => {
        const { user } = await createEmployee();
        const actor = vehicleUser(user);
        const vehicle = await createVehicle(user._id, 2000);
        const record = await startDailyMileage({
          user: actor,
          vehicleId: vehicle._id,
          startingOdometerKm: 2000,
          expectedVehicleRevision: 0,
          now: fixedNow,
        });
        const submission = {
          dailyMileageId: record._id,
          user: actor,
          requestId: `duplicate-${unique()}`,
          odometerKm: 2015,
          expectedVehicleRevision: 1,
          expectedDailyRevision: 0,
          now: fixedNow,
        };
        const results = await Promise.all([
          addDailyMileageReading(submission),
          addDailyMileageReading(submission),
        ]);
        assert.deepEqual(results[0], results[1]);
        const { vehicle: persistedVehicle, record: persistedRecord } =
          await readLatestState(vehicle._id, record._id);
        assert.equal(persistedRecord.revision, 1);
        assert.equal(
          persistedRecord.segments[0].odometerReadings.filter(
            (reading) => reading.requestId === submission.requestId,
          ).length,
          1,
        );
        assert.equal(
          persistedRecord.latestOdometerKm,
          persistedVehicle.currentOdometerKm,
        );
        assert.equal(persistedRecord.dailyDistanceKm, 15);
        assert.equal(persistedVehicle.currentOdometerKm, 2015);
        assert.equal(persistedVehicle.serviceStateRevision, 2);
        await assert.rejects(
          addDailyMileageReading({
            ...submission,
            odometerKm: 2016,
          }),
          (error) => error?.code === "IDEMPOTENCY_KEY_REUSED",
        );
      },
    );

    await t.test(
      "failure after both writes rolls back vehicle and daily-record changes",
      async () => {
        const { user } = await createEmployee();
        const actor = vehicleUser(user);
        const vehicle = await createVehicle(user._id, 3000);
        const record = await startDailyMileage({
          user: actor,
          vehicleId: vehicle._id,
          startingOdometerKm: 3000,
          expectedVehicleRevision: 0,
          now: fixedNow,
        });
        const originalUpdateOne =
          VehicleDailyMileage.updateOne.bind(VehicleDailyMileage);
        VehicleDailyMileage.updateOne = async (...args) => {
          await originalUpdateOne(...args);
          throw new Error("injected post-write failure for rollback verification");
        };
        try {
          await assert.rejects(
            addDailyMileageReading({
              dailyMileageId: record._id,
              user: actor,
              requestId: `rollback-${unique()}`,
              odometerKm: 3020,
              expectedVehicleRevision: 1,
              expectedDailyRevision: 0,
              now: fixedNow,
            }),
            /injected post-write failure for rollback verification/,
          );
        } finally {
          VehicleDailyMileage.updateOne = originalUpdateOne;
        }

        const { vehicle: persistedVehicle, record: persistedRecord } =
          await readLatestState(vehicle._id, record._id);
        assert.equal(persistedVehicle.currentOdometerKm, 3000);
        assert.equal(persistedVehicle.serviceStateRevision, 1);
        assert.equal(persistedRecord.latestOdometerKm, 3000);
        assert.equal(persistedRecord.dailyDistanceKm, 0);
        assert.equal(persistedRecord.revision, 0);
        assert.equal(persistedRecord.segments[0].odometerReadings.length, 1);
      },
    );
  },
);
