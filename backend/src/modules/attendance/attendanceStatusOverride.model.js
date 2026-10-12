import mongoose from "mongoose";
import { isValidAttendanceDate } from "./attendance.validation.js";

const attendanceStatusOverrideSchema = new mongoose.Schema(
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
    status: {
      type: String,
      enum: ["present", "absent"],
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    changedAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

attendanceStatusOverrideSchema.index(
  { employeeId: 1, attendanceDate: 1 },
  { unique: true },
);

const AttendanceStatusOverride = mongoose.model(
  "AttendanceStatusOverride",
  attendanceStatusOverrideSchema,
);

export default AttendanceStatusOverride;
