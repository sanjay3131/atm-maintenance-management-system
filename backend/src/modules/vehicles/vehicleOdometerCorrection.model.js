import mongoose from "mongoose";

const vehicleOdometerCorrectionSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    },
    usageSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VehicleUsageSession",
      default: null,
    },
    correctedField: {
      type: String,
      enum: ["CURRENT", "START", "END"],
      default: "CURRENT",
    },
    previousOdometerKm: { type: Number, required: true, min: 0 },
    correctedOdometerKm: { type: Number, required: true, min: 0 },
    reason: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 1000,
    },
    correctedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    correctedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

vehicleOdometerCorrectionSchema.index({ vehicleId: 1, correctedAt: -1 });
vehicleOdometerCorrectionSchema.index({ correctedBy: 1, correctedAt: -1 });
vehicleOdometerCorrectionSchema.index({ usageSessionId: 1, correctedAt: -1 });

const VehicleOdometerCorrection = mongoose.model(
  "VehicleOdometerCorrection",
  vehicleOdometerCorrectionSchema,
);

export default VehicleOdometerCorrection;
