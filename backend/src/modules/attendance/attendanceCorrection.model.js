import mongoose from "mongoose";
import { isValidAttendanceDate } from "./attendance.validation.js";

const attendanceSnapshotSchema = new mongoose.Schema(
  {
    checkInAt: {
      type: Date,
      required: true,
    },
    checkOutAt: {
      type: Date,
      default: null,
      validate: {
        validator(value) {
          return value == null || value >= this.checkInAt;
        },
        message: "checkOutAt must not be earlier than checkInAt",
      },
    },
    attendanceDate: {
      type: String,
      required: true,
      validate: {
        validator: isValidAttendanceDate,
        message: "attendanceDate must be a valid YYYY-MM-DD calendar date",
      },
    },
  },
  { _id: false },
);

const attendanceCorrectionSchema = new mongoose.Schema(
  {
    attendanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendance",
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 1000,
    },
    originalValues: {
      type: attendanceSnapshotSchema,
      required: true,
    },
    revisedValues: {
      type: attendanceSnapshotSchema,
      required: true,
    },
    correctedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    correctedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { timestamps: true },
);

// Correction entries are append-only at the application/API level.
attendanceCorrectionSchema.index({ attendanceId: 1, correctedAt: -1 });

const AttendanceCorrection = mongoose.model(
  "AttendanceCorrection",
  attendanceCorrectionSchema,
);

export default AttendanceCorrection;
