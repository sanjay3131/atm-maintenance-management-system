import mongoose from "mongoose";

const jobPhotoSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },
    atmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ATM",
      required: true,
      index: true,
    },
    photoType: {
      type: String,
      enum: ["before", "after", "other"],
      required: true,
    },
    // Cloudinary fields
    publicId: {
      type: String,
      required: true,
      unique: true,
    },
    url: {
      type: String,
      required: true,
    },
    thumbnailUrl: {
      type: String,
    },
    originalName: {
      type: String,
    },
    size: {
      type: Number, // in bytes
    },
    mimeType: {
      type: String,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
      index: true, // Index for FIFO cleanup queries
    },
    // Auto-delete flag (set by cron when photo expires)
    isExpired: {
      type: Boolean,
      default: false,
    },
    expiredAt: {
      type: Date,
    },
    // GPS data from device (optional)
    gpsData: {
      latitude: Number,
      longitude: Number,
      accuracy: Number,
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes
jobPhotoSchema.index({ jobId: 1, photoType: 1 });
jobPhotoSchema.index({ atmId: 1, uploadedAt: 1 });
jobPhotoSchema.index({ uploadedAt: 1 }); // For FIFO cleanup

const JobPhoto = mongoose.model("JobPhoto", jobPhotoSchema);

export default JobPhoto;
