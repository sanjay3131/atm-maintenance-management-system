import mongoose from "mongoose";
import { EMPLOYEE_USER_ID_INDEX } from "./employeeUserIdIndex.js";

const employeeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    employeeCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    designation: {
      type: String,
      required: true,
      trim: true,
    },
    department: {
      type: String,
      required: true,
      trim: true,
    },
    joiningDate: {
      type: Date,
      required: true,
    },
    employmentType: {
      type: String,
      enum: ["full-time", "part-time", "contract"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "on_leave", "resigned"],
      default: "active",
    },
    districtIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "District",
      },
    ],
    assignedAtmIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ATM",
      },
    ],
    regionIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Region",
      },
    ],
    supervisorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    salary: {
      type: Number,
    },
  },
  {
    timestamps: true,
  },
);

// employeeSchema.index({ employeeCode: 1 });

employeeSchema.index(
  EMPLOYEE_USER_ID_INDEX.fields,
  EMPLOYEE_USER_ID_INDEX.options,
);

employeeSchema.index({ status: 1 });

employeeSchema.index({ supervisorId: 1 });

const Employee = mongoose.model("Employee", employeeSchema);

export default Employee;
