import mongoose from "mongoose";
import User from "../users/user.model.js";
import Employee from "../employees/employee.model.js";
import { createNotification } from "../notification/notification.service.js";
import { vehicleError } from "./vehicle.errors.js";
import Vehicle from "./vehicle.model.js";
import VehicleAssignment from "./vehicleAssignment.model.js";
import VehicleUsageSession from "./vehicleUsageSession.model.js";
import VehicleService from "./vehicleService.model.js";
import VehicleServicePolicy from "./vehicleServicePolicy.model.js";
import VehicleServiceReminder from "./vehicleServiceReminder.model.js";
import { getLatestOilService, getServiceStatus } from "./vehicle.utils.js";
import { getCycleKey, withVehicleTransaction } from "./vehicle.service.js";

const idString = (value) => String(value?._id ?? value);

const getEligibleRecipientIds = async (vehicle, session) => {
  const admins = await User.find({
    userType: { $in: ["admin", "superAdmin"] },
    status: "active",
  })
    .select("_id")
    .session(session);
  const recipientIds = new Set(admins.map((admin) => idString(admin._id)));

  if (vehicle.primaryAssignedEmployeeId) {
    const employee = await Employee.findById(vehicle.primaryAssignedEmployeeId)
      .populate("userId", "userType status")
      .session(session);
    if (
      employee?.status === "active" &&
      employee.userId?.status === "active" &&
      employee.userId?.userType === "employee"
    ) {
      recipientIds.add(idString(employee.userId._id));
    }
  }
  return [...recipientIds].map((userId) => new mongoose.Types.ObjectId(userId));
};

const bumpVehicleRevision = async (vehicle, session) => {
  const result = await Vehicle.updateOne(
    { _id: vehicle._id, serviceStateRevision: vehicle.serviceStateRevision },
    { $inc: { serviceStateRevision: 1 } },
    { session },
  );
  if (result.matchedCount !== 1) {
    throw vehicleError(
      409,
      "REVISION_CONFLICT",
      "Vehicle state changed during reminder reconciliation",
    );
  }
};

const bumpPolicyRevision = async (policy, session) => {
  const result = await VehicleServicePolicy.updateOne(
    {
      _id: policy._id,
      serviceType: "OIL_CHANGE",
      version: policy.version,
      isActive: true,
      coordinationRevision: policy.coordinationRevision,
    },
    { $inc: { coordinationRevision: 1 } },
    { session },
  );
  if (result.matchedCount !== 1) {
    throw vehicleError(
      409,
      "POLICY_VERSION_CONFLICT",
      "Service policy changed during reminder reconciliation",
    );
  }
};

const loadServiceState = async (vehicle, session) => {
  const policy = await VehicleServicePolicy.findOne({
    serviceType: "OIL_CHANGE",
    isActive: true,
  }).session(session);
  const services = await VehicleService.find({
    vehicleId: vehicle._id,
    serviceType: "OIL_CHANGE",
  })
    .sort({ serviceOdometerKm: -1, serviceDate: -1, createdAt: -1, _id: -1 })
    .session(session);
  const conflictedSession = await VehicleUsageSession.exists({
    vehicleId: vehicle._id,
    status: "COMPLETED",
    timelineReviewRequired: true,
  }).session(session);
  const hasServiceReviewConflict = services.some(
    (service) => service.timelineReviewRequired,
  );
  if (!policy)
    return {
      policy: null,
      baselineService: null,
      baselineOdometerKm: vehicle.initialOdometerKm,
      hasTimelineReviewConflict: Boolean(conflictedSession || hasServiceReviewConflict),
    };
  const baselineService = getLatestOilService(services);
  return {
    policy,
    baselineService,
    baselineOdometerKm:
      baselineService?.serviceOdometerKm ?? vehicle.initialOdometerKm,
    hasTimelineReviewConflict: Boolean(conflictedSession || hasServiceReviewConflict),
  };
};

