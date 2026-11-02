import mongoose from "mongoose";

const moneyStringValidator = {
  validator: (value) => /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value),
  message: "Money values must be non-negative decimal strings with at most two places",
};

const nullableDate = {
  type: Date,
  default: null,
};

const createReportOverrideSchema = (valueType) =>
  new mongoose.Schema(
  {
    value: {
      type: valueType,
      default: null,
    },
    isOverridden: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { _id: false, strict: true },
  );

const stringOverrideSchema = createReportOverrideSchema(String);
const dateOverrideSchema = createReportOverrideSchema(Date);

const jobSnapshotSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, trim: true },
    jobNumber: { type: String, default: null, trim: true },
    complaintNumber: { type: String, default: null, trim: true },
    callLogDate: nullableDate,
    bankName: { type: String, default: null, trim: true },
    branch: { type: String, default: null, trim: true },
    atmId: { type: String, default: null, trim: true },
    atmLocationName: { type: String, default: null, trim: true },
    atmAddress: { type: String, default: null, trim: true },
    complaintDescription: { type: String, default: null, trim: true },
    currentStatus: { type: String, default: null, trim: true },
    assignedTechnicianName: { type: String, default: null, trim: true },
    assignedEmployeeCode: { type: String, default: null, trim: true },
    workType: { type: String, default: null, trim: true },
    completionDate: nullableDate,
    employeeRemarks: { type: String, default: null, trim: true },
  },
  { _id: false, strict: true },
);

const reportFieldsSchema = new mongoose.Schema(
  {
    serviceLaborCost: {
      type: String,
      required: true,
      default: "0.00",
      validate: moneyStringValidator,
    },
    gstRate: {
      type: String,
      required: true,
      default: "18.00",
      validate: moneyStringValidator,
    },
    bankPurchaseOrderNumber: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },
    taxInvoiceNumber: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },
    filingPeriod: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },
    officeBillingStatus: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },
    overrides: {
      bankName: { type: stringOverrideSchema, default: () => ({}) },
      branch: { type: stringOverrideSchema, default: () => ({}) },
      complaintDescription: {
        type: stringOverrideSchema,
        default: () => ({}),
      },
      callLogDate: { type: dateOverrideSchema, default: () => ({}) },
      atmLocationName: { type: stringOverrideSchema, default: () => ({}) },
      atmAddress: { type: stringOverrideSchema, default: () => ({}) },
      assignedTechnicianName: {
        type: stringOverrideSchema,
        default: () => ({}),
      },
      workType: { type: stringOverrideSchema, default: () => ({}) },
    },
  },
  { _id: false, strict: true },
);

const serviceVisitSchema = new mongoose.Schema(
  {
    sequence: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Visit sequence must be an integer",
      },
    },
    visitDate: nullableDate,
    workPerformed: {
      type: String,
      default: null,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      default: null,
      trim: true,
      maxlength: 100,
    },
    signOffOrPhotoReference: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },
  },
  { strict: true },
);

const materialSnapshotSchema = new mongoose.Schema(
  {
    usageId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    itemNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    unitSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    unitCostSnapshot: {
      type: String,
      required: true,
      validate: moneyStringValidator,
    },
    lineCostSnapshot: {
      type: String,
      required: true,
      validate: moneyStringValidator,
    },
    capturedAt: {
      type: Date,
      required: true,
    },
  },
  { strict: true },
);

const materialRevisionSchema = new mongoose.Schema(
  {
    value: {
      type: Number,
      default: null,
      min: 0,
    },
    isKnown: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { _id: false, strict: true },
);

materialRevisionSchema.path("value").validate({
  validator(value) {
    if (!this.isKnown) return value === null;
    return Number.isInteger(value) && value >= 0;
  },
  message: "Material revision value must match isKnown",
});

const materialSnapshotStatusSchema = {
  type: String,
  enum: ["NOT_REFRESHED", "REFRESHED"],
  required: true,
  default: "NOT_REFRESHED",
};

const jobCostReportSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      unique: true,
      index: true,
    },
    draftRevision: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: ["DRAFT"],
      required: true,
      default: "DRAFT",
    },
    jobSnapshot: {
      type: jobSnapshotSchema,
      required: true,
    },
    reportFields: {
      type: reportFieldsSchema,
      required: true,
      default: () => ({}),
    },
    serviceVisits: {
      type: [serviceVisitSchema],
      default: [],
      validate: {
        validator: (visits) => {
          const sequences = visits.map(({ sequence }) => sequence);
          return new Set(sequences).size === sequences.length;
        },
        message: "Service visit sequences must be unique",
      },
    },
    materialSnapshot: {
      type: [materialSnapshotSchema],
      default: [],
    },
    materialSnapshotStatus: materialSnapshotStatusSchema,
    materialSnapshotRevision: {
      type: materialRevisionSchema,
      required: true,
      default: () => ({}),
    },
    sourceRevisions: {
      materialUsageRevision: {
        type: materialRevisionSchema,
        required: true,
        default: () => ({}),
      },
      jobUpdatedAt: nullableDate,
      complaintUpdatedAt: nullableDate,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true, strict: true },
);

const JobCostReport = mongoose.model("JobCostReport", jobCostReportSchema);

export default JobCostReport;
