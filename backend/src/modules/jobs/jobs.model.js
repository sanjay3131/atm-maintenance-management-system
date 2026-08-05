import mongoose from "mongoose";
import { JOB_STATUS } from "../../utils/jobStatus.js";

const jobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      unique: true,
      required: true,
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

    // Relationships
    atmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ATM",
      required: true,
      index: true,
    },
    complaintId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Complaint",
      index: true,
    },
    assignedEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    // Status
    status: {
      type: String,
      enum: Object.values(JOB_STATUS),
      default: JOB_STATUS.PENDING,
      index: true,
    },

    // Work Details
    workType: {
      type: String,
      enum: [
        "repair",
        "maintenance",
        "installation",
        "inspection",
        "emergency",
      ],
      default: "repair",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },

    // Timestamps
    createdAt: {
      type: Date,
      default: Date.now,
    },
    assignedAt: {
      type: Date,
    },
    acceptedAt: {
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
    approvedAt: {
      type: Date,
    },
    closedAt: {
      type: Date,
    },
    rejectedAt: {
      type: Date,
    },

    // GPS at completion
    employeeGpsAtCompletion: {
      latitude: Number,
      longitude: Number,
      accuracy: Number,
      timestamp: Date,
    },
    gpsDistance: {
      type: Number, // Distance in meters
    },
    gpsValidated: {
      type: Boolean,
      default: false,
    },

    // Remarks
    employeeRemarks: {
      type: String,
      trim: true,
    },
    adminRemarks: {
      type: String,
      trim: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },

    // Photos
    beforePhotos: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "JobPhoto",
      },
    ],
    afterPhotos: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "JobPhoto",
      },
    ],

    // Reassignment
    isReassigned: {
      type: Boolean,
      default: false,
    },
    previousJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
    },
    reassignmentReason: {
      type: String,
      trim: true,
    },
    reassignmentHistory: [
      {
        fromEmployee: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        toEmployee: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        reason: String,
        reassignedAt: {
          type: Date,
          default: Date.now,
        },
        reassignedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],

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
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
jobSchema.index({ status: 1, createdAt: -1 });
jobSchema.index({ assignedEmployeeId: 1, status: 1 });
jobSchema.index({ atmId: 1, createdAt: -1 });
jobSchema.index({ customerId: 1, status: 1 });
jobSchema.index({ isDeleted: 1 });

const Job = mongoose.model("Job", jobSchema);

export default Job;
