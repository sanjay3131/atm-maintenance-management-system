import mongoose from "mongoose";

const timelineReviewEntrySchema = new mongoose.Schema(
  {
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reviewedAt: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { _id: false },
);

const vehicleServiceSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    },
    serviceType: { type: String, enum: ["OIL_CHANGE"], required: true },
    serviceOdometerKm: { type: Number, required: true, min: 0 },
    serviceDate: { type: Date, required: true },
    notes: { type: String, trim: true, maxlength: 2000, default: "" },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    timelineReviewRequired: { type: Boolean, default: false },
    timelineReviewReason: { type: String, trim: true, default: "" },
    timelineReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    timelineReviewedAt: { type: Date, default: null },
    timelineReviewResolutionReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    timelineReviewHistory: {
      type: [timelineReviewEntrySchema],
      default: [],
    },
  },
  { timestamps: true },
);

vehicleServiceSchema.index({
  vehicleId: 1,
  serviceOdometerKm: -1,
  serviceDate: -1,
  createdAt: -1,
  _id: -1,
});
vehicleServiceSchema.index({ vehicleId: 1, serviceType: 1, serviceDate: -1 });

const VehicleService = mongoose.model("VehicleService", vehicleServiceSchema);

export default VehicleService;
