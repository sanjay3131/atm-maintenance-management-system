import mongoose from "mongoose";

const jobMaterialUsageSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      immutable: true,
      index: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: true,
      immutable: true,
    },
    itemNameSnapshot: {
      type: String,
      required: true,
      immutable: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [Number.MIN_VALUE, "Quantity must be greater than zero"],
      immutable: true,
    },
    unitSnapshot: {
      type: String,
      required: true,
      immutable: true,
    },
    unitCostSnapshot: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
    },
    lineCostSnapshot: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
  },
  { timestamps: true },
);

jobMaterialUsageSchema.index({ jobId: 1, createdAt: 1, _id: 1 });

const JobMaterialUsage = mongoose.model(
  "JobMaterialUsage",
  jobMaterialUsageSchema,
);

export default JobMaterialUsage;
