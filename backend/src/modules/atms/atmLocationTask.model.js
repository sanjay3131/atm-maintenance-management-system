import mongoose from "mongoose";

const assignmentHistorySchema = new mongoose.Schema(
  {
    previousEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    newEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    actedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    assignedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    reason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { _id: false },
);

const atmLocationTaskSchema = new mongoose.Schema(
  {
    atmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ATM",
      required: true,
    },
    assignedEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    taskType: {
      type: String,
      enum: ["INITIAL_COLLECTION", "LOCATION_CORRECTION"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "ASSIGNED",
        "IN_PROGRESS",
        "ON_HOLD",
        "PENDING_REVIEW",
        "REJECTED",
        "COMPLETED",
        "CANCELLED",
      ],
      required: true,
      default: "ASSIGNED",
    },
    active: {
      type: Boolean,
      required: true,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    correctionReason: {
      type: String,
      trim: true,
      default: null,
    },
    locationRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ATMLocationRequest",
      default: null,
    },
    assignmentHistory: {
      type: [assignmentHistorySchema],
      default: [],
    },
    completedAt: {
      type: Date,
      default: null,
    },
    heldAt: {
      type: Date,
      default: null,
    },
    heldBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    resumedAt: {
      type: Date,
      default: null,
    },
    resumedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancellationReason: {
      type: String,
      trim: true,
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

atmLocationTaskSchema.index(
  { atmId: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
atmLocationTaskSchema.index({ assignedEmployeeId: 1, status: 1, createdAt: -1 });
atmLocationTaskSchema.index({ status: 1, createdAt: -1 });

const ATMLocationTask = mongoose.model(
  "ATMLocationTask",
  atmLocationTaskSchema,
);

export default ATMLocationTask;
