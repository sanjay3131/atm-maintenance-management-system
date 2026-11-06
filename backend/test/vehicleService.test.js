import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Employee from "../src/modules/employees/employee.model.js";
import Vehicle from "../src/modules/vehicles/vehicle.model.js";
import VehicleAssignment from "../src/modules/vehicles/vehicleAssignment.model.js";
import VehicleUsageSession from "../src/modules/vehicles/vehicleUsageSession.model.js";
import VehicleService from "../src/modules/vehicles/vehicleService.model.js";
import VehicleServicePolicy from "../src/modules/vehicles/vehicleServicePolicy.model.js";
import VehicleServiceReminder from "../src/modules/vehicles/vehicleServiceReminder.model.js";
import VehicleOdometerCorrection from "../src/modules/vehicles/vehicleOdometerCorrection.model.js";
import User from "../src/modules/users/user.model.js";
import {
  completeUsageSession,
  createVehicle,
  createOdometerCorrection,
  initializeDefaultVehiclePolicy,
  listEligibleVehicles,
  recordVehicleService,
  reviewVehicleServiceConflict,
  startUsageSession,
  updateServicePolicy,
} from "../src/modules/vehicles/vehicle.service.js";
import { reconcileVehicleReminder } from "../src/modules/vehicles/vehicleReminderWorker.js";

const vehicleId = "64b000000000000000000001";
const employeeId = "64b000000000000000000002";
const userId = "64b000000000000000000003";
const sessionId = "64b000000000000000000004";

