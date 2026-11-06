import mongoose from "mongoose";

const usageSessionSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    employeeNameSnapshot: { type: String, required: true, trim: true },
    employeeCodeSnapshot: { type: String, required: true, trim: true },
    vehicleRegistrationSnapshot: { type: String, required: true, trim: true },
    businessDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    startOdometerKm: { type: Number, required: true, min: 0 },
    endOdometerKm: { type: Number, default: null, min: 0 },
    distanceKm: { type: Number, default: null, min: 0 },
    startedAt: { type: Date, required: true, default: Date.now },
    endedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
      default: "IN_PROGRESS",
    },
    recoveryAction: {
      type: String,
      enum: ["RECOVERED_COMPLETED", "CANCELLED", null],
      default: null,
    },
    recoveryReason: { type: String, trim: true, maxlength: 1000, default: "" },
    recoveredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    recoveredAt: { type: Date, default: null },
    verifiedEndOdometerKm: { type: Number, default: null, min: 0 },
    timelineReviewRequired: { type: Boolean, default: false },
    timelineReviewReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

usageSessionSchema.index(
  { vehicleId: 1 },
  {
    unique: true,
    name: "vehicleId_active_usage_session_unique",
    partialFilterExpression: { status: "IN_PROGRESS" },
  },
);
usageSessionSchema.index(
  { employeeId: 1 },
  {
    unique: true,
    name: "employeeId_active_usage_session_unique",
    partialFilterExpression: { status: "IN_PROGRESS" },
  },
);
usageSessionSchema.index({ vehicleId: 1, businessDate: 1, startedAt: -1 });
usageSessionSchema.index({ employeeId: 1, businessDate: 1, startedAt: -1 });
usageSessionSchema.index({ businessDate: 1, status: 1 });
usageSessionSchema.index({ vehicleId: 1, startedAt: -1 });

const VehicleUsageSession = mongoose.model(
  "VehicleUsageSession",
  usageSessionSchema,
);

export default VehicleUsageSession;
