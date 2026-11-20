import ApiError from "../../utils/ApiError.js";
import { CustomerCodeSequenceError } from "./customerCode.service.js";

const CUSTOMER_CODE_SEQUENCE_ERROR_CODES = new Set([
  "CUSTOMER_CODE_SEQUENCE_NOT_INITIALIZED",
  "CUSTOMER_CODE_SEQUENCE_INVALID",
  "CUSTOMER_CODE_SEQUENCE_EXHAUSTED",
]);

const isCustomerCodeDuplicateKeyError = (error) =>
  error?.code === 11000 &&
  (error.keyPattern?.customerCode === 1 ||
    Object.hasOwn(error.keyValue ?? {}, "customerCode") ||
    /index:\s*customerCode_1(?:\s|$)/.test(error.message ?? ""));

export const mapCustomerCodeError = (error) => {
  if (
    error instanceof CustomerCodeSequenceError &&
    CUSTOMER_CODE_SEQUENCE_ERROR_CODES.has(error.code)
  ) {
    return new ApiError(503, error.message);
  }

  if (isCustomerCodeDuplicateKeyError(error)) {
    return new ApiError(409, "Customer code already exists");
  }

  return error;
};
