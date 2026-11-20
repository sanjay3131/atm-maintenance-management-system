import mongoose from "mongoose";

const customerCodePattern = /^CUS-([0-9]{6,})$/;

const trimCustomerCode = (value) => {
  if (typeof value !== "string" || /[\r\n\u2028\u2029]/.test(value)) {
    return value;
  }

  return value.trim();
};

const isValidCustomerCode = (value) => {
  const match = customerCodePattern.exec(value);
  if (!match || match[0] !== value) return false;

  const suffix = BigInt(match[1]);
  return suffix > 0n && suffix <= BigInt(Number.MAX_SAFE_INTEGER);
};

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

    customerCode: {
      type: String,
      set: trimCustomerCode,
      validate: {
        validator: isValidCustomerCode,
        message:
          "Customer code must be CUS- followed by at least six digits and a positive safe-integer suffix",
      },
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
    bankId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bank",
    },
    regionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
    },
    districtId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
    },
    regionIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Region",
        },
      ],
      default: undefined,
    },
    serviceDistrictIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "District",
        },
      ],
      default: undefined,
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

customerSchema.index(
  { customerCode: 1 },
  {
    unique: true,
    partialFilterExpression: { customerCode: { $type: "string" } },
  },
);
customerSchema.index({ bankName: 1 });
customerSchema.index({ isDeleted: 1 });

const Customer = mongoose.model("Customer", customerSchema);

export default Customer;
