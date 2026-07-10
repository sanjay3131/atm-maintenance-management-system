import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    //     userId ObjectId
    // jobId ObjectId (nullable)
    // complaintId ObjectId (nullable)
    // title String
    // message String
    // type [JOB_ASSIGNED,JOB_COMPLETED,JOB_VERIFIED,JOB_REJECTED,COMPLAINT_CREATED,SYSTEM]
    // isRead Boolean
    // readAt Date
    // createdAt Date

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
    },
    complaintId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Complaint",
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: [
        "JOB_ASSIGNED",
        "JOB_COMPLETED",
        "JOB_VERIFIED",
        "JOB_REJECTED",
        "COMPLAINT_CREATED",
        "SYSTEM",
      ],
      required: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

const Notification = mongoose.model("Notification", notificationSchema);
