import mongoose from "mongoose";

const customerSchema = new mongoose.Schema(
  {
    // Link to User model (auth)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    // Customer-specific fields
    customerName: {
      type: String,
      required: true,
      trim: true,
    },

    customerEmail: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    customerPhone: {
      type: String,
      required: true,
      trim: true,
    },

    // Business relationship
    bankName: {
      type: String,
      trim: true,
    },

    // Which ATMs does this customer own?
    atmIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ATM",
      },
    ],

    // Which districts does this customer operate in?
    districtIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "District",
      },
    ],

    // Status
    isActive: {
      type: Boolean,
      default: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },

    // Audit
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
customerSchema.index({ userId: 1 });
customerSchema.index({ customerEmail: 1 });
customerSchema.index({ bankName: 1 });
customerSchema.index({ isDeleted: 1 });

const Customer = mongoose.model("Customer", customerSchema);

export default Customer;
