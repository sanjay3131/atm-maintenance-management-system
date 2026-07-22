import mongoose from "mongoose";

const districtSchema = new mongoose.Schema(
  {
    districtName: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    pinCode: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    state: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
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

districtSchema.index({ districtName: 1 });

districtSchema.index({ pinCode: 1 });

const District = mongoose.model("District", districtSchema);

export default District;
