import assert from "node:assert/strict";
import test from "node:test";
import Employee from "../src/modules/employees/employee.model.js";
import User from "../src/modules/users/user.model.js";
import Notification from "../src/modules/notification/notification.model.js";
import mongoose from "mongoose";
import { vehicleError } from "../src/modules/vehicles/vehicle.errors.js";
import Vehicle from "../src/modules/vehicles/vehicle.model.js";
import VehicleUsageSession from "../src/modules/vehicles/vehicleUsageSession.model.js";
import VehicleService from "../src/modules/vehicles/vehicleService.model.js";
import VehicleServicePolicy from "../src/modules/vehicles/vehicleServicePolicy.model.js";
import VehicleServiceReminder from "../src/modules/vehicles/vehicleServiceReminder.model.js";
import {
  deliverReminderNotifications,
  reconcileAndDeliverVehicleReminders,
  reconcileVehicleReminder,
  retryWithBoundedConflicts,
} from "../src/modules/vehicles/vehicleReminderWorker.js";

const vehicleId = "64b000000000000000000101";
const reminderId = "64b000000000000000000102";
const adminA = "64b000000000000000000103";
const adminB = "64b000000000000000000104";
const employeeUserId = "64b000000000000000000105";
const employeeId = "64b000000000000000000106";

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

const query = (value) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  session() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const transactionStub = () => ({
  async withTransaction(operation) {
    return operation(this);
  },
  async endSession() {},
});

const makeReminder = (overrides = {}) => ({
  _id: reminderId,
  vehicleId,
  serviceType: "OIL_CHANGE",
  cycleKey: `${vehicleId}:OIL_CHANGE:INITIAL`,
  serviceStatus: "DUE",
  lifecycleStatus: "ACTIVE",
  deliveryStatus: "BLOCKED_NO_RECIPIENTS",
  dueOdometerKm: 3000,
  activationCount: 1,
  lastNotificationActivationCount: 0,
  pendingNotificationDelivery: {
    activationCount: 1,
    recipients: [],
    deliveryStartedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  ...overrides,
});

function reminderModelStubs(state) {
  return {
    findById: () => query(state.reminder),
    findOneAndUpdate: async (filter, update) => {
      const recipients = state.reminder.pendingNotificationDelivery.recipients;
      if (
        state.reminder.deliveryStatus !== filter.deliveryStatus ||
        state.reminder.cycleKey !== filter.cycleKey ||
        state.reminder.activationCount !== filter.activationCount ||
        recipients.length !==
          filter["pendingNotificationDelivery.recipients"].$size
      )
        return null;
      state.reminder.deliveryStatus = update.$set.deliveryStatus;
      state.reminder.pendingNotificationDelivery.recipients =
        update.$set["pendingNotificationDelivery.recipients"];
      return state.reminder;
    },
    updateOne: async (filter, update) => {
      const reminder = state.reminder;
      if (
        String(reminder._id) !== String(filter._id) ||
        reminder.cycleKey !== filter.cycleKey ||
        reminder.activationCount !== filter.activationCount ||
        reminder.deliveryStatus === "DELIVERED"
      )
        return { matchedCount: 0 };
      const criteria =
        filter["pendingNotificationDelivery.recipients"]?.$elemMatch;
      const recipient = reminder.pendingNotificationDelivery.recipients.find(
        (entry) =>
          String(entry.userId) === String(criteria?.userId) &&
          entry.status === criteria?.status,
      );
      if (criteria && !recipient) return { matchedCount: 0 };
      if (
        update.$inc?.[
          "pendingNotificationDelivery.recipients.$.attemptCount"
        ] !== undefined
      ) {
        recipient.attemptCount +=
          update.$inc["pendingNotificationDelivery.recipients.$.attemptCount"];
        recipient.lastAttemptAt =
          update.$set["pendingNotificationDelivery.recipients.$.lastAttemptAt"];
      }
      if (update.$set?.["pendingNotificationDelivery.recipients.$.status"]) {
        recipient.status =
          update.$set["pendingNotificationDelivery.recipients.$.status"];
        recipient.deliveredAt =
          update.$set["pendingNotificationDelivery.recipients.$.deliveredAt"];
      }
      if (update.$set?.deliveryStatus) {
        reminder.deliveryStatus = update.$set.deliveryStatus;
        reminder.lastNotificationActivationCount =
          update.$set.lastNotificationActivationCount;
      }
      return { matchedCount: 1 };
    },
  };
}

const makeVehicleQuery = (primaryAssignedEmployeeId = null) => ({
  select() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve({
      _id: vehicleId,
      registrationNumber: "TN45AB1234",
      currentOdometerKm: 3000,
      primaryAssignedEmployeeId,
    }).then(resolve, reject);
  },
});