const makeActivation = async ({
  vehicle,
  cycleKey,
  baselineService,
  baselineOdometerKm,
  policy,
  serviceStatus,
  session,
  activationCount,
}) => {
  const recipients = await getEligibleRecipientIds(vehicle, session);
  const now = new Date();
  return {
    vehicleId: vehicle._id,
    serviceType: "OIL_CHANGE",
    cycleKey,
    baselineServiceId: baselineService?._id ?? null,
    baselineOdometerKm,
    dueOdometerKm: serviceStatus.nextServiceOdometerKm,
    policyVersion: policy.version,
    serviceStatus: serviceStatus.status,
    lifecycleStatus: "ACTIVE",
    deliveryStatus: recipients.length ? "PENDING" : "BLOCKED_NO_RECIPIENTS",
    activationCount,
    lastActivatedAt: now,
    lastNotificationActivationCount: activationCount - 1,
    pendingNotificationDelivery: {
      activationCount,
      recipients: recipients.map((userId) => ({
        userId,
        status: "PENDING",
        attemptCount: 0,
        lastAttemptAt: null,
        deliveredAt: null,
      })),
      deliveryStartedAt: now,
    },
  };
};

export const reconcileVehicleReminder = async (vehicleId) =>
  withVehicleTransaction(async (session) => {
    const vehicle = await Vehicle.findById(vehicleId).session(session);
    if (!vehicle) return { changed: false, reason: "vehicle_missing" };
    const { policy, baselineService, baselineOdometerKm, hasTimelineReviewConflict } =
      await loadServiceState(vehicle, session);
    if (!policy) return { changed: false, reason: "policy_not_configured" };
    if (hasTimelineReviewConflict) {
      return { changed: false, reason: "service_baseline_review_required" };
    }

    const serviceStatus = getServiceStatus({
      currentOdometerKm: vehicle.currentOdometerKm,
      baselineOdometerKm,
      intervalKm: policy.intervalKm,
    });
    const cycleKey = getCycleKey(vehicle._id, baselineService?._id ?? null);
    let reminder = await VehicleServiceReminder.findOne({ cycleKey }).session(
      session,
    );
    const isDue =
      vehicle.status === "ACTIVE" &&
      ["DUE", "OVERDUE"].includes(serviceStatus.status);

    if (reminder?.lifecycleStatus === "RESOLVED") {
      return { changed: false, reason: "cycle_resolved" };
    }

    let action = null;
    let update = null;
    if (!isDue && reminder?.lifecycleStatus === "ACTIVE") {
      action = "supersede";
      update = {
        lifecycleStatus: "SUPERSEDED",
        serviceStatus: serviceStatus.status,
        dueOdometerKm: serviceStatus.nextServiceOdometerKm,
        policyVersion: policy.version,
        baselineServiceId: baselineService?._id ?? null,
        baselineOdometerKm,
      };
    } else if (isDue && !reminder) {
      action = "create";
      update = await makeActivation({
        vehicle,
        cycleKey,
        baselineService,
        baselineOdometerKm,
        policy,
        serviceStatus,
        session,
        activationCount: 1,
      });
    } else if (isDue && reminder?.lifecycleStatus === "SUPERSEDED") {
      action = "reactivate";
      update = await makeActivation({
        vehicle,
        cycleKey,
        baselineService,
        baselineOdometerKm,
        policy,
        serviceStatus,
        session,
        activationCount: reminder.activationCount + 1,
      });
    } else if (isDue && reminder?.lifecycleStatus === "ACTIVE") {
      const changed =
        reminder.serviceStatus !== serviceStatus.status ||
        reminder.dueOdometerKm !== serviceStatus.nextServiceOdometerKm ||
        reminder.policyVersion !== policy.version ||
        idString(reminder.baselineServiceId ?? "INITIAL") !==
          idString(baselineService?._id ?? "INITIAL");
      if (!changed) return { changed: false, reason: "unchanged" };
      action = "refresh_due_state";
      update = {
        serviceStatus: serviceStatus.status,
        dueOdometerKm: serviceStatus.nextServiceOdometerKm,
        policyVersion: policy.version,
        baselineServiceId: baselineService?._id ?? null,
        baselineOdometerKm,
      };
    } else {
      return { changed: false, reason: "not_due" };
    }

    await bumpVehicleRevision(vehicle, session);
    await bumpPolicyRevision(policy, session);

    if (action === "create") {
      [reminder] = await VehicleServiceReminder.create([update], { session });
    } else {
      const expected = {
        _id: reminder._id,
        cycleKey,
        lifecycleStatus: reminder.lifecycleStatus,
        activationCount: reminder.activationCount,
      };
      const fields = action === "reactivate" ? update : update;
      const changed = await VehicleServiceReminder.updateOne(
        expected,
        { $set: fields },
        { session, runValidators: true },
      );
      if (changed.matchedCount !== 1) {
        throw vehicleError(
          409,
          "REMINDER_CONFLICT",
          "Reminder changed during reconciliation",
        );
      }
      reminder = await VehicleServiceReminder.findById(reminder._id).session(
        session,
      );
    }
    return { changed: true, action, reminderId: reminder._id };
  });

