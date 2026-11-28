import mongoose from "mongoose";

const isCalendarDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
};

function validateCleanerDetails() {
  if (
    this.actualCleanerType === "OUTSOURCED" &&
    !this.outsourcedCleanerName?.trim()
  ) {
    this.invalidate(
      "outsourcedCleanerName",
      "An outsourced cleaner name is required",
    );
  }
  if (
    this.actualCleanerType === "INTERNAL" &&
    this.outsourcedCleanerName?.trim()
  ) {
    this.invalidate(
      "outsourcedCleanerName",
      "Outsourced cleaner name is only valid for outsourced cleaning",
    );
  }
}

const cleaningSubmissionSchema = new mongoose.Schema(
  {
    actualCleanerType: {
      type: String,
      enum: ["INTERNAL", "OUTSOURCED"],
      required: true,
    },
    actualCleanerEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    outsourcedCleanerName: {
      type: String,
      trim: true,
      maxlength: 160,
    },
    cleaningDate: {
      type: String,
      required: true,
      validate: {
        validator: isCalendarDate,
        message: "Cleaning date must be a valid YYYY-MM-DD date",
      },
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reportingMethod: {
      type: String,
      enum: ["EMPLOYEE", "ADMIN"],
      required: true,
    },
    submittedAt: {
      type: Date,
      required: true,
    },
    remarks: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    evidencePhotoIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "JobPhoto",
      },
    ],
  },
  { _id: false },
);
cleaningSubmissionSchema.pre("validate", validateCleanerDetails);

const cleaningRecordSchema = new mongoose.Schema(
  {
    recurringJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      immutable: true,
    },
    recurringPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RecurringMaintenancePlan",
      required: true,
      immutable: true,
    },
    occurrenceKey: {
      type: String,
      required: true,
      immutable: true,
    },
    atmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ATM",
      required: true,
      immutable: true,
    },
    responsibleEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    actualCleanerType: {
      type: String,
      enum: ["INTERNAL", "OUTSOURCED"],
      required: true,
    },
    actualCleanerEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    outsourcedCleanerName: {
      type: String,
      trim: true,
      maxlength: 160,
    },
    cleaningDate: {
      type: String,
      required: true,
      validate: {
        validator: isCalendarDate,
        message: "Cleaning date must be a valid YYYY-MM-DD date",
      },
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reportingMethod: {
      type: String,
      enum: ["EMPLOYEE", "ADMIN"],
      required: true,
    },
    submittedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    remarks: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    evidencePhotoIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "JobPhoto",
      },
    ],
    validityStatus: {
      type: String,
      enum: ["VALID", "VOID"],
      default: "VALID",
      required: true,
    },
    revision: {
      type: Number,
      min: 0,
      default: 0,
    },
    submissionHistory: {
      type: [cleaningSubmissionSchema],
      default: [],
    },
    correctionHistory: [
      {
        correctedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        correctedAt: {
          type: Date,
          required: true,
          default: Date.now,
        },
        reason: {
          type: String,
          required: true,
          trim: true,
          maxlength: 1000,
        },
        changes: [
          {
            field: { type: String, required: true, trim: true },
            previousValue: mongoose.Schema.Types.Mixed,
            correctedValue: mongoose.Schema.Types.Mixed,
          },
        ],
      },
    ],
  },
  { timestamps: true },
);
cleaningRecordSchema.pre("validate", validateCleanerDetails);

cleaningRecordSchema.index(
  { recurringJobId: 1 },
  { unique: true, name: "unique_cleaning_record_recurring_job" },
);
cleaningRecordSchema.index(
  { occurrenceKey: 1 },
  { unique: true, name: "unique_cleaning_record_occurrence" },
);
cleaningRecordSchema.index({
  recurringPlanId: 1,
  validityStatus: 1,
  cleaningDate: -1,
});
cleaningRecordSchema.index({ atmId: 1, validityStatus: 1, cleaningDate: -1 });
cleaningRecordSchema.index({
  responsibleEmployeeId: 1,
  cleaningDate: -1,
});

const CleaningRecord = mongoose.model("CleaningRecord", cleaningRecordSchema);

export default CleaningRecord;