test("empty recipient resolution leaves activation blocked and unresolved", async () => {
  const state = { reminder: makeReminder() };
  await withOverrides(
    [
      [VehicleServiceReminder, "findById", reminderModelStubs(state).findById],
      [
        VehicleServiceReminder,
        "findOneAndUpdate",
        reminderModelStubs(state).findOneAndUpdate,
      ],
      [
        VehicleServiceReminder,
        "updateOne",
        reminderModelStubs(state).updateOne,
      ],
      [Vehicle, "findById", () => makeVehicleQuery()],
      [User, "find", () => query([])],
      [Employee, "findById", () => query(null)],
    ],
    async () => {
      const result = await deliverReminderNotifications(reminderId);
      assert.equal(result.blocked, true);
      assert.equal(state.reminder.lifecycleStatus, "ACTIVE");
      assert.equal(state.reminder.deliveryStatus, "BLOCKED_NO_RECIPIENTS");
      assert.deepEqual(
        state.reminder.pendingNotificationDelivery.recipients,
        [],
      );
      assert.equal(state.reminder.lastNotificationActivationCount, 0);
    },
  );
});

test("first non-empty recipient set freezes and delivers idempotently", async () => {
  const state = { reminder: makeReminder(), notifications: new Map() };
  const stubs = reminderModelStubs(state);
  const recipientQuery = {
    select() {
      return this;
    },
    session() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve([{ _id: adminA }]).then(resolve, reject);
    },
  };
  await withOverrides(
    [
      [VehicleServiceReminder, "findById", stubs.findById],
      [VehicleServiceReminder, "findOneAndUpdate", stubs.findOneAndUpdate],
      [VehicleServiceReminder, "updateOne", stubs.updateOne],
      [Vehicle, "findById", () => makeVehicleQuery()],
      [User, "find", () => recipientQuery],
      [Employee, "findById", () => query(null)],
      [
        Notification,
        "create",
        async (input) => {
          const key = `${input.userId}:${input.dedupeKey}`;
          if (state.notifications.has(key)) {
            throw Object.assign(new Error("duplicate"), { code: 11000 });
          }
          state.notifications.set(key, input);
          return { _id: `notification-${state.notifications.size}`, ...input };
        },
      ],
    ],
    async () => {
      const first = await deliverReminderNotifications(reminderId);
      assert.equal(first.pending, 0);
      assert.equal(state.reminder.deliveryStatus, "DELIVERED");
      assert.equal(state.reminder.lastNotificationActivationCount, 1);
      assert.equal(
        state.reminder.pendingNotificationDelivery.recipients.length,
        1,
      );
      const second = await deliverReminderNotifications(reminderId);
      assert.equal(second.delivered, 0);
      assert.equal(state.notifications.size, 1);
    },
  );
});

