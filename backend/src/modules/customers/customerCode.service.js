import CustomerCodeSequence from "./customerCodeSequence.model.js";

const CUSTOMER_CODE_SEQUENCE_ID = "customerCode";

export class CustomerCodeSequenceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CustomerCodeSequenceError";
    this.code = code;
  }
}

export const formatCustomerCode = (value) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CustomerCodeSequenceError(
      "Customer code sequence returned a non-positive, non-integer, or unsafe value",
      "CUSTOMER_CODE_SEQUENCE_INVALID",
    );
  }

  return `CUS-${String(value).padStart(6, "0")}`;
};

export const generateCustomerCode = async () => {
  const sequence = await CustomerCodeSequence.findOneAndUpdate(
    {
      _id: CUSTOMER_CODE_SEQUENCE_ID,
      value: { $lt: Number.MAX_SAFE_INTEGER },
    },
    { $inc: { value: 1 } },
    { new: true, upsert: false },
  );

  if (!sequence) {
    const existingSequence =
      await CustomerCodeSequence.findById(CUSTOMER_CODE_SEQUENCE_ID);

    if (existingSequence?.value === Number.MAX_SAFE_INTEGER) {
      throw new CustomerCodeSequenceError(
        "Customer code sequence is exhausted",
        "CUSTOMER_CODE_SEQUENCE_EXHAUSTED",
      );
    }

    if (existingSequence) {
      throw new CustomerCodeSequenceError(
        "Customer code sequence contains an invalid counter value",
        "CUSTOMER_CODE_SEQUENCE_INVALID",
      );
    }

    throw new CustomerCodeSequenceError(
      "Customer code sequence is not initialized",
      "CUSTOMER_CODE_SEQUENCE_NOT_INITIALIZED",
    );
  }

  return formatCustomerCode(sequence.value);
};
