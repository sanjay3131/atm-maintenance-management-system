import mongoose from "mongoose";

const complaintsSchema = new mongoose.Schema(
  {
    // complaintNumber String
    // atmId ObjectId
    // reportedBy ObjectId
    // title String
    // description String
    // priority [LOW,MEDIUM,HIGH,CRITICAL]
    // status [OPEN,ASSIGNED,CLOSED,CANCELLED]
    // reportedAt Date
    // createdBy ObjectId
    // updatedBy ObjectId
    // createdAt Date
    // updatedAt Date

    complaintNumber: {
      type: String,
      required: true,
      unique: true,
    },
    atmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ATM",
      required: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "MEDIUM",
    },
    status: {
      type: String,
      enum: ["OPEN", "ASSIGNED", "CLOSED", "CANCELLED"],
      default: "OPEN",
    },
    reportedAt: {
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
    },
  },
  {
    timestamps: true,
  },
);

const Complaint = mongoose.model("Complaint", complaintsSchema);

export default Complaint;