test("failed recipients stay pending and retry without redelivering successes", async () => {
  const state = {
    reminder: makeReminder({
      deliveryStatus: "PENDING",
      pendingNotificationDelivery: {
        activationCount: 1,
        deliveryStartedAt: new Date(),
        recipients: [adminA, adminB].map((userId) => ({
          userId,
          status: "PENDING",
          attemptCount: 0,
          lastAttemptAt: null,
          deliveredAt: null,
        })),
      },
    }),
    notifications: new Map(),
    failAdminB: true,
  };
  const stubs = reminderModelStubs(state);
  const originalError = console.error;
  console.error = () => {};
  await withOverrides(
    [
      [VehicleServiceReminder, "findById", stubs.findById],
      [VehicleServiceReminder, "findOneAndUpdate", stubs.findOneAndUpdate],
      [VehicleServiceReminder, "updateOne", stubs.updateOne],
      [Vehicle, "findById", () => makeVehicleQuery()],
      [User, "find", () => query([])],
      [Employee, "findById", () => query(null)],
      [
        Notification,
        "create",
        async (input) => {
          if (String(input.userId) === adminB && state.failAdminB)
            throw new Error("transient write failure");
          const key = `${input.userId}:${input.dedupeKey}`;
          if (state.notifications.has(key))
            throw Object.assign(new Error("duplicate"), { code: 11000 });
          state.notifications.set(key, input);
          return { _id: `notification-${state.notifications.size}`, ...input };
        },
      ],
    ],
    async () => {
      try {
        const first = await deliverReminderNotifications(reminderId);
        assert.equal(first.pending, 1);
        assert.equal(
          state.reminder.pendingNotificationDelivery.recipients[0].status,
          "DELIVERED",
        );
        assert.equal(
          state.reminder.pendingNotificationDelivery.recipients[1].status,
          "PENDING",
        );
        assert.equal(state.reminder.lastNotificationActivationCount, 0);

        state.failAdminB = false;
        const second = await deliverReminderNotifications(reminderId);
        assert.equal(second.pending, 0);
        assert.equal(state.reminder.deliveryStatus, "DELIVERED");
        assert.equal(state.reminder.lastNotificationActivationCount, 1);
        assert.equal(state.notifications.size, 2);
      } finally {
        console.error = originalError;
      }
    },
  );
});

test("due at the exact threshold creates one reminder and repeated reconciliation is idempotent", async () => {
  const state = {
    vehicle: {
      _id: vehicleId,
      status: "ACTIVE",
      initialOdometerKm: 0,
      currentOdometerKm: 3000,
      primaryAssignedEmployeeId: null,
      serviceStateRevision: 0,
    },
    policy: {
      _id: "policy-1",
      version: 1,
      intervalKm: 3000,
      isActive: true,
      coordinationRevision: 0,
    },
    reminder: null,
    createCount: 0,
  };
  const makeQuery = (getValue) => ({
    session() {
      return this;
    },
    sort() {
      return this;
    },
    select() {
      return this;
    },
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(getValue()).then(resolve, reject);
    },
  });
  await withOverrides(
    [
      [mongoose, "startSession", async () => transactionStub()],
      [Vehicle, "findById", () => makeQuery(() => state.vehicle)],
      [
        Vehicle,
        "updateOne",
        async (filter, update) => {
          if (
            filter.serviceStateRevision !== state.vehicle.serviceStateRevision
          )
            return { matchedCount: 0 };
          state.vehicle.serviceStateRevision +=
            update.$inc.serviceStateRevision;
          return { matchedCount: 1 };
        },
      ],
      [VehicleServicePolicy, "findOne", () => makeQuery(() => state.policy)],
      [
        VehicleServicePolicy,
        "updateOne",
        async (filter, update) => {
          if (filter.coordinationRevision !== state.policy.coordinationRevision)
            return { matchedCount: 0 };
          state.policy.coordinationRevision += update.$inc.coordinationRevision;
          return { matchedCount: 1 };
        },
      ],
      [VehicleUsageSession, "exists", () => makeQuery(() => false)],
      [VehicleService, "find", () => makeQuery(() => [])],
      [
        VehicleServiceReminder,
        "findOne",
        () => makeQuery(() => state.reminder),
      ],
      [
        VehicleServiceReminder,
        "create",
        async (documents) => {
          state.createCount++;
          state.reminder = { _id: "reminder-1", ...documents[0] };
          return [state.reminder];
        },
      ],
      [User, "find", () => makeQuery(() => [{ _id: adminA }])],
    ],
    async () => {
      const first = await reconcileVehicleReminder(vehicleId);
      assert.equal(first.action, "create");
      assert.equal(state.reminder.serviceStatus, "DUE");
      assert.equal(state.reminder.dueOdometerKm, 3000);
      assert.equal(state.reminder.cycleKey, `${vehicleId}:OIL_CHANGE:INITIAL`);
      assert.equal(state.reminder.deliveryStatus, "PENDING");
      assert.equal(state.vehicle.serviceStateRevision, 1);
      assert.equal(state.policy.coordinationRevision, 1);

      const second = await reconcileVehicleReminder(vehicleId);
      assert.equal(second.reason, "unchanged");
      assert.equal(state.createCount, 1);
      assert.equal(state.vehicle.serviceStateRevision, 1);
      assert.equal(state.policy.coordinationRevision, 1);
    },
  );
});

