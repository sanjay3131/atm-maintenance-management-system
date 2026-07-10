import mongoose from "mongoose";

const jobsSchema = new mongoose.Schema(
  {
    jobNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    complaintId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Complaint",
    },
    atmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ATM",
      required: true,
    },
    assignedEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    jobType: {
      type: String,
      enum: [
        "COMPLAINT",
        "PREVENTIVE_MAINTENANCE",
        "CASH_LOADING_SUPPORT",
        "INSPECTION",
        "INSTALLATION",
        "OTHER",
      ],
      required: true,
    },
    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "MEDIUM",
    },
    status: {
      type: String,
      enum: [
        "CREATED",
        "ASSIGNED",
        "ACCEPTED",
        "IN_PROGRESS",
        "ON_HOLD",
        "COMPLETED",
        "VERIFIED",
        "REJECTED",
        "CANCELLED",
      ],
      default: "CREATED",
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    scheduledDate: {
      type: Date,
    },
    assignedAt: {
      type: Date,
    },
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    verifiedAt: {
      type: Date,
    },
    adminRemarks: {
      type: String,
      trim: true,
    },
    employeeRemarks: {
      type: String,
      trim: true,
    },
    isGpsVerified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

jobsSchema.index({ jobNumber: 1 });

jobsSchema.index({ status: 1 });

const Job = mongoose.model("Job", jobsSchema);

export default Job;
