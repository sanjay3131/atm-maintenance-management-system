import mongoose from "mongoose";

const completedImportResultSchema = new mongoose.Schema(
  {
    totalRows: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
    createdCount: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
  },
  { _id: false },
);

const atmBulkUploadImportSchema = new mongoose.Schema(
  {
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    idempotencyKeyHash: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-f0-9]{64}$/,
    },
    workbookSha256: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-f0-9]{64}$/,
    },
    result: {
      type: completedImportResultSchema,
      required: true,
    },
  },
  {
    collection: "atm_bulk_upload_imports",
    timestamps: true,
    versionKey: false,
  },
);

atmBulkUploadImportSchema.index(
  { actorId: 1, idempotencyKeyHash: 1 },
  {
    unique: true,
    name: "uniq_atm_bulk_upload_actor_idempotency_key",
  },
);

const ATMBulkUploadImport = mongoose.model(
  "ATMBulkUploadImport",
  atmBulkUploadImportSchema,
);

export default ATMBulkUploadImport;
