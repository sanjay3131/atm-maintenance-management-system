import mongoose from "mongoose";

const complaintsSchema = new mongoose.Schema(
  {
    complaintNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    atmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ATM",
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    reportedBy: {
      type: String,
      required: true,
      trim: true,
    },
    reportedVia: {
      type: String,
      enum: ["phone", "email", "whatsapp", "in_person", "other"],
      default: "phone",
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "MEDIUM",
      index: true,
    },
    status: {
      type: String,
      enum: [
        "OPEN",
        "ASSIGNED",
        "IN_PROGRESS",
        "RESOLVED",
        "CLOSED",
        "CANCELLED",
      ],
      default: "OPEN",
      index: true,
    },
    // Linked job
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      index: true,
    },
    // Resolution tracking
    resolvedAt: {
      type: Date,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    resolutionNotes: {
      type: String,
      trim: true,
    },
    closedAt: {
      type: Date,
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    closureReason: {
      type: String,
      trim: true,
    },
    reportedAt: {
      type: Date,
      default: Date.now,
    },
    // Soft delete
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Audit
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes for common queries
complaintsSchema.index({ status: 1, priority: 1 });
complaintsSchema.index({ atmId: 1, status: 1 });
complaintsSchema.index({ customerId: 1, status: 1 });
complaintsSchema.index({ createdAt: -1 });
complaintsSchema.index({ isDeleted: 1, status: 1 });

const Complaint = mongoose.model("Complaint", complaintsSchema);

export default Complaint;
