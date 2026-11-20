import ATM from "../atms/atm.model.js";
import ATMIdSequence from "./atmIdSequence.model.js";

const ATM_ID_SEQUENCE_ID = "atmId";
const MAX_ATM_ID_RESERVATION_COUNT = 1000;

export class ATMIdSequenceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ATMIdSequenceError";
    this.code = code;
  }
}

export const formatATMId = (value) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ATMIdSequenceError(
      "ATM ID sequence returned a non-positive, non-integer, or unsafe value",
      "ATM_ID_SEQUENCE_INVALID",
    );
  }

  return `ATM${String(value).padStart(4, "0")}`;
};

export const reserveATMIds = async (count, { session } = {}) => {
  if (
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    count > MAX_ATM_ID_RESERVATION_COUNT
  ) {
    throw new ATMIdSequenceError(
      `ATM ID reservation count must be between 1 and ${MAX_ATM_ID_RESERVATION_COUNT}`,
      "ATM_ID_SEQUENCE_INVALID_COUNT",
    );
  }

  const maximumBeforeIncrement = Number.MAX_SAFE_INTEGER - count;
  if (maximumBeforeIncrement < 0) {
    throw new ATMIdSequenceError(
      "ATM ID sequence is exhausted",
      "ATM_ID_SEQUENCE_EXHAUSTED",
    );
  }

  const sequenceFilter = {
    _id: ATM_ID_SEQUENCE_ID,
    value: {
      $type: "number",
      $gte: 0,
      $lte: maximumBeforeIncrement,
    },
    $expr: {
      $eq: [{ $mod: ["$value", 1] }, 0],
    },
  };
  const options = { new: true, upsert: false };
  if (session) options.session = session;

  const sequence = await ATMIdSequence.findOneAndUpdate(
    sequenceFilter,
    { $inc: { value: count } },
    options,
  );

  if (!sequence) {
    const lookupOptions = session ? { session } : {};
    const existingSequence = await ATMIdSequence.findOne(
      { _id: ATM_ID_SEQUENCE_ID },
      null,
      lookupOptions,
    );

    if (!existingSequence) {
      throw new ATMIdSequenceError(
        "ATM ID sequence is not initialized",
        "ATM_ID_SEQUENCE_NOT_INITIALIZED",
      );
    }

    if (
      !Number.isSafeInteger(existingSequence.value) ||
      existingSequence.value < 0
    ) {
      throw new ATMIdSequenceError(
        "ATM ID sequence contains an invalid counter value",
        "ATM_ID_SEQUENCE_INVALID",
      );
    }

    throw new ATMIdSequenceError(
      "ATM ID sequence is exhausted",
      "ATM_ID_SEQUENCE_EXHAUSTED",
    );
  }

  const lastReservedValue = sequence.value;
  if (!Number.isSafeInteger(lastReservedValue) || lastReservedValue < count) {
    throw new ATMIdSequenceError(
      "ATM ID sequence returned an invalid counter value",
      "ATM_ID_SEQUENCE_INVALID",
    );
  }

  const firstReservedValue = lastReservedValue - count + 1;
  return Array.from({ length: count }, (_, index) =>
    formatATMId(firstReservedValue + index),
  );
};

export const generateATMId = async () => {
  const lastATM = await ATM.findOne().sort({ createdAt: -1 }).select("atmId");

  if (!lastATM) {
    return "ATM0001";
  }

  const lastNumber = parseInt(lastATM.atmId.replace("ATM", ""), 10);
  const nextNumber = lastNumber + 1;

  return `ATM${nextNumber.toString().padStart(4, "0")}`;
};
