import mongoose from "mongoose";

const roleSchema = new mongoose.Schema(
  {
    roleName: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    permission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Permission",
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

const Role = mongoose.model("Role", roleSchema);

export default Role;
