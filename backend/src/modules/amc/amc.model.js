import mongoose from "mongoose";
import { AMC_STATUS } from "../../utils/amcChecklist.js";

const amcSchema = new mongoose.Schema(
  {
    amcId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    atmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ATM",
      required: true,
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    supervisorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    bankId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bank",
      default: null,
    },
    districtId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
      default: null,
    },

    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
      index: true,
    },
    year: {
      type: Number,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: Object.values(AMC_STATUS),
      default: AMC_STATUS.PENDING,
      index: true,
    },

    deadlineDate: {
      type: Date,
      required: true,
    },

    // Visit data
    visitDate: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },

    // GPS at visit
    visitGps: {
      latitude: Number,
      longitude: Number,
      accuracy: Number,
    },
    gpsDistance: {
      type: Number,
      default: null,
    },
    gpsValidated: {
      type: Boolean,
      default: false,
    },

    // Checklist
    checklist: [
      {
        item: { type: String, required: true },
        response: { type: String, required: true },
        remarks: { type: String, trim: true, default: "" },
      },
    ],
    checklistCompleted: {
      type: Boolean,
      default: false,
    },

    // Photos
    photos: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AMCPhoto",
      },
    ],
    photoCount: {
      type: Number,
      default: 0,
    },

    // Audit
    generatedAt: {
      type: Date,
      default: Date.now,
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
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Critical unique index — prevents duplicate AMC per ATM per month
amcSchema.index({ atmId: 1, month: 1, year: 1 }, { unique: true });

// Performance indexes
amcSchema.index({ employeeId: 1, status: 1 });
amcSchema.index({ employeeId: 1, month: 1, year: 1 });
amcSchema.index({ status: 1, deadlineDate: 1 });
amcSchema.index({ supervisorId: 1, status: 1 });
amcSchema.index({ customerId: 1, status: 1 });
amcSchema.index({ bankId: 1, status: 1 });
amcSchema.index({ districtId: 1, status: 1 });
amcSchema.index({ isDeleted: 1 });

const AMC = mongoose.model("AMC", amcSchema);

export default AMC;
