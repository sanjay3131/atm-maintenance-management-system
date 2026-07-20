import mongoose from "mongoose";

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

employeeSchema.index({ userId: 1 });

employeeSchema.index({ status: 1 });

const Employee = mongoose.model("Employee", employeeSchema);

export default Employee;