const query = (value) => ({
  populate() {
    return this;
  },
  select() {
    return this;
  },
  sort() {
    return this;
  },
  session() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const withOverrides = async (overrides, run) => {
  const originals = overrides.map(([target, key]) => [
    target,
    key,
    target[key],
  ]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    return await run();
  } finally {
    for (const [target, key, value] of originals.reverse()) target[key] = value;
  }
};

const transactionStub = () => ({
  async withTransaction(operation) {
    return operation(this);
  },
  async endSession() {},
});

const activeEmployee = () => ({
  _id: employeeId,
  employeeCode: "EMP-001",
  status: "active",
  userId: {
    _id: userId,
    firstName: "Ravi",
    lastName: "Kumar",
    userType: "employee",
    status: "active",
  },
});

const activeVehicle = (overrides = {}) => ({
  _id: vehicleId,
  registrationNumber: "TN45AB1234",
  status: "ACTIVE",
  currentOdometerKm: 1200,
  serviceStateRevision: 7,
  async save() {
    return this;
  },
  ...overrides,
});

const completedSessionState = () => ({
  _id: sessionId,
  vehicleId,
  employeeId,
  startOdometerKm: 1200,
  status: "IN_PROGRESS",
});

const user = { _id: userId, userType: "employee", status: "active" };

test("session start derives employee, snapshots actual vehicle, and advances revision atomically", async () => {
  const vehicle = activeVehicle();
  const employee = activeEmployee();
  const state = { created: [], update: null, transactionCalls: 0 };

  await withOverrides(
    [
      [
        mongoose,
        "startSession",
        async () => ({
          async withTransaction(operation) {
            state.transactionCalls++;
            return operation(this);
          },
          async endSession() {},
        }),
      ],
      [Employee, "findOne", () => query(employee)],
      [Vehicle, "findById", () => query(vehicle)],
      [
        Vehicle,
        "updateOne",
        async (filter, update) => {
          state.update = { filter, update };
          if (filter.serviceStateRevision !== vehicle.serviceStateRevision)
            return { matchedCount: 0 };
          Object.assign(vehicle, update.$set);
          vehicle.serviceStateRevision += update.$inc.serviceStateRevision;
          return { matchedCount: 1 };
        },
      ],
      [VehicleUsageSession, "exists", () => query(false)],
      [
        VehicleUsageSession,
        "create",
        async (documents) => {
          state.created.push(...documents);
          return documents;
        },
      ],
    ],
    async () => {
      const result = await startUsageSession({
        user,
        vehicleId,
        startingOdometerKm: 1200,
        expectedVehicleRevision: 7,
      });
      assert.equal(result.employeeId, employeeId);
      assert.equal(result.employeeNameSnapshot, "Ravi Kumar");
      assert.equal(result.vehicleRegistrationSnapshot, "TN45AB1234");
      assert.equal(vehicle.serviceStateRevision, 8);
      assert.equal(state.transactionCalls, 1);
      assert.deepEqual(state.update.filter, {
        _id: vehicleId,
        serviceStateRevision: 7,
      });
      assert.equal(state.created.length, 1);
    },
  );
});

test("vehicle creation stores normalized registration and maps unique-index conflicts to 409", async () => {
  const state = { payload: null };
  await withOverrides(
    [
      [mongoose, "startSession", async () => transactionStub()],
      [
        Vehicle,
        "create",
        async (documents) => {
          state.payload = documents[0];
          throw Object.assign(new Error("duplicate key"), {
            code: 11000,
            keyPattern: { registrationNumberNormalized: 1 },
          });
        },
      ],
    ],
    async () => {
      await assert.rejects(
        createVehicle({
          input: {
            registrationNumber: " tn 45-ab 1234 ",
            make: "Honda",
            model: "Shine",
            initialOdometerKm: 100,
          },
          actorId: userId,
        }),
        { statusCode: 409, code: "DUPLICATE_REGISTRATION" },
      );
      assert.equal(state.payload.registrationNumber, "TN 45-AB 1234");
      assert.equal(state.payload.registrationNumberNormalized, "TN45AB1234");
      assert.equal(state.payload.currentOdometerKm, 100);
    },
  );
});

test("eligible vehicles include all active bikes and put the primary assignment first", async () => {
  const primaryId = "64b000000000000000000201";
  const otherId = "64b000000000000000000202";
  const vehicles = [
    activeVehicle({
      _id: otherId,
      registrationNumber: "TN45AB0002",
      make: "Honda",
      model: "Shine",
      initialOdometerKm: 1000,
      toObject() {
        return { ...this };
      },
    }),
    activeVehicle({
      _id: primaryId,
      registrationNumber: "TN45AB0001",
      make: "TVS",
      model: "Sport",
      initialOdometerKm: 900,
      toObject() {
        return { ...this };
      },
    }),
  ];
  const policy = { intervalKm: 3000 };

  for (const assignedVehicleId of [primaryId, null]) {
    await withOverrides(
      [
        [Employee, "findOne", () => query(activeEmployee())],
        [VehicleUsageSession, "exists", () => query(false)],
        [VehicleUsageSession, "distinct", () => query([])],
        [VehicleAssignment, "findOne", () => query(
          assignedVehicleId ? { vehicleId: assignedVehicleId } : null,
        )],
        [Vehicle, "find", () => query(vehicles)],
        [VehicleServicePolicy, "findOne", () => query(policy)],
        [VehicleService, "find", () => query([])],
      ],
      async () => {
        const result = await listEligibleVehicles(user);
        assert.deepEqual(result.map((vehicle) => vehicle._id), [
          ...(assignedVehicleId ? [primaryId] : []),
          ...(assignedVehicleId ? [otherId] : [primaryId, otherId]),
        ]);
        assert.deepEqual(
          result.map((vehicle) => vehicle.primaryAssignedToMe),
          assignedVehicleId ? [true, false] : [false, false],
        );
      },
    );
  }
});

test("session start rejects stale revisions and does not create a session", async () => {
  const vehicle = activeVehicle();
  const state = { created: 0 };
  await withOverrides(
    [
      [mongoose, "startSession", async () => transactionStub()],
      [Employee, "findOne", () => query(activeEmployee())],
      [Vehicle, "findById", () => query(vehicle)],
      [Vehicle, "updateOne", async () => ({ matchedCount: 0 })],
      [VehicleUsageSession, "exists", () => query(false)],
      [
        VehicleUsageSession,
        "create",
        async () => {
          state.created++;
          return [];
        },
      ],
    ],
    async () => {
      await assert.rejects(
        startUsageSession({
          user,
          vehicleId,
          startingOdometerKm: 1200,
          expectedVehicleRevision: 6,
        }),
        { statusCode: 409, code: "REVISION_CONFLICT" },
      );
      assert.equal(state.created, 0);
    },
  );
});

test("session start rejects an opening reading that differs from current odometer", async () => {
  let casCalls = 0;
  await withOverrides(
    [
      [mongoose, "startSession", async () => transactionStub()],
      [Employee, "findOne", () => query(activeEmployee())],
      [Vehicle, "findById", () => query(activeVehicle())],
      [
        Vehicle,
        "updateOne",
        async () => {
          casCalls++;
          return { matchedCount: 1 };
        },
      ],
      [VehicleUsageSession, "exists", () => query(false)],
      [VehicleUsageSession, "create", async () => []],
    ],
    async () => {
      await assert.rejects(
        startUsageSession({
          user,
          vehicleId,
          startingOdometerKm: 1199,
          expectedVehicleRevision: 7,
        }),
        { statusCode: 409, code: "ODOMETER_MISMATCH" },
      );
      assert.equal(casCalls, 0);
    },
  );
});

test("session start accepts a higher next-day meter reading without counting the travel gap", async () => {
  const vehicle = activeVehicle({ currentOdometerKm: 10000 });
  const state = { created: null };
  await withOverrides([
    [mongoose, "startSession", async () => transactionStub()],
    [Employee, "findOne", () => query(activeEmployee())],
    [Vehicle, "findById", () => query(vehicle)],
    [Vehicle, "updateOne", async (_filter, update) => {
      Object.assign(vehicle, update.$set);
      vehicle.serviceStateRevision++;
      return { matchedCount: 1 };
    }],
    [VehicleUsageSession, "exists", () => query(false)],
    [VehicleUsageSession, "create", async (documents) => { state.created = documents[0]; return documents; }],
  ], async () => {
    const result = await startUsageSession({
      user,
      vehicleId,
      startingOdometerKm: 10015,
      expectedVehicleRevision: 7,
    });
    assert.equal(result.startOdometerKm, 10015);
    assert.equal(result.distanceKm, undefined);
    assert.equal(vehicle.currentOdometerKm, 10015);
    assert.equal(state.created.startOdometerKm, 10015);
  });
});

test("starting above the previous session end can cross and activate the service threshold", async () => {
  const vehicle = activeVehicle({ initialOdometerKm: 10000, currentOdometerKm: 12990 });
  const state = { reminders: [], sessions: [], activeSession: false };
  const serviceQuery = {
    sort() { return this; },
    session() { return this; },
    then(resolve, reject) { return Promise.resolve([]).then(resolve, reject); },
  };
  await withOverrides([
    [mongoose, "startSession", async () => transactionStub()],
    [Employee, "findOne", () => query(activeEmployee())],
    [Vehicle, "findById", () => query(vehicle)],
    [Vehicle, "updateOne", async (filter, update) => {
      if (filter.serviceStateRevision !== vehicle.serviceStateRevision) return { matchedCount: 0 };
      Object.assign(vehicle, update.$set);
      vehicle.serviceStateRevision += update.$inc.serviceStateRevision;
      return { matchedCount: 1 };
    }],
    [VehicleUsageSession, "exists", () => query(false)],
    [VehicleUsageSession, "create", async (documents) => { state.sessions.push(...documents); return documents; }],
    [VehicleServicePolicy, "findOne", () => query({ _id: "64b000000000000000000006", version: 1, intervalKm: 3000, isActive: true, coordinationRevision: 0 })],
    [VehicleServicePolicy, "updateOne", async (_filter, _update) => ({ matchedCount: 1 })],
    [VehicleService, "find", () => serviceQuery],
    [VehicleServiceReminder, "findOne", () => query(state.reminders[0] ?? null)],
    [VehicleServiceReminder, "create", async (documents) => { state.reminders.push(documents[0]); return documents; }],
    [User, "find", () => query([{ _id: userId }])],
  ], async () => {
    await startUsageSession({ user, vehicleId, startingOdometerKm: 13000, expectedVehicleRevision: 7 });
    assert.equal(vehicle.currentOdometerKm, 13000);
    const result = await reconcileVehicleReminder(vehicleId);
    assert.equal(result.action, "create");
    assert.equal(state.reminders[0].serviceStatus, "DUE");
    assert.equal(state.reminders[0].dueOdometerKm, 13000);
    assert.equal(state.sessions[0].startOdometerKm, 13000);
    assert.equal(state.sessions[0].distanceKm, undefined);
  });
});

test("completion atomically records distance and raises vehicle verified odometer", async () => {
  const vehicle = activeVehicle();
  const usage = completedSessionState();
  const state = { updatedSession: null };
  await withOverrides(
    [
      [mongoose, "startSession", async () => transactionStub()],
      [Employee, "findOne", () => query(activeEmployee())],
      [VehicleUsageSession, "findById", () => query(usage)],
      [Vehicle, "findById", () => query(vehicle)],
      [
        Vehicle,
        "updateOne",
        async (filter, update) => {
          if (filter.serviceStateRevision !== vehicle.serviceStateRevision)
            return { matchedCount: 0 };
          Object.assign(vehicle, update.$set);
          vehicle.serviceStateRevision += update.$inc.serviceStateRevision;
          return { matchedCount: 1 };
        },
      ],
      [
        VehicleUsageSession,
        "findOneAndUpdate",
        async (filter, update) => {
          if (usage.status !== filter.status) return null;
          Object.assign(usage, update.$set);
          state.updatedSession = usage;
          return usage;
        },
      ],
    ],
    async () => {
      const result = await completeUsageSession({
        sessionId,
        user,
        endingOdometerKm: 1260,
        expectedVehicleRevision: 7,
      });
      assert.equal(result.distanceKm, 60);
      assert.equal(result.status, "COMPLETED");
      assert.equal(vehicle.currentOdometerKm, 1260);
      assert.equal(vehicle.serviceStateRevision, 8);
      assert.equal(state.updatedSession, result);
    },
  );
});

test("completion rejects a decreasing reading without updating the vehicle", async () => {
  const vehicle = activeVehicle();
  const usage = completedSessionState();
  let writes = 0;
  await withOverrides(
    [
      [mongoose, "startSession", async () => transactionStub()],
      [Employee, "findOne", () => query(activeEmployee())],
      [VehicleUsageSession, "findById", () => query(usage)],
      [Vehicle, "findById", () => query(vehicle)],
      [
        Vehicle,
        "updateOne",
        async () => {
          writes++;
          return { matchedCount: 1 };
        },
      ],
      [
        VehicleUsageSession,
        "findOneAndUpdate",
        async () => {
          writes++;
          return usage;
        },
      ],
    ],
    async () => {
      await assert.rejects(
        completeUsageSession({
          sessionId,
          user,
          endingOdometerKm: 1199,
          expectedVehicleRevision: 7,
        }),
        { statusCode: 409, code: "ODOMETER_CONFLICT" },
      );
      assert.equal(writes, 0);
    },
  );
});

test("fresh setup persists the explicit 3000 KM oil policy", async () => {
  const state = { created: null };
  await withOverrides(
    [
      [VehicleServicePolicy, "findOne", () => query(null)],
      [
        VehicleServicePolicy,
        "create",
        async (input) => {
          state.created = input;
          return input;
        },
      ],
    ],
    async () => {
      const policy = await initializeDefaultVehiclePolicy();
      assert.equal(policy.intervalKm, 3000);
      assert.equal(policy.version, 1);
      assert.equal(policy.coordinationRevision, 0);
      assert.equal(policy.isActive, true);
      assert.equal(state.created.intervalKm, 3000);
    },
  );
});

test("policy update uses expected version and creates a fresh coordination revision", async () => {
  const active = {
    _id: "policy-v1",
    serviceType: "OIL_CHANGE",
    intervalKm: 3000,
    version: 1,
    coordinationRevision: 4,
    isActive: true,
  };
  const state = { deactivated: null, created: null };
  await withOverrides(
    [
      [mongoose, "startSession", async () => transactionStub()],
      [VehicleServicePolicy, "findOne", () => query(active)],
      [
        VehicleServicePolicy,
        "updateOne",
        async (filter, update) => {
          state.deactivated = { filter, update };
          active.isActive = false;
          return { matchedCount: 1 };
        },
      ],
      [
        VehicleServicePolicy,
        "create",
        async (documents) => {
          state.created = documents[0];
          return [documents[0]];
        },
      ],
    ],
    async () => {
      const policy = await updateServicePolicy({
        intervalKm: 4500,
        expectedVersion: 1,
        updatedBy: userId,
      });
      assert.equal(policy.intervalKm, 4500);
      assert.equal(policy.version, 2);
      assert.equal(policy.coordinationRevision, 0);
      assert.equal(state.deactivated.filter.coordinationRevision, 4);
      assert.equal(state.deactivated.update.$set.isActive, false);
    },
  );
});

test("recording oil service atomically advances verified KM and resolves the previous cycle", async () => {
  const vehicle = activeVehicle({
    initialOdometerKm: 1000,
    currentOdometerKm: 3000,
  });
  const state = { services: [], resolved: null };
  const serviceQuery = {
    sort() {
      return this;
    },
    session() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(state.services).then(resolve, reject);
    },
  };
  const service = {
    _id: "service-001",
    vehicleId,
    serviceType: "OIL_CHANGE",
    serviceDate: new Date("2026-01-01T00:00:00.000Z"),
    serviceOdometerKm: 2800,
    createdAt: new Date("2026-01-01T01:00:00.000Z"),
  };
  await withOverrides(
    [
      [mongoose, "startSession", async () => transactionStub()],
      [Vehicle, "findById", () => query(vehicle)],
      [
        Vehicle,
        "updateOne",
        async (filter, update) => {
          assert.equal(filter.serviceStateRevision, 7);
          Object.assign(vehicle, update.$set);
          vehicle.serviceStateRevision += 1;
          return { matchedCount: 1 };
        },
      ],
      [
        VehicleServicePolicy,
        "findOne",
        () => query({ version: 1, intervalKm: 3000, isActive: true }),
      ],
      [VehicleService, "find", () => serviceQuery],
      [
        VehicleService,
        "create",
        async (documents) => {
          state.services.push(service);
          return [service];
        },
      ],
      [
        VehicleServiceReminder,
        "updateOne",
        async (filter, update) => {
          state.resolved = { filter, update };
          return { matchedCount: 1 };
        },
      ],
    ],
    async () => {
      const result = await recordVehicleService({
        vehicleId,
        input: {
          serviceType: "OIL_CHANGE",
          serviceDate: "2026-01-01",
          serviceOdometerKm: 2800,
          expectedVehicleRevision: 7,
        },
        actorId: userId,
      });
      assert.equal(result.baseline.odometerKm, 2800);
      assert.equal(result.nextServiceOdometerKm, 5800);
      assert.equal(vehicle.serviceStateRevision, 8);
      assert.equal(
        state.resolved.filter.cycleKey,
        `${vehicleId}:OIL_CHANGE:INITIAL`,
      );
      assert.equal(state.resolved.update.$set.lifecycleStatus, "RESOLVED");
      assert.equal(Object.hasOwn(state.resolved.update.$set, "serviceStatus"), false);
    },
  );
});

test("new service resolves ACTIVE and SUPERSEDED previous cycles but preserves RESOLVED terminal state", async () => {
  for (const previousState of ["ACTIVE", "SUPERSEDED", "RESOLVED"]) {
    const vehicle = activeVehicle({ initialOdometerKm: 1000, currentOdometerKm: 3000 });
    const state = {
      services: [],
      reminder: {
        _id: `reminder-${previousState}`,
        vehicleId,
        cycleKey: `${vehicleId}:OIL_CHANGE:INITIAL`,
        lifecycleStatus: previousState,
        serviceStatus: "OVERDUE",
      },
      updateCalls: 0,
    };
    const service = {
      _id: `new-service-${previousState}`,
      vehicleId,
      serviceType: "OIL_CHANGE",
      serviceDate: new Date("2026-01-01T00:00:00.000Z"),
      serviceOdometerKm: 2800,
      createdAt: new Date("2026-01-01T01:00:00.000Z"),
    };
    const serviceQuery = {
      sort() { return this; },
      session() { return this; },
      then(resolve, reject) { return Promise.resolve(state.services).then(resolve, reject); },
    };
    await withOverrides([
      [mongoose, "startSession", async () => transactionStub()],
      [Vehicle, "findById", () => query(vehicle)],
      [Vehicle, "updateOne", async (_filter, update) => {
        Object.assign(vehicle, update.$set);
        vehicle.serviceStateRevision += 1;
        return { matchedCount: 1 };
      }],
      [VehicleServicePolicy, "findOne", () => query({ version: 1, intervalKm: 3000, isActive: true })],
      [VehicleService, "find", () => serviceQuery],
      [VehicleService, "create", async () => { state.services.push(service); return [service]; }],
      [VehicleServiceReminder, "updateOne", async (filter, update) => {
        state.updateCalls++;
        assert.deepEqual(filter.lifecycleStatus, { $in: ["ACTIVE", "SUPERSEDED"] });
        if (!["ACTIVE", "SUPERSEDED"].includes(state.reminder.lifecycleStatus)) return { matchedCount: 0 };
        Object.assign(state.reminder, update.$set);
        return { matchedCount: 1 };
      }],
    ], async () => {
      await recordVehicleService({
        vehicleId,
        input: { serviceType: "OIL_CHANGE", serviceDate: "2026-01-01", serviceOdometerKm: 2800, expectedVehicleRevision: 7 },
        actorId: userId,
      });
      if (previousState === "RESOLVED") {
        assert.equal(state.reminder.lifecycleStatus, "RESOLVED");
      } else {
        assert.equal(state.reminder.lifecycleStatus, "RESOLVED");
        assert.equal(state.reminder.resolvedByServiceId, service._id);
        assert.equal(state.reminder.serviceStatus, "OVERDUE");
      }
      assert.equal(state.updateCalls, 1);
    });
  }
});

test("downward historical correction preserves audit, recalculates distances, flags conflicts, and recomputes current KM", async () => {
  const vehicle = activeVehicle({ initialOdometerKm: 10000, currentOdometerKm: 15000 });
  const sessionA = {
    _id: "session-a",
    vehicleId,
    status: "COMPLETED",
    businessDate: "2026-01-01",
    startedAt: new Date("2026-01-01T02:00:00Z"),
    startOdometerKm: 14000,
    endOdometerKm: 15000,
    distanceKm: 1000,
    toObject() { return { ...this }; },
  };
  const sessionB = {
    _id: "session-b",
    vehicleId,
    status: "COMPLETED",
    businessDate: "2026-01-02",
    startedAt: new Date("2026-01-02T02:00:00Z"),
    startOdometerKm: 14100,
    endOdometerKm: 14300,
    distanceKm: 200,
    toObject() { return { ...this }; },
  };
  const sessionC = {
    _id: "session-c",
    vehicleId,
    status: "COMPLETED",
    businessDate: "2026-01-03",
    startedAt: new Date("2026-01-03T02:00:00Z"),
    startOdometerKm: 14400,
    endOdometerKm: 14450,
    distanceKm: 50,
    toObject() { return { ...this }; },
  };
  const service = {
    _id: "service-a",
    vehicleId,
    serviceType: "OIL_CHANGE",
    serviceDate: new Date("2026-01-02T00:00:00Z"),
    serviceOdometerKm: 14500,
    timelineReviewRequired: false,
  };
  const sessions = [sessionA, sessionB, sessionC];
  const serviceQuery = {
    sort() { return this; },
    session() { return this; },
    then(resolve, reject) { return Promise.resolve(sessions).then(resolve, reject); },
  };
  const servicesQuery = {
    sort() { return this; },
    session() { return this; },
    then(resolve, reject) { return Promise.resolve([service]).then(resolve, reject); },
  };
  const state = { correction: null, vehicleUpdate: null };

  await withOverrides([
    [mongoose, "startSession", async () => transactionStub()],
    [Vehicle, "findById", () => query(vehicle)],
    [Vehicle, "updateOne", async (filter, update) => {
      assert.equal(filter.serviceStateRevision, 7);
      state.vehicleUpdate = update;
      Object.assign(vehicle, update.$set);
      vehicle.serviceStateRevision++;
      return { matchedCount: 1 };
    }],
    [VehicleUsageSession, "exists", () => query(false)],
    [VehicleUsageSession, "findOne", () => query(sessionA)],
    [VehicleUsageSession, "find", () => serviceQuery],
    [VehicleUsageSession, "updateOne", async (filter, update) => {
      const current = sessions.find((item) => item._id === filter._id);
      Object.assign(current, update.$set);
      return { matchedCount: 1 };
    }],
    [VehicleService, "find", () => servicesQuery],
    [VehicleService, "updateOne", async (_filter, update) => {
      Object.assign(service, update.$set);
      return { matchedCount: 1 };
    }],
    [VehicleOdometerCorrection, "create", async (documents) => {
      state.correction = { _id: "correction-a", ...documents[0] };
      return [state.correction];
    }],
    [VehicleOdometerCorrection, "find", () => query([])],
  ], async () => {
    const correction = await createOdometerCorrection({
      vehicleId,
      usageSessionId: sessionA._id,
      correctedField: "END",
      correctedOdometerKm: 14200,
      expectedVehicleRevision: 7,
      reason: "Original ending reading was entered incorrectly",
      actorId: userId,
    });

    assert.equal(correction.previousOdometerKm, 15000);
    assert.equal(correction.correctedOdometerKm, 14200);
    assert.equal(correction.usageSessionId, sessionA._id);
    assert.equal(correction.correctedField, "END");
    assert.equal(correction.correctedBy, userId);
    assert.equal(sessionA.startOdometerKm, 14000);
    assert.equal(sessionA.endOdometerKm, 14200);
    assert.equal(sessionA.distanceKm, 200);
    assert.equal(sessionB.startOdometerKm, 14100);
    assert.equal(sessionB.endOdometerKm, 14300);
    assert.equal(sessionB.distanceKm, 200);
    assert.equal(sessionB.timelineReviewRequired, true);
    assert.equal(sessionC.startOdometerKm, 14400);
    assert.equal(sessionC.endOdometerKm, 14450);
    assert.equal(sessionC.timelineReviewRequired, true);
    assert.equal(service.serviceOdometerKm, 14500);
    assert.equal(service.timelineReviewRequired, true);
    assert.equal(vehicle.currentOdometerKm, 14200);
    assert.equal(vehicle.serviceStateRevision, 8);
    assert.equal(state.vehicleUpdate.$set.currentOdometerKm, 14200);
  });
});

test("service conflict review preserves the reading and audits explicit confirmation", async () => {
  const vehicle = activeVehicle({
    initialOdometerKm: 10000,
    currentOdometerKm: 14000,
  });
  const service = {
    _id: "service-review",
    vehicleId,
    serviceType: "OIL_CHANGE",
    serviceDate: new Date("2026-01-02T00:00:00.000Z"),
    serviceOdometerKm: 12000,
    timelineReviewRequired: true,
    timelineReviewReason: "Service reading conflicts with mileage history",
    timelineReviewHistory: [],
  };
  const session = {
    _id: "session-after-service",
    vehicleId,
    businessDate: "2026-01-03",
    startedAt: new Date("2026-01-03T02:00:00.000Z"),
    startOdometerKm: 13000,
    endOdometerKm: 14000,
    distanceKm: 1000,
    status: "COMPLETED",
    toObject() { return { ...this }; },
  };
  const chain = (value) => ({
    sort() { return this; },
    session() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  });
  await withOverrides([
    [mongoose, "startSession", async () => transactionStub()],
    [Vehicle, "findById", () => query(vehicle)],
    [Vehicle, "updateOne", async (filter, update) => {
      assert.equal(filter.serviceStateRevision, 7);
      Object.assign(vehicle, update.$set);
      vehicle.serviceStateRevision += update.$inc.serviceStateRevision;
      return { matchedCount: 1 };
    }],
    [VehicleUsageSession, "find", () => chain([session])],
    [VehicleUsageSession, "updateOne", async (_filter, update) => {
      Object.assign(session, update.$set);
      return { matchedCount: 1 };
    }],
    [VehicleService, "findOne", () => query(service)],
    [VehicleService, "find", () => chain([service])],
    [VehicleService, "updateOne", async (_filter, update) => {
      Object.assign(service, update.$set);
      service.timelineReviewHistory.push(update.$push.timelineReviewHistory);
      return { matchedCount: 1 };
    }],
    [VehicleService, "findById", () => query(service)],
    [VehicleOdometerCorrection, "find", () => query([])],
  ], async () => {
    const result = await reviewVehicleServiceConflict({
      vehicleId,
      serviceId: service._id,
      expectedVehicleRevision: 7,
      confirmReviewed: true,
      reason: "Verified the service paperwork against the vehicle record",
      actorId: userId,
    });

    assert.equal(service.serviceOdometerKm, 12000);
    assert.equal(service.timelineReviewRequired, false);
    assert.equal(service.timelineReviewReason, "");
    assert.equal(service.timelineReviewedBy, userId);
    assert.ok(service.timelineReviewedAt instanceof Date);
    assert.equal(
      service.timelineReviewResolutionReason,
      "Verified the service paperwork against the vehicle record",
    );
    assert.deepEqual(service.timelineReviewHistory, [{
      reviewedBy: userId,
      reviewedAt: service.timelineReviewedAt,
      reason: "Verified the service paperwork against the vehicle record",
    }]);
    assert.equal(result.timelineReviewRequired, false);
    assert.equal(result.serviceBaselineReviewRequired, false);
    assert.equal(vehicle.currentOdometerKm, 14000);
    assert.equal(vehicle.serviceStateRevision, 8);
  });
});

test("service conflict review requires explicit confirmation and a reason", async () => {
  await assert.rejects(
    reviewVehicleServiceConflict({
      vehicleId,
      serviceId: "service-review",
      expectedVehicleRevision: 7,
      confirmReviewed: false,
      reason: "Not confirmed",
      actorId: userId,
    }),
    { statusCode: 400, code: "VALIDATION_ERROR" },
  );
  await assert.rejects(
    reviewVehicleServiceConflict({
      vehicleId,
      serviceId: "service-review",
      expectedVehicleRevision: 7,
      confirmReviewed: true,
      reason: "   ",
      actorId: userId,
    }),
    { statusCode: 400, code: "VALIDATION_ERROR" },
  );
});

test("odometer correction is rejected while any vehicle session is active", async () => {
  const vehicle = activeVehicle();
  let correctionWrites = 0;
  let vehicleWrites = 0;
  await withOverrides([
    [mongoose, "startSession", async () => transactionStub()],
    [Vehicle, "findById", () => query(vehicle)],
    [VehicleUsageSession, "exists", () => query(true)],
    [VehicleOdometerCorrection, "create", async () => { correctionWrites++; return []; }],
    [Vehicle, "updateOne", async () => { vehicleWrites++; return { matchedCount: 1 }; }],
  ], async () => {
    await assert.rejects(
      createOdometerCorrection({
        vehicleId,
        correctedOdometerKm: 1400,
        expectedVehicleRevision: 7,
        reason: "Correct a session reading",
        actorId: userId,
      }),
      { statusCode: 409, code: "ACTIVE_SESSION_EXISTS" },
    );
    assert.equal(correctionWrites, 0);
    assert.equal(vehicleWrites, 0);
  });
});