test("activation snapshots active admin and primary employee recipients only once", async () => {
  for (const employeeStatus of ["active", "inactive"]) {
    const state = {
      vehicle: {
        _id: vehicleId,
        status: "ACTIVE",
        initialOdometerKm: 0,
        currentOdometerKm: 3000,
        primaryAssignedEmployeeId: employeeId,
        serviceStateRevision: 0,
      },
      policy: {
        _id: "64b000000000000000000107",
        version: 1,
        intervalKm: 3000,
        isActive: true,
        coordinationRevision: 0,
      },
      reminder: null,
    };
    const makeQuery = (getValue) => ({
      session() { return this; },
      populate() { return this; },
      select() { return this; },
      sort() { return this; },
      then(resolve, reject) { return Promise.resolve(getValue()).then(resolve, reject); },
    });
    await withOverrides([
      [mongoose, "startSession", async () => transactionStub()],
      [Vehicle, "findById", () => makeQuery(() => state.vehicle)],
      [Vehicle, "updateOne", async (_filter, update) => {
        state.vehicle.serviceStateRevision += update.$inc.serviceStateRevision;
        return { matchedCount: 1 };
      }],
      [VehicleServicePolicy, "findOne", () => makeQuery(() => state.policy)],
      [VehicleServicePolicy, "updateOne", async (_filter, update) => {
        state.policy.coordinationRevision += update.$inc.coordinationRevision;
        return { matchedCount: 1 };
      }],
      [VehicleUsageSession, "exists", () => makeQuery(() => false)],
      [VehicleService, "find", () => makeQuery(() => [])],
      [VehicleServiceReminder, "findOne", () => makeQuery(() => null)],
      [VehicleServiceReminder, "create", async (documents) => { state.reminder = documents[0]; return [state.reminder]; }],
      [User, "find", (filter) => {
        assert.deepEqual(filter, { userType: { $in: ["admin", "superAdmin"] }, status: "active" });
        return makeQuery(() => [{ _id: adminA }, { _id: adminA }]);
      }],
      [Employee, "findById", (id) => makeQuery(() => ({
        _id: id,
        status: employeeStatus,
        userId: { _id: employeeUserId, status: "active", userType: "employee" },
      }))],
    ], async () => {
      const result = await reconcileVehicleReminder(vehicleId);
      assert.equal(result.action, "create");
      const recipients = state.reminder.pendingNotificationDelivery.recipients.map((entry) => String(entry.userId)).sort();
      const expected = employeeStatus === "active" ? [adminA, employeeUserId].sort() : [adminA];
      assert.deepEqual(recipients, expected);
    });
  }
});

test("reminder reconciliation does not activate or advance revisions without policy", async () => {
  const state = {
    vehicle: {
      _id: vehicleId,
      status: "ACTIVE",
      initialOdometerKm: 0,
      currentOdometerKm: 9000,
      serviceStateRevision: 0,
      primaryAssignedEmployeeId: null,
    },
    revisionWrites: 0,
  };
  const makeQuery = (getValue) => ({
    session() {
      return this;
    },
    sort() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(getValue()).then(resolve, reject);
    },
  });
  await withOverrides(
    [
      [mongoose, "startSession", async () => transactionStub()],
      [Vehicle, "findById", () => makeQuery(() => state.vehicle)],
      [VehicleServicePolicy, "findOne", () => makeQuery(() => null)],
      [VehicleUsageSession, "exists", () => makeQuery(() => false)],
      [VehicleService, "find", () => makeQuery(() => [])],
      [
        Vehicle,
        "updateOne",
        async () => {
          state.revisionWrites++;
          return { matchedCount: 1 };
        },
      ],
    ],
    async () => {
      const result = await reconcileVehicleReminder(vehicleId);
      assert.equal(result.reason, "policy_not_configured");
      assert.equal(state.revisionWrites, 0);
    },
  );
});

