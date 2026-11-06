import mongoose from "mongoose";

const recipientDeliverySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "DELIVERED"],
      default: "PENDING",
    },
    attemptCount: { type: Number, min: 0, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { _id: false },
);

const pendingDeliverySchema = new mongoose.Schema(
  {
    activationCount: { type: Number, required: true, min: 1 },
    recipients: { type: [recipientDeliverySchema], default: [] },
    deliveryStartedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const vehicleServiceReminderSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    },
    serviceType: { type: String, enum: ["OIL_CHANGE"], required: true },
    cycleKey: { type: String, required: true },
    baselineServiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VehicleService",
      default: null,
    },
    baselineOdometerKm: { type: Number, required: true, min: 0 },
    dueOdometerKm: { type: Number, required: true, min: 0 },
    policyVersion: { type: Number, required: true, min: 1 },
    serviceStatus: {
      type: String,
      enum: ["UPCOMING", "DUE", "OVERDUE", "POLICY_NOT_CONFIGURED"],
      required: true,
    },
    lifecycleStatus: {
      type: String,
      enum: ["ACTIVE", "RESOLVED", "SUPERSEDED"],
      required: true,
    },
    deliveryStatus: {
      type: String,
      enum: ["PENDING", "BLOCKED_NO_RECIPIENTS", "DELIVERED"],
      required: true,
    },
    activationCount: { type: Number, required: true, min: 1, default: 1 },
    lastActivatedAt: { type: Date, required: true, default: Date.now },
    lastNotificationActivationCount: { type: Number, min: 0, default: 0 },
    pendingNotificationDelivery: { type: pendingDeliverySchema, default: null },
    resolvedByServiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VehicleService",
      default: null,
    },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

vehicleServiceReminderSchema.index(
  { cycleKey: 1 },
  { unique: true, name: "cycleKey_unique" },
);
vehicleServiceReminderSchema.index(
  { vehicleId: 1, serviceType: 1 },
  {
    unique: true,
    name: "vehicle_service_active_reminder_unique",
    partialFilterExpression: { lifecycleStatus: "ACTIVE" },
  },
);
vehicleServiceReminderSchema.index({
  lifecycleStatus: 1,
  deliveryStatus: 1,
  updatedAt: 1,
});
vehicleServiceReminderSchema.index({ vehicleId: 1, createdAt: -1 });

const VehicleServiceReminder = mongoose.model(
  "VehicleServiceReminder",
  vehicleServiceReminderSchema,
);

export default VehicleServiceReminder;
