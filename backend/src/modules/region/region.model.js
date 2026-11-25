import mongoose from "mongoose";

const regionSchema = new mongoose.Schema(
  {
    bankId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bank",
      required: function () {
        return this.geographyStatus === "MAPPED";
      },
      index: true,
    },
    geographyStatus: {
      type: String,
      enum: ["MAPPED", "UNMAPPED"],
      default: "UNMAPPED",
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    code: {
      type: String,
      trim: true,
      uppercase: true,
    },

    description: {
      type: String,
      trim: true,
      default: "",
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

regionSchema.index(
  { bankId: 1, name: 1 },
  { unique: true, partialFilterExpression: { bankId: { $type: "objectId" } } },
);

// Codes are unique within a bank when supplied.
regionSchema.index(
  { bankId: 1, code: 1 },
  {
    unique: true,
    partialFilterExpression: {
      bankId: { $type: "objectId" },
      code: { $type: "string", $gt: "" },
    },
  },
);

const Region = mongoose.model("Region", regionSchema);

export default Region;