test("reminder reconciliation pauses when service baseline history needs review", async () => {
  const state = {
    vehicle: {
      _id: vehicleId,
      status: "ACTIVE",
      initialOdometerKm: 10000,
      currentOdometerKm: 13000,
      serviceStateRevision: 4,
      primaryAssignedEmployeeId: null,
    },
    vehicleRevisionWrites: 0,
    policyRevisionWrites: 0,
  };
  const makeQuery = (getValue) => ({
    session() { return this; },
    sort() { return this; },
    then(resolve, reject) { return Promise.resolve(getValue()).then(resolve, reject); },
  });
  await withOverrides([
    [mongoose, "startSession", async () => transactionStub()],
    [Vehicle, "findById", () => makeQuery(() => state.vehicle)],
    [Vehicle, "updateOne", async () => { state.vehicleRevisionWrites++; return { matchedCount: 1 }; }],
    [VehicleServicePolicy, "findOne", () => makeQuery(() => ({ _id: "policy", version: 1, intervalKm: 3000, isActive: true, coordinationRevision: 2 }))],
    [VehicleServicePolicy, "updateOne", async () => { state.policyRevisionWrites++; return { matchedCount: 1 }; }],
    [VehicleUsageSession, "exists", () => makeQuery(() => false)],
    [VehicleService, "find", () => makeQuery(() => [{ serviceType: "OIL_CHANGE", serviceOdometerKm: 12000, timelineReviewRequired: true }])],
  ], async () => {
    const result = await reconcileVehicleReminder(vehicleId);
    assert.equal(result.reason, "service_baseline_review_required");
    assert.equal(state.vehicleRevisionWrites, 0);
    assert.equal(state.policyRevisionWrites, 0);
  });
});

test("timeline review conflicts leave pending reminders undelivered", async () => {
  let pendingReminderLookups = 0;
  const makeQuery = (value) => ({
    session() { return this; },
    sort() { return this; },
    select() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  });
  await withOverrides([
    [mongoose, "startSession", async () => transactionStub()],
    [Vehicle, "findById", () => makeQuery({
      _id: vehicleId,
      status: "ACTIVE",
      initialOdometerKm: 10000,
      currentOdometerKm: 13000,
      serviceStateRevision: 4,
    })],
    [VehicleServicePolicy, "findOne", () => makeQuery({
      _id: "policy-review",
      version: 1,
      intervalKm: 3000,
      isActive: true,
      coordinationRevision: 2,
    })],
    [VehicleService, "find", () => makeQuery([])],
    [VehicleUsageSession, "exists", () => makeQuery(true)],
    [VehicleServiceReminder, "find", () => {
      pendingReminderLookups++;
      return makeQuery([makeReminder({ deliveryStatus: "PENDING" })]);
    }],
  ], async () => {
    const result = await reconcileAndDeliverVehicleReminders(vehicleId);
    assert.equal(result.reconciliation.reason, "service_baseline_review_required");
    assert.equal(result.delivered, 0);
    assert.equal(result.blocked, true);
    assert.equal(pendingReminderLookups, 0);
  });
});

