import mongoose from "mongoose";

const odometerReadingSchema = new mongoose.Schema(
  {
    odometerKm: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    distanceKm: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    occurredAt: { type: Date, required: true },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    employeeNameSnapshot: { type: String, required: true, trim: true },
    employeeCodeSnapshot: { type: String, required: true, trim: true },
    requestId: { type: String, trim: true, maxlength: 128, default: null },
    idempotencyResult: {
      dailyDistanceKm: { type: Number, min: 0, default: null },
      dailyMileageRevision: { type: Number, min: 0, default: null },
      vehicleRevision: { type: Number, min: 0, default: null },
    },
    source: {
      type: String,
      enum: [
        "BASELINE",
        "EMPLOYEE_SUBMISSION",
        "SESSION_END",
        "HANDOVER",
        "CLOSE",
        "ROLLOVER_RECOVERY",
      ],
      required: true,
    },
  },
  { timestamps: true },
);

const usageSessionSchema = new mongoose.Schema(
  {
    startRequestId: { type: String, required: true, trim: true, maxlength: 128 },
    endRequestId: { type: String, trim: true, maxlength: 128, default: null },
    startOdometerKm: { type: Number, required: true, min: 0 },
    endOdometerKm: { type: Number, default: null, min: 0 },
    distanceKm: { type: Number, default: null, min: 0 },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    endedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["IN_PROGRESS", "COMPLETED", "RECOVERY_REQUIRED", "RECOVERED_COMPLETED"],
      default: "IN_PROGRESS",
    },
  },
  { timestamps: true },
);

const employeeSegmentSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    employeeNameSnapshot: { type: String, required: true, trim: true },
    employeeCodeSnapshot: { type: String, required: true, trim: true },
    startOdometerKm: { type: Number, required: true, min: 0 },
    endOdometerKm: { type: Number, default: null, min: 0 },
    distanceKm: { type: Number, default: null, min: 0 },
    odometerReadingsComplete: { type: Boolean, default: false },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    startedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    usageSessions: { type: [usageSessionSchema], default: [] },
    odometerReadings: { type: [odometerReadingSchema], default: [] },
    endedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

const auditEntrySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: [
        "STARTED",
        "USAGE_SESSION_STARTED",
        "USAGE_SESSION_COMPLETED",
        "ODOMETER_READING_ADDED",
        "HANDOVER",
        "JOINED",
        "CLOSED",
        "REOPENED",
        "ODOMETER_CORRECTED",
        "TIMELINE_RECALCULATED",
        "ROLLOVER_PENDING",
        "ROLLOVER_RECOVERED",
        "ROLLOVER_STARTED",
      ],
      required: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    employeeNameSnapshot: { type: String, trim: true, default: "" },
    employeeCodeSnapshot: { type: String, trim: true, default: "" },
    handoverEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    nextBusinessDate: {
      type: String,
      match: /^\d{4}-\d{2}-\d{2}$/,
      default: null,
    },
    odometerKm: { type: Number, required: true, min: 0 },
    occurredAt: { type: Date, required: true },
    details: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { _id: false },
);

const vehicleDailyMileageSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    },
    vehicleRegistrationSnapshot: { type: String, required: true, trim: true },
    businessDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    startOdometerKm: { type: Number, required: true, min: 0 },
    endOdometerKm: { type: Number, default: null, min: 0 },
    dailyDistanceKm: { type: Number, default: null, min: 0 },
    latestOdometerKm: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["OPEN", "ROLLOVER_PENDING", "CLOSED"],
      default: "OPEN",
    },
    activeRecordLock: { type: Boolean, default: false },
    activeEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    segments: { type: [employeeSegmentSchema], default: [] },
    auditHistory: { type: [auditEntrySchema], default: [] },
    revision: { type: Number, min: 0, default: 0 },
    timelineReviewRequired: { type: Boolean, default: false },
    timelineReviewReason: { type: String, trim: true, default: "" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

vehicleDailyMileageSchema.index(
  { vehicleId: 1, businessDate: 1 },
  { unique: true, name: "vehicle_daily_mileage_date_unique" },
);
vehicleDailyMileageSchema.index(
  { vehicleId: 1 },
  {
    unique: true,
    name: "vehicle_open_daily_mileage_unique",
    partialFilterExpression: { status: "OPEN" },
  },
);
vehicleDailyMileageSchema.index(
  { vehicleId: 1 },
  {
    unique: true,
    name: "vehicle_active_daily_mileage_unique",
    partialFilterExpression: { activeRecordLock: true },
  },
);
vehicleDailyMileageSchema.index(
  { activeEmployeeId: 1 },
  {
    unique: true,
    name: "employee_active_daily_mileage_unique",
    partialFilterExpression: {
      activeRecordLock: true,
      activeEmployeeId: { $type: "objectId" },
    },
  },
);
vehicleDailyMileageSchema.index(
  { activeEmployeeId: 1 },
  {
    unique: true,
    name: "employee_open_daily_mileage_unique",
    partialFilterExpression: {
      status: "OPEN",
      activeEmployeeId: { $type: "objectId" },
    },
  },
);
vehicleDailyMileageSchema.index({ businessDate: 1, status: 1 });
vehicleDailyMileageSchema.index({
  "segments.employeeId": 1,
  businessDate: -1,
});

const VehicleDailyMileage = mongoose.model(
  "VehicleDailyMileage",
  vehicleDailyMileageSchema,
);

export default VehicleDailyMileage;