const freezeRecipients = async (reminder) => {
  if (
    reminder.deliveryStatus !== "BLOCKED_NO_RECIPIENTS" ||
    reminder.pendingNotificationDelivery?.recipients?.length
  )
    return reminder;

  const vehicle = await Vehicle.findById(reminder.vehicleId);
  if (!vehicle) return reminder;
  const recipientIds = await getEligibleRecipientIds(vehicle, null);
  if (!recipientIds.length) return reminder;
  const recipients = recipientIds.map((userId) => ({
    userId,
    status: "PENDING",
    attemptCount: 0,
    lastAttemptAt: null,
    deliveredAt: null,
  }));
  const updated = await VehicleServiceReminder.findOneAndUpdate(
    {
      _id: reminder._id,
      cycleKey: reminder.cycleKey,
      activationCount: reminder.activationCount,
      deliveryStatus: "BLOCKED_NO_RECIPIENTS",
      "pendingNotificationDelivery.activationCount": reminder.activationCount,
      "pendingNotificationDelivery.recipients": { $size: 0 },
    },
    {
      $set: {
        deliveryStatus: "PENDING",
        "pendingNotificationDelivery.recipients": recipients,
      },
    },
    { new: true, runValidators: true },
  );
  return updated ?? VehicleServiceReminder.findById(reminder._id);
};

export const deliverReminderNotifications = async (reminderId) => {
  let reminder = await VehicleServiceReminder.findById(reminderId);
  if (
    !reminder ||
    reminder.lifecycleStatus !== "ACTIVE" ||
    reminder.deliveryStatus === "DELIVERED"
  )
    return { delivered: 0, pending: 0 };
  reminder = await freezeRecipients(reminder);
  if (!reminder || reminder.deliveryStatus === "BLOCKED_NO_RECIPIENTS")
    return { delivered: 0, pending: 0, blocked: true };

  const vehicle = await Vehicle.findById(reminder.vehicleId).select(
    "registrationNumber currentOdometerKm",
  );
  if (!vehicle)
    return {
      delivered: 0,
      pending: reminder.pendingNotificationDelivery?.recipients?.length ?? 0,
    };
  let delivered = 0;
  for (const recipient of reminder.pendingNotificationDelivery?.recipients ??
    []) {
    if (recipient.status === "DELIVERED") continue;
    const userId = recipient.userId;
    const attempt = await VehicleServiceReminder.updateOne(
      {
        _id: reminder._id,
        cycleKey: reminder.cycleKey,
        activationCount: reminder.activationCount,
        "pendingNotificationDelivery.activationCount": reminder.activationCount,
        "pendingNotificationDelivery.recipients": {
          $elemMatch: { userId, status: "PENDING" },
        },
      },
      {
        $inc: { "pendingNotificationDelivery.recipients.$.attemptCount": 1 },
        $set: {
          "pendingNotificationDelivery.recipients.$.lastAttemptAt": new Date(),
        },
      },
    );
    if (attempt.matchedCount !== 1) continue;

    try {
      await createNotification({
        userId,
        type: "system",
        title: "Oil service due",
        message: `${vehicle.registrationNumber} has reached its oil service reading (${reminder.dueOdometerKm} KM). Current odometer: ${vehicle.currentOdometerKm} KM. Status: ${reminder.serviceStatus}.`,
        data: {
          vehicleId: String(vehicle._id),
          reminderId: String(reminder._id),
          cycleKey: reminder.cycleKey,
          serviceType: reminder.serviceType,
          activationCount: reminder.activationCount,
          currentOdometerKm: vehicle.currentOdometerKm,
          dueOdometerKm: reminder.dueOdometerKm,
          serviceStatus: reminder.serviceStatus,
        },
        dedupeKey: `vehicle-service:${reminder.cycleKey}:activation:${reminder.activationCount}:${userId}`,
      });
      const marked = await VehicleServiceReminder.updateOne(
        {
          _id: reminder._id,
          cycleKey: reminder.cycleKey,
          activationCount: reminder.activationCount,
          "pendingNotificationDelivery.activationCount":
            reminder.activationCount,
          "pendingNotificationDelivery.recipients": {
            $elemMatch: { userId, status: "PENDING" },
          },
        },
        {
          $set: {
            "pendingNotificationDelivery.recipients.$.status": "DELIVERED",
            "pendingNotificationDelivery.recipients.$.deliveredAt": new Date(),
          },
        },
      );
      if (marked.matchedCount === 1) delivered++;
    } catch (error) {
      console.error(
        `[Vehicle Reminder] Notification delivery failed for recipient ${userId}:`,
        error,
      );
    }
  }

  const latest = await VehicleServiceReminder.findById(reminder._id);
  const recipients = latest?.pendingNotificationDelivery?.recipients ?? [];
  if (
    latest &&
    recipients.length > 0 &&
    recipients.every((entry) => entry.status === "DELIVERED")
  ) {
    await VehicleServiceReminder.updateOne(
      {
        _id: latest._id,
        cycleKey: latest.cycleKey,
        activationCount: latest.activationCount,
        "pendingNotificationDelivery.activationCount": latest.activationCount,
        deliveryStatus: { $ne: "DELIVERED" },
      },
      {
        $set: {
          deliveryStatus: "DELIVERED",
          lastNotificationActivationCount: latest.activationCount,
        },
      },
    );
  }
  return {
    delivered,
    pending: recipients.filter((entry) => entry.status !== "DELIVERED").length,
  };
};

