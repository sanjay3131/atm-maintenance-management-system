import mongoose from "mongoose";

const officialLocationSnapshotSchema = new mongoose.Schema(
  {
    locationConfigured: {
      type: Boolean,
      required: true,
    },
    coordinates: {
      type: [Number],
      default: null,
    },
    locationCapturedAt: {
      type: Date,
      default: null,
    },
    locationCapturedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { _id: false },
);

const atmLocationRequestSchema = new mongoose.Schema(
  {
    atmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ATM",
      required: true,
    },
    requestType: {
      type: String,
      enum: ["INITIAL_CONFIGURATION", "LOCATION_CHANGE"],
      required: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requesterRole: {
      type: String,
      enum: ["employee", "admin", "superAdmin"],
      required: true,
    },
    requesterEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    amcId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AMC",
      default: null,
    },
    proposedLatitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    proposedLongitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    accuracy: {
      type: Number,
      default: null,
      min: 0,
      max: 50,
    },
    inputSource: {
      type: String,
      enum: ["GPS", "MANUAL"],
      required: true,
    },
    submittedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    officialLocationSnapshot: {
      type: officialLocationSnapshotSchema,
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      required: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { timestamps: true },
);

atmLocationRequestSchema.index(
  { atmId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "PENDING" },
  },
);
atmLocationRequestSchema.index({ status: 1, submittedAt: -1 });

const ATMLocationRequest = mongoose.model(
  "ATMLocationRequest",
  atmLocationRequestSchema,
);

export default ATMLocationRequest;
