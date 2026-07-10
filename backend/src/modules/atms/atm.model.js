import mongoose from "mongoose";

const atmSchema = new mongoose.Schema(
  {
    //     atmId String
    // bankId ObjectId
    // districtId ObjectId
    // locationName String
    // address String
    // latitude Number
    // longitude Number
    // status [ACTIVE,INACTIVE,UNDER_MAINTENANCE,REMOVED]
    // installationType String
    // assignedEmployeeId ObjectId
    // createdBy ObjectId
    // updatedBy ObjectId
    // createdAt Date
    // updatedAt Date

    atmId: {
      type: String,
      required: true,
      unique: true,
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
    locationName: {
      type: String,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "UNDER_MAINTENANCE", "REMOVED"],
      default: "ACTIVE",
    },
    installationType: {
      type: String,
      required: true,
    },
    assignedEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
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
  },
  { timestamps: true },
);

const ATM = mongoose.model("ATM", atmSchema);

export default ATM;
