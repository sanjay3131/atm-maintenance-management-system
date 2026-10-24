import mongoose from "mongoose";
import { isValidAttendanceDate } from "./attendance.validation.js";

const ATTENDANCE_SOURCES = ["employee", "supervisor", "admin", "superAdmin"];
const SUPERVISOR_OPEN_ATTENDANCE_INDEX = "supervisorUserId_1_open_session";

const attendanceSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: undefined,
    },
    supervisorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: undefined,
    },
    // Business-local check-in date; timestamps themselves are stored as UTC Dates.
    attendanceDate: {
      type: String,
      required: true,
      validate: {
        validator: isValidAttendanceDate,
        message: "attendanceDate must be a valid YYYY-MM-DD calendar date",
      },
    },
    checkInAt: {
      type: Date,
      required: true,
    },
    checkOutAt: {
      type: Date,
      default: null,
      validate: {
        validator(value) {
          if (value == null) return true;
          const checkInAt =
            this instanceof mongoose.Query
              ? (this.getUpdate()?.$set?.checkInAt ??
                this.getQuery()?.checkInAt?.$lte ??
                this.getQuery()?.checkInAt)
              : this.checkInAt;
          return checkInAt != null && value >= checkInAt;
        },
        message: "checkOutAt must not be earlier than checkInAt",
      },
    },
    checkInRecordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    checkOutRecordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    checkInSource: {
      type: String,
      enum: ATTENDANCE_SOURCES,
      required: true,
    },
    checkOutSource: {
      type: String,
      enum: ATTENDANCE_SOURCES,
      default: null,
    },
  },
  { timestamps: true },
);

// Each employee or supervisor may have at most one record per business date.
attendanceSchema.index(
  { employeeId: 1, attendanceDate: 1 },
  {
    name: "employeeId_1_attendanceDate_1_partial",
    unique: true,
    partialFilterExpression: { employeeId: { $type: "objectId" } },
  },
);
attendanceSchema.index(
  { supervisorUserId: 1, attendanceDate: 1 },
  {
    unique: true,
    partialFilterExpression: { supervisorUserId: { $type: "objectId" } },
  },
);
attendanceSchema.index(
  { supervisorUserId: 1 },
  {
    name: SUPERVISOR_OPEN_ATTENDANCE_INDEX,
    unique: true,
    partialFilterExpression: {
      supervisorUserId: { $type: "objectId" },
      checkOutAt: null,
    },
  },
);
attendanceSchema.index({ attendanceDate: 1 });

attendanceSchema.pre("validate", function validateAttendanceIdentity() {
  const hasEmployee = this.employeeId != null;
  const hasSupervisor = this.supervisorUserId != null;
  if (hasEmployee === hasSupervisor) {
    this.invalidate(
      "employeeId",
      "Exactly one employeeId or supervisorUserId must be set",
    );
  }
});

attendanceSchema.pre("validate", function validateCheckoutFields() {
  const hasCheckOutAt = this.checkOutAt != null;
  const hasCheckOutRecorder = this.checkOutRecordedBy != null;
  const hasCheckOutSource = this.checkOutSource != null;

  if (
    hasCheckOutAt !== hasCheckOutRecorder ||
    hasCheckOutAt !== hasCheckOutSource
  ) {
    this.invalidate(
      "checkOutAt",
      "checkOutAt, checkOutRecordedBy, and checkOutSource must be set together",
    );
  }
});

const Attendance = mongoose.model("Attendance", attendanceSchema);

export default Attendance;
