import mongoose from "mongoose";

const bankSchema = new mongoose.Schema(
  {
    bankName: {
      type: String,
      required: [true, "Bank name is required"],
      trim: true,
    },
    bankCode: {
      type: String,
      required: [true, "Bank code is required"],
      trim: true,
      uppercase: true,
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    contactPhone: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    geographyFence: { type: Number, default: 0, select: false },
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

bankSchema.index({ bankName: 1 }, { unique: true });
bankSchema.index({ bankCode: 1 }, { unique: true });
bankSchema.index({ isActive: 1 });

const Bank = mongoose.model("Bank", bankSchema);

export default Bank;
