import mongoose from "mongoose";

const isExpiredPhoto = function () {
  if (this instanceof mongoose.Query) {
    const update = this.getUpdate() ?? {};
    const updatedFields = {
      ...update,
      ...(update.$setOnInsert ?? {}),
      ...(update.$set ?? {}),
    };
    return updatedFields.isExpired === true;
  }

  return this.isExpired === true;
};

const amcPhotoSchema = new mongoose.Schema(
  {
    amcId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AMC",
      required: true,
      index: true,
    },
    atmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ATM",
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    url: {
      type: String,
      required: function () {
        return !isExpiredPhoto.call(this);
      },
    },
    thumbnailUrl: {
      type: String,
      required: function () {
        return !isExpiredPhoto.call(this);
      },
    },
    publicId: {
      type: String,
      required: true,
    },
    originalName: {
      type: String,
      trim: true,
    },
    size: {
      type: Number,
      default: 0,
    },
    mimeType: {
      type: String,
      default: "image/jpeg",
    },

    gpsData: {
      latitude: Number,
      longitude: Number,
      accuracy: Number,
    },

    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    isExpired: {
      type: Boolean,
      default: false,
    },
    expiredAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
amcPhotoSchema.index({ amcId: 1, isExpired: 1 });
amcPhotoSchema.index({ atmId: 1 });
amcPhotoSchema.index({ uploadedBy: 1 });

const AMCPhoto = mongoose.model("AMCPhoto", amcPhotoSchema);

export default AMCPhoto;
