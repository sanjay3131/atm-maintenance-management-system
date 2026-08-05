import mongoose from "mongoose";

const jobHistorySchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: [
        "created",
        "assigned",
        "status_changed",
        "photo_uploaded",
        "gps_validated",
        "reassigned",
        "verified",
        "approved",
        "rejected",
        "closed",
        "note_added",
      ],
      required: true,
    },
    fromStatus: {
      type: String,
    },
    toStatus: {
      type: String,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    performedAt: {
      type: Date,
      default: Date.now,
    },
    details: {
      type: mongoose.Schema.Types.Mixed, // Flexible object for context
      default: {},
    },
    ipAddress: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

jobHistorySchema.index({ jobId: 1, performedAt: -1 });

const JobHistory = mongoose.model("JobHistory", jobHistorySchema);

export default JobHistory;
