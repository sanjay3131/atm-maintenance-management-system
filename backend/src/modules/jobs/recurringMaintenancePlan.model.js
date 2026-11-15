import mongoose from "mongoose";

const recurringMaintenancePlanSchema = new mongoose.Schema(
  {
    atmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ATM",
      required: true,
    },
    geographySnapshot: {
      bankId: { type: mongoose.Schema.Types.ObjectId, ref: "Bank" },
      bankName: { type: String, trim: true },
      regionId: { type: mongoose.Schema.Types.ObjectId, ref: "Region" },
      regionName: { type: String, trim: true },
      districtId: { type: mongoose.Schema.Types.ObjectId, ref: "District" },
      districtName: { type: String, trim: true },
      capturedAt: { type: Date },
    },
    assignedEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    maintenanceType: {
      type: String,
      enum: ["DAILY_CLEANING", "WEEKLY_MOPPING"],
      required: true,
    },
    dayOfWeek: {
      type: Number,
      min: 0,
      max: 6,
      default: null,
    },
    startDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

recurringMaintenancePlanSchema.pre("validate", function () {
  if (this.maintenanceType === "WEEKLY_MOPPING" && this.dayOfWeek == null) {
    this.invalidate("dayOfWeek", "A weekday is required for weekly mopping");
  }
  if (this.maintenanceType === "DAILY_CLEANING" && this.dayOfWeek != null) {
    this.invalidate("dayOfWeek", "Daily cleaning cannot have a weekday");
  }
});

recurringMaintenancePlanSchema.index(
  { atmId: 1, maintenanceType: 1 },
  { unique: true, name: "unique_atm_maintenance_plan" },
);
recurringMaintenancePlanSchema.index({ isActive: 1, maintenanceType: 1 });

const RecurringMaintenancePlan = mongoose.model(
  "RecurringMaintenancePlan",
  recurringMaintenancePlanSchema,
);

export default RecurringMaintenancePlan;
