import mongoose from "mongoose";

const CLIENT_PHOTO_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ASSET_STATES = [
  "unknown",
  "uploading",
  "uploaded",
  "verified",
  "adopted",
  "mismatch",
  "reconciliation_required",
  "quarantined",
  "orphaned",
  "deleted",
];
const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

const isNonNegativeInteger = (value) =>
  Number.isInteger(value) && value >= 0;

const isPositiveInteger = (value) =>
  Number.isInteger(value) && value >= 1;

const jobPhotoUploadAssetSchema = new mongoose.Schema(
  {
    intentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JobPhotoUploadIntent",
      required: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
    },
    clientPhotoId: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (value) => CLIENT_PHOTO_ID_PATTERN.test(value),
        message: "clientPhotoId must be a valid UUID",
      },
    },
    photoType: {
      type: String,
      enum: ["before", "after"],
      required: true,
    },
    ownerVersion: {
      type: Number,
      required: true,
      validate: {
        validator: isPositiveInteger,
        message: "ownerVersion must be a positive integer",
      },
    },
    publicId: {
      type: String,
      required: true,
      trim: true,
    },
    assetId: {
      type: String,
      trim: true,
      default: null,
    },
    resourceType: {
      type: String,
      required: true,
      default: "image",
    },
    format: {
      type: String,
      trim: true,
      default: null,
    },
    secureUrl: {
      type: String,
      trim: true,
      default: null,
    },
    cloudinaryBytes: {
      type: Number,
      default: null,
      validate: {
        validator: (value) =>
          value === null || isNonNegativeInteger(value),
        message: "cloudinaryBytes must be a non-negative integer",
      },
    },
    expectedSha256: {
      type: String,
      required: true,
      validate: {
        validator: (value) => SHA256_PATTERN.test(value),
        message: "expectedSha256 must be a lowercase SHA-256 hex string",
      },
    },
    verifiedSha256: {
      type: String,
      default: null,
      validate: {
        validator: (value) => value === null || SHA256_PATTERN.test(value),
        message: "verifiedSha256 must be a lowercase SHA-256 hex string",
      },
    },
    verifiedMimeType: {
      type: String,
      enum: [...SUPPORTED_IMAGE_MIME_TYPES, null],
      default: null,
    },
    state: {
      type: String,
      enum: ASSET_STATES,
      required: true,
    },
    adoptedJobPhotoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JobPhoto",
    },
    uploadedAt: {
      type: Date,
      default: null,
    },
    claimStartedAt: {
      type: Date,
      default: null,
    },
    claimTokenHash: {
      type: String,
      trim: true,
      select: false,
      default: null,
      validate: {
        validator: (value) => value === null || SHA256_PATTERN.test(value),
        message: "claimTokenHash must be a lowercase SHA-256 hex string",
      },
    },
    claimExpiresAt: {
      type: Date,
      default: null,
    },
    failureCode: {
      type: String,
      trim: true,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    adoptedAt: {
      type: Date,
      default: null,
    },
    orphanedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

jobPhotoUploadAssetSchema.index(
  { intentId: 1, ownerVersion: 1 },
  {
    unique: true,
    name: "job_photo_upload_asset_intent_version",
  },
);
jobPhotoUploadAssetSchema.index(
  { publicId: 1 },
  {
    unique: true,
    name: "job_photo_upload_asset_public_id",
  },
);
jobPhotoUploadAssetSchema.index(
  { intentId: 1, state: 1 },
  {
    name: "job_photo_upload_asset_intent_state",
  },
);
jobPhotoUploadAssetSchema.index(
  { state: 1, createdAt: 1 },
  {
    name: "job_photo_upload_asset_reconciliation",
  },
);

const JobPhotoUploadAsset = mongoose.model(
  "JobPhotoUploadAsset",
  jobPhotoUploadAssetSchema,
);

export { ASSET_STATES, SHA256_PATTERN };
export default JobPhotoUploadAsset;
