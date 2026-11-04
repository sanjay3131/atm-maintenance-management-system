import mongoose from "mongoose";
import { isValidAttendanceDate } from "../attendance/attendance.validation.js";

const publicHolidaySchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
      validate: {
        validator: isValidAttendanceDate,
        message: "date must be a valid YYYY-MM-DD calendar date",
      },
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

publicHolidaySchema.index(
  { date: 1 },
  { name: "public_holiday_date_unique", unique: true },
);

const PublicHoliday = mongoose.model("PublicHoliday", publicHolidaySchema);

export default PublicHoliday;
