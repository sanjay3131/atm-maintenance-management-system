import mongoose from "mongoose";

const vehicleSchema = new mongoose.Schema(
  {
    registrationNumber: { type: String, required: true, trim: true },
    registrationNumberNormalized: {
      type: String,
      required: true,
      trim: true,
      select: false,
    },
    make: { type: String, required: true, trim: true, maxlength: 100 },
    model: { type: String, required: true, trim: true, maxlength: 100 },
    initialOdometerKm: { type: Number, required: true, min: 0 },
    currentOdometerKm: { type: Number, required: true, min: 0 },
    primaryAssignedEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
    serviceStateRevision: { type: Number, min: 0, default: 0 },
    purchaseDate: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: "" },
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

vehicleSchema.index(
  { registrationNumberNormalized: 1 },
  { unique: true, name: "registrationNumberNormalized_1_unique" },
);
vehicleSchema.index({ status: 1, registrationNumberNormalized: 1 });
vehicleSchema.index({ primaryAssignedEmployeeId: 1 });

const Vehicle = mongoose.model("Vehicle", vehicleSchema);

export default Vehicle;