test("corrected mileage suppresses a stale reminder and allows the same cycle to reactivate", async () => {
  const state = {
    vehicle: {
      _id: vehicleId,
      status: "ACTIVE",
      initialOdometerKm: 0,
      currentOdometerKm: 2900,
      serviceStateRevision: 4,
    },
    policy: {
      _id: "policy-corrected",
      version: 1,
      intervalKm: 3000,
      isActive: true,
      coordinationRevision: 3,
    },
    reminder: makeReminder({
      deliveryStatus: "PENDING",
      pendingNotificationDelivery: {
        activationCount: 1,
        recipients: [{
          userId: adminA,
          status: "PENDING",
          attemptCount: 0,
          lastAttemptAt: null,
          deliveredAt: null,
        }],
        deliveryStartedAt: new Date(),
      },
    }),
    notificationsCreated: 0,
  };
  const makeQuery = (getValue) => ({
    session() { return this; },
    sort() { return this; },
    select() { return this; },
    then(resolve, reject) { return Promise.resolve(getValue()).then(resolve, reject); },
  });
  await withOverrides([
    [mongoose, "startSession", async () => transactionStub()],
    [Vehicle, "findById", () => makeQuery(() => state.vehicle)],
    [Vehicle, "updateOne", async (_filter, update) => {
      state.vehicle.serviceStateRevision += update.$inc.serviceStateRevision;
      return { matchedCount: 1 };
    }],
    [VehicleServicePolicy, "findOne", () => makeQuery(() => state.policy)],
    [VehicleServicePolicy, "updateOne", async (_filter, update) => {
      state.policy.coordinationRevision += update.$inc.coordinationRevision;
      return { matchedCount: 1 };
    }],
    [VehicleService, "find", () => makeQuery(() => [])],
    [VehicleUsageSession, "exists", () => makeQuery(() => false)],
    [VehicleServiceReminder, "findOne", () => makeQuery(() => state.reminder)],
    [VehicleServiceReminder, "updateOne", async (_filter, update) => {
      Object.assign(state.reminder, update.$set);
      return { matchedCount: 1 };
    }],
    [VehicleServiceReminder, "find", (filter) => {
      assert.equal(filter.lifecycleStatus, "ACTIVE");
      return makeQuery(() => state.reminder.lifecycleStatus === "ACTIVE" ? [state.reminder] : []);
    }],
    [User, "find", () => makeQuery(() => [{ _id: adminA }])],
    [Notification, "create", async () => { state.notificationsCreated++; }],
  ], async () => {
    const result = await reconcileAndDeliverVehicleReminders(vehicleId);
    assert.equal(result.reconciliation.action, "supersede");
    assert.equal(state.reminder.lifecycleStatus, "SUPERSEDED");
    assert.equal(result.delivered, 0);
    assert.equal(state.notificationsCreated, 0);

    state.vehicle.currentOdometerKm = 3000;
    const reactivated = await reconcileVehicleReminder(vehicleId);
    assert.equal(reactivated.action, "reactivate");
    assert.equal(state.reminder.lifecycleStatus, "ACTIVE");
    assert.equal(state.reminder.activationCount, 2);
    assert.deepEqual(
      state.reminder.pendingNotificationDelivery.recipients.map((entry) => [
        String(entry.userId),
        entry.status,
      ]),
      [[adminA, "PENDING"]],
    );
  });
});

test("superseded and resolved reminders cannot deliver pending notifications", async () => {
  for (const lifecycleStatus of ["SUPERSEDED", "RESOLVED"]) {
    let notificationWrites = 0;
    await withOverrides([
      [VehicleServiceReminder, "findById", () => query(makeReminder({ lifecycleStatus, deliveryStatus: "PENDING" }))],
      [Notification, "create", async () => { notificationWrites++; }],
    ], async () => {
      const result = await deliverReminderNotifications(reminderId);
      assert.deepEqual(result, { delivered: 0, pending: 0 });
      assert.equal(notificationWrites, 0);
    });
  }
});

test("vehicle CAS conflict retries reconciliation from fresh state and succeeds", async () => {
  let attempts = 0;
  const result = await retryWithBoundedConflicts(async () => {
    attempts++;
    if (attempts === 1) {
      throw vehicleError(409, "REVISION_CONFLICT", "Vehicle revision changed");
    }
    return { changed: true, reason: "fresh revision" };
  }, "vehicle revision test");

  assert.equal(attempts, 2);
  assert.deepEqual(result, { changed: true, reason: "fresh revision" });
});

test("policy CAS conflict retries reconciliation from fresh policy and succeeds", async () => {
  let attempts = 0;
  const result = await retryWithBoundedConflicts(async () => {
    attempts++;
    if (attempts === 1) {
      throw vehicleError(409, "POLICY_VERSION_CONFLICT", "Policy revision changed");
    }
    return { changed: true, reason: "fresh policy" };
  }, "policy revision test");

  assert.equal(attempts, 2);
  assert.deepEqual(result, { changed: true, reason: "fresh policy" });
});

test("reminder CAS conflict retries and preserves the three-attempt bound", async () => {
  let attempts = 0;
  const result = await retryWithBoundedConflicts(async () => {
    attempts++;
    if (attempts <= 2) {
      throw vehicleError(409, "REMINDER_CONFLICT", "Reminder changed");
    }
    return { changed: true };
  }, "reminder CAS test");
  assert.equal(attempts, 3);
  assert.deepEqual(result, { changed: true });

  attempts = 0;
  const originalError = console.error;
  console.error = () => {};
  try {
    const exhausted = await retryWithBoundedConflicts(async () => {
      attempts++;
      throw vehicleError(409, "REVISION_CONFLICT", "Still stale");
    }, "retry exhaustion test");
    assert.equal(attempts, 3);
    assert.equal(exhausted.error, "REVISION_CONFLICT");
  } finally {
    console.error = originalError;
  }
});
