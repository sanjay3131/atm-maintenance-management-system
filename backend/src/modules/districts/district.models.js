import mongoose from "mongoose";

const districtSchema = new mongoose.Schema(
  {
    regionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
      required: function () {
        return this.geographyStatus === "MAPPED";
      },
      index: true,
    },
    bankId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bank",
      required: function () {
        return this.geographyStatus === "MAPPED";
      },
    },
    geographyStatus: {
      type: String,
      enum: ["MAPPED", "UNMAPPED"],
      default: "UNMAPPED",
    },
    districtName: {
      type: String,
      required: true,
      trim: true,
    },
    districtNameNormalized: {
      type: String,
      required: function () {
        return this.geographyStatus === "MAPPED";
      },
      minlength: 1,
    },
    pinCode: {
      type: String,
      required: true,
      trim: true,
    },
    pinCodeNormalized: {
      type: String,
      required: function () {
        return this.geographyStatus === "MAPPED";
      },
      minlength: 1,
    },
    state: {
      type: String,
      required: true,
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
    autoIndex: false,
  },
);

districtSchema.index(
  { districtName: 1 },
  { name: "districtName_1" },
);

districtSchema.index(
  { bankId: 1, districtNameNormalized: 1 },
  {
    unique: true,
    name: "uniq_district_bank_name_normalized",
    partialFilterExpression: { geographyStatus: "MAPPED" },
  },
);
districtSchema.index(
  { bankId: 1, pinCodeNormalized: 1 },
  {
    unique: true,
    name: "uniq_district_bank_pin_normalized",
    partialFilterExpression: { geographyStatus: "MAPPED" },
  },
);

const District = mongoose.model("District", districtSchema);

export default District;
