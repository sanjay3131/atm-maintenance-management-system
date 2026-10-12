import mongoose from "mongoose";
import { isValidAttendanceDate } from "./attendance.validation.js";

const previousEffectiveValuesSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["present", "absent", "incomplete", "unrecorded"],
      required: true,
    },
    checkInAt: {
      type: Date,
      default: null,
    },
    checkOutAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const newEffectiveValuesSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["present", "absent"],
      required: true,
    },
    checkInAt: {
      type: Date,
      default: null,
    },
    checkOutAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const attendanceStatusOverrideAuditSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    attendanceDate: {
      type: String,
      required: true,
      validate: {
        validator: isValidAttendanceDate,
        message: "attendanceDate must be a valid YYYY-MM-DD calendar date",
      },
    },
    previousEffectiveValues: {
      type: previousEffectiveValuesSchema,
      default: null,
    },
    newEffectiveValues: {
      type: newEffectiveValuesSchema,
      required: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    changedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 1000,
    },
  },
  { timestamps: true },
);

attendanceStatusOverrideAuditSchema.pre("save", function preventAuditRewrite() {
  if (!this.isNew) {
    throw new Error("Attendance status override audit events are append-only");
  }
});
attendanceStatusOverrideAuditSchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ],
  function preventAuditMutation() {
    throw new Error("Attendance status override audit events are append-only");
  },
);

attendanceStatusOverrideAuditSchema.index({
  employeeId: 1,
  attendanceDate: 1,
  changedAt: -1,
});

const AttendanceStatusOverrideAudit = mongoose.model(
  "AttendanceStatusOverrideAudit",
  attendanceStatusOverrideAuditSchema,
);

export default AttendanceStatusOverrideAudit;
