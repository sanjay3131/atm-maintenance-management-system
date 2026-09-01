import mongoose from "mongoose";

const atmSchema = new mongoose.Schema(
  {
    atmId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    bankId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bank",
      required: true,
    },

    districtId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
      required: true,
    },

    regionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
      default: null,
    },

    locationName: {
      type: String,
      required: true,
      trim: true,
    },

    address: {
      type: String,
      required: true,
      trim: true,
    },

    installationType: {
      type: String,
      enum: ["ONSITE", "OFFSITE"],
      required: true,
    },

    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: false,
        default: null,
      },
    },

    // GPS capture metadata
    locationConfigured: {
      type: Boolean,
      default: false,
      index: true,
    },
    locationCapturedAt: {
      type: Date,
      default: null,
    },
    locationCapturedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    locationAccuracy: {
      type: Number,
      default: null,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "UNDER_MAINTENANCE", "REMOVED"],
      default: "ACTIVE",
    },

    assignedEmployeeId: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        default: null,
      },
    ],

    isDeleted: {
      type: Boolean,
      default: false,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
atmSchema.index({ atmId: 1 }, { unique: true });
atmSchema.index({ bankId: 1 });
atmSchema.index({ districtId: 1 });
atmSchema.index({ regionId: 1 });
atmSchema.index({ assignedEmployeeId: 1 });
atmSchema.index({ location: "2dsphere" });
atmSchema.index({ locationConfigured: 1 });

const ATM = mongoose.model("ATM", atmSchema);

export default ATM;
