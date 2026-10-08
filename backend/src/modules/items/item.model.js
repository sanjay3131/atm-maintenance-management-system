import mongoose from "mongoose";

const itemSchema = new mongoose.Schema(
  {
    itemName: {
      type: String,
      required: [true, "Item name is required"],
      trim: true,
      maxlength: 120,
    },
    normalizedName: {
      type: String,
      required: true,
      select: false,
    },
    unit: {
      type: String,
      required: [true, "Unit is required"],
      trim: true,
      maxlength: 40,
    },
    currentUnitCost: {
      type: Number,
      required: [true, "Current unit cost is required"],
      min: 0,
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
    toJSON: {
      transform(_document, result) {
        delete result.normalizedName;
        return result;
      },
    },
    toObject: {
      transform(_document, result) {
        delete result.normalizedName;
        return result;
      },
    },
  },
);

itemSchema.index(
  { normalizedName: 1 },
  { unique: true, name: "normalizedName_1" },
);
itemSchema.index({ isActive: 1, itemName: 1 });

const Item = mongoose.model("Item", itemSchema);

export default Item;
