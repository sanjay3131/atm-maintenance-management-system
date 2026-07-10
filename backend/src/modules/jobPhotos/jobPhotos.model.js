import mongoose from "mongoose";

const jobPhotosSchema = new mongoose.Schema(
  {
    // jobId ObjectId
    // uploadedBy ObjectId
    // photoType [BEFORE,AFTER,OTHER]
    // imageUrl String
    // publicId String
    // caption String
    // latitude Number
    // longitude Number
    // capturedAt Date
    // uploadedAt Date
    // createdAt Date
    // updatedAt Date

    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    photoType: {
      type: String,
      enum: ["BEFORE", "AFTER", "OTHER"],
      required: true,
    },
    imageUrl: {
      type: String,
      required: true,
    },
    publicId: {
      type: String,
      required: true,
    },
    caption: {
      type: String,
      trim: true,
    },
    latitude: {
      type: Number,
    },
    longitude: {
      type: Number,
    },
    capturedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

const JobPhoto = mongoose.model("JobPhoto", jobPhotosSchema);

export default JobPhoto;
