import mongoose from "mongoose";

const vehicleServicePolicySchema = new mongoose.Schema(
  {
    serviceType: { type: String, enum: ["OIL_CHANGE"], required: true },
    intervalKm: { type: Number, required: true, min: 1 },
    version: { type: Number, required: true, min: 1 },
    effectiveFrom: { type: Date, required: true, default: Date.now },
    isActive: { type: Boolean, required: true, default: true },
    coordinationRevision: { type: Number, required: true, min: 0, default: 0 },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

vehicleServicePolicySchema.index(
  { serviceType: 1, version: 1 },
  { unique: true, name: "serviceType_version_unique" },
);
vehicleServicePolicySchema.index(
  { serviceType: 1 },
  {
    unique: true,
    name: "serviceType_active_policy_unique",
    partialFilterExpression: { isActive: true },
  },
);

const VehicleServicePolicy = mongoose.model(
  "VehicleServicePolicy",
  vehicleServicePolicySchema,
);

export default VehicleServicePolicy;