export const retryWithBoundedConflicts = async (operation, label) => {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable =
        error?.code === 112 ||
        error?.code === 251 ||
        error?.code === 11000 ||
        error?.code === "REVISION_CONFLICT" ||
        error?.code === "POLICY_VERSION_CONFLICT" ||
        error?.code === "REMINDER_CONFLICT" ||
        error?.hasErrorLabel?.("TransientTransactionError");
      if (!retryable || attempt === 2) break;
    }
  }
  console.error(
    `[Vehicle Reminder] ${label} exhausted bounded retries:`,
    lastError,
  );
  return { changed: false, error: lastError?.code ?? "RETRY_EXHAUSTED" };
};

export const reconcileAndDeliverVehicleReminders = async (vehicleId) => {
  const reconciliation = await retryWithBoundedConflicts(
    () => reconcileVehicleReminder(vehicleId),
    `reconciliation for ${vehicleId}`,
  );
  if (
    reconciliation?.error ||
    [
      "vehicle_missing",
      "policy_not_configured",
      "service_baseline_review_required",
    ].includes(reconciliation?.reason)
  ) {
    return { reconciliation, delivered: 0, blocked: true };
  }

  const pendingReminders = await VehicleServiceReminder.find({
    vehicleId,
    lifecycleStatus: "ACTIVE",
    deliveryStatus: { $in: ["PENDING", "BLOCKED_NO_RECIPIENTS"] },
    pendingNotificationDelivery: { $ne: null },
  }).select("_id");
  let delivered = 0;
  let blocked = false;
  for (const reminder of pendingReminders) {
    const result = await deliverReminderNotifications(reminder._id);
    delivered += result.delivered ?? 0;
    blocked ||= Boolean(result.blocked);
  }
  return { reconciliation, delivered, blocked };
};

export const processVehicleReminders = async () => {
  const stats = {
    vehicles: 0,
    reconciled: 0,
    delivered: 0,
    blocked: 0,
    failed: 0,
  };
  const vehicles = await Vehicle.find({}).select("_id").sort({ _id: 1 }).lean();
  for (const vehicle of vehicles) {
    stats.vehicles++;
    const result = await reconcileAndDeliverVehicleReminders(vehicle._id);
    const reconciliation = result.reconciliation;
    if (reconciliation?.changed) stats.reconciled++;
    if (reconciliation?.error) stats.failed++;
    stats.delivered += result.delivered;
    if (result.blocked) stats.blocked++;
  }
  return stats;
};
