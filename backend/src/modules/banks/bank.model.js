import mongoose from "mongoose";

const bankSchema = new mongoose.Schema(
  {
    bankName: {
      type: String,
      required: [true, "Bank name is required"],
      trim: true,
      unique: true,
    },
    bankCode: {
      type: String,
      required: [true, "Bank code is required"],
      trim: true,
      unique: true,
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

// Indexes
bankSchema.index({ bankName: 1 });
bankSchema.index({ bankCode: 1 }, { unique: true });
bankSchema.index({ isActive: 1 });

const Bank = mongoose.model("Bank", bankSchema);

export default Bank;
