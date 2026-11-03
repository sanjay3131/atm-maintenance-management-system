import mongoose from "mongoose";

const CLIENT_PHOTO_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];
const INTENT_STATES = [
  "reserved",
  "uploading",
  "uploaded",
  "finalized",
  "failed",
  "quarantined",
];

const isNonNegativeInteger = (value) =>
  Number.isInteger(value) && value >= 0;

const isPositiveInteger = (value) =>
  Number.isInteger(value) && value >= 1;

const jobPhotoUploadIntentSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      immutable: true,
    },
    clientPhotoId: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
      validate: {
        validator: (value) => CLIENT_PHOTO_ID_PATTERN.test(value),
        message: "clientPhotoId must be a valid UUID",
      },
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    currentOwnerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    photoType: {
      type: String,
      enum: ["before", "after"],
      required: true,
      immutable: true,
    },
    contentSha256: {
      type: String,
      required: true,
      immutable: true,
      validate: {
        validator: (value) => SHA256_PATTERN.test(value),
        message: "contentSha256 must be a lowercase SHA-256 hex string",
      },
    },
    byteSize: {
      type: Number,
      required: true,
      immutable: true,
      validate: {
        validator: isNonNegativeInteger,
        message: "byteSize must be a non-negative integer",
      },
    },
    verifiedMimeType: {
      type: String,
      enum: SUPPORTED_IMAGE_MIME_TYPES,
      required: true,
      immutable: true,
    },
    originalName: {
      type: String,
      trim: true,
      immutable: true,
    },
    state: {
      type: String,
      enum: INTENT_STATES,
      required: true,
    },
    ownerTokenHash: {
      type: String,
      required: true,
      select: false,
      validate: {
        validator: (value) => SHA256_PATTERN.test(value),
        message: "ownerTokenHash must be a lowercase SHA-256 hex string",
      },
    },
    ownerVersion: {
      type: Number,
      required: true,
      validate: {
        validator: isPositiveInteger,
        message: "ownerVersion must be a positive integer",
      },
    },
    assetClaimFenceVersion: {
      type: Number,
      min: 0,
      default: 0,
      select: false,
      validate: {
        validator: isNonNegativeInteger,
        message: "assetClaimFenceVersion must be a non-negative integer",
      },
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
    },
    uploadedAt: {
      type: Date,
      default: null,
    },
    retentionExpiresAt: {
      type: Date,
      default: null,
    },
    finalizedJobPhotoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JobPhoto",
      default: null,
    },
    finalizedAssetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JobPhotoUploadAsset",
      default: null,
    },
    finalizedOwnerVersion: {
      type: Number,
      default: null,
      validate: {
        validator: (value) => value === null || isPositiveInteger(value),
        message: "finalizedOwnerVersion must be a positive integer",
      },
    },
    failureCode: {
      type: String,
      trim: true,
      default: null,
    },
    failureMessage: {
      type: String,
      trim: true,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    quarantinedAt: {
      type: Date,
      default: null,
    },
    finalizedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

jobPhotoUploadIntentSchema.index(
  { jobId: 1, clientPhotoId: 1 },
  {
    unique: true,
    name: "job_photo_upload_intent_identity",
  },
);
jobPhotoUploadIntentSchema.index(
  { state: 1, leaseExpiresAt: 1 },
  {
    name: "job_photo_upload_intent_lease_recovery",
  },
);

const JobPhotoUploadIntent = mongoose.model(
  "JobPhotoUploadIntent",
  jobPhotoUploadIntentSchema,
);

export {
  CLIENT_PHOTO_ID_PATTERN,
  INTENT_STATES,
  SHA256_PATTERN,
  SUPPORTED_IMAGE_MIME_TYPES,
};
export default JobPhotoUploadIntent;
