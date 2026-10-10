import mongoose from "mongoose";
import { isValidAttendanceDate } from "./attendance.validation.js";

const attendanceEntryAuditSchema = new mongoose.Schema(
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
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      minlength: 1,
      maxlength: 1000,
      default: null,
    },
    enteredValues: {
      checkInAt: {
        type: Date,
        required: true,
      },
      checkOutAt: {
        type: Date,
        default: null,
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
    recordedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { timestamps: true },
);

attendanceEntryAuditSchema.index({ attendanceId: 1, recordedAt: -1 });
attendanceEntryAuditSchema.index({ employeeId: 1, recordedAt: -1 });

const AttendanceEntryAudit = mongoose.model(
  "AttendanceEntryAudit",
  attendanceEntryAuditSchema,
);

export default AttendanceEntryAudit;
