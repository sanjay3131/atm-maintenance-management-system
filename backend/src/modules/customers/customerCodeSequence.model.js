import mongoose from "mongoose";

const customerCodeSequenceSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      enum: ["customerCode"],
      required: true,
    },
    value: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "Customer code sequence value must be a safe integer",
      },
    },
  },
  {
    collection: "customer_code_sequences",
    timestamps: false,
    versionKey: false,
  },
);

const CustomerCodeSequence = mongoose.model(
  "CustomerCodeSequence",
  customerCodeSequenceSchema,
);

export default CustomerCodeSequence;
