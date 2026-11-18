import mongoose from "mongoose";

const atmIdSequenceSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      enum: ["atmId"],
      required: true,
    },
    value: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "ATM ID sequence value must be a safe integer",
      },
    },
  },
  {
    collection: "atm_id_sequences",
    timestamps: false,
    versionKey: false,
  },
);

const ATMIdSequence = mongoose.model("ATMIdSequence", atmIdSequenceSchema);

export default ATMIdSequence;
