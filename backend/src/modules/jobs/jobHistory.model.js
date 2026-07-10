import mongoose from "mongoose";

const jobHistorySchema = new mongoose.Schema(
  {
    //     jobId ObjectId
    // action String
    // oldValue String
    // newValue String
    // performedBy ObjectId
    // remarks String
    // createdAt Date

    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    oldValue: {
      type: String,
    },
    newValue: {
      type: String,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    remarks: {
      type: String,
    },
  },
  { timestamps: true },
);

const JobHistory = mongoose.model("JobHistory", jobHistorySchema);

export default JobHistory;
