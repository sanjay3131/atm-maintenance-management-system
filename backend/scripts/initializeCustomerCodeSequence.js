import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateMongoDatabaseTarget } from "../src/config/databaseTarget.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const CUSTOMER_CODE_SEQUENCE_ID = "customerCode";
export const CUSTOMER_CODE_SEQUENCE_CONFIRMATION =
  "INITIALIZE-CUSTOMER-CODE-SEQUENCE";
const customerCodePattern = /^CUS-(\d{6,})$/;

export class CustomerCodeSequenceInitializationError extends Error {
  constructor(message, code, details = []) {
    super(message);
    this.name = "CustomerCodeSequenceInitializationError";
    this.code = code;
    this.details = details;
  }
}

export const validateInitializationArguments = ({
  env,
  targetDatabase,
  confirmation,
  customerWritesPaused,
}) => {
  if (
    typeof targetDatabase !== "string" ||
    targetDatabase !== env.MONGODB_EXPECTED_DATABASE
  ) {
    throw new Error(
      "--target-database must exactly match MONGODB_EXPECTED_DATABASE",
    );
  }
  if (confirmation !== CUSTOMER_CODE_SEQUENCE_CONFIRMATION) {
    throw new Error(
      `Explicit confirmation required: --confirm=${CUSTOMER_CODE_SEQUENCE_CONFIRMATION}`,
    );
  }
  if (customerWritesPaused !== true) {
    throw new Error(
      "Customer writes must be paused; pass --customer-writes-paused after confirming",
    );
  }

  return validateMongoDatabaseTarget({
    mongodbUrl: env.MONGODB_URL,
    expectedDatabase: targetDatabase,
  });
};

const validateSequenceDocument = (sequence) => {
  if (
    sequence?._id !== CUSTOMER_CODE_SEQUENCE_ID ||
    !Number.isSafeInteger(sequence.value) ||
    sequence.value < 0
  ) {
    throw new CustomerCodeSequenceInitializationError(
      "Existing customer code sequence has an invalid ID or counter value",
      "CUSTOMER_CODE_SEQUENCE_INVALID",
    );
  }
};

const inspectCustomerCodes = async (customerCollection) => {
  const missing = [];
  const malformed = [];
  const duplicateCodes = new Map();
  const seenCodes = new Map();
  let scannedCount = 0;
  let highestSuffix = 0;

  const cursor = customerCollection.find(
    {},
    { projection: { _id: 1, customerCode: 1 } },
  );

  for await (const customer of cursor) {
    scannedCount += 1;
    const customerId = String(customer._id);
    if (typeof customer.customerCode !== "string") {
      missing.push(customerId);
      continue;
    }

    const match = customerCodePattern.exec(customer.customerCode);
    if (!match || match[0] !== customer.customerCode) {
      malformed.push({ customerId, customerCode: customer.customerCode });
      continue;
    }

    const suffix = BigInt(match[1]);
    if (suffix <= 0n || suffix > BigInt(Number.MAX_SAFE_INTEGER)) {
      malformed.push({
        customerId,
        customerCode: customer.customerCode,
        reason: "suffix must be positive and within the safe sequence range",
      });
      continue;
    }

    const numericSuffix = Number(suffix);
    highestSuffix = Math.max(highestSuffix, numericSuffix);

    const matchingCustomers = seenCodes.get(customer.customerCode);
    if (matchingCustomers) {
      matchingCustomers.push(customerId);
      duplicateCodes.set(customer.customerCode, matchingCustomers);
    } else {
      seenCodes.set(customer.customerCode, [customerId]);
    }
  }

  const duplicates = [...duplicateCodes].map(([customerCode, customerIds]) => ({
    customerCode,
    customerIds,
  }));
  const issues = {
    missing,
    malformed,
    duplicates,
  };

  if (missing.length || malformed.length || duplicates.length) {
    throw new CustomerCodeSequenceInitializationError(
      "Existing customer codes require manual investigation",
      "CUSTOMER_CODES_REQUIRE_REVIEW",
      issues,
    );
  }

  return { scannedCount, highestSuffix };
};

const verifyExistingCustomerCodes = async ({
  customerCollection,
  customerCount,
  sequenceValue,
}) => {
  if (customerCount === 0) return;

  const audit = await inspectCustomerCodes(customerCollection);
  if (audit.scannedCount !== customerCount) {
    throw new CustomerCodeSequenceInitializationError(
      "Customer collection changed during sequence verification",
      "CUSTOMER_COLLECTION_CHANGED",
    );
  }
  if (audit.highestSuffix > sequenceValue) {
    throw new CustomerCodeSequenceInitializationError(
      "Customer code sequence is behind existing customer codes",
      "CUSTOMER_CODE_SEQUENCE_BEHIND",
      { highestCustomerCodeSuffix: audit.highestSuffix, sequenceValue },
    );
  }
};

const isDuplicateKeyError = (error) =>
  error?.code === 11000 || error?.codeName === "DuplicateKey";

export const initializeCustomerCodeSequence = async ({
  customerCollection,
  sequenceCollection,
}) => {
  const customerCount = await customerCollection.countDocuments({});
  const existingSequence = await sequenceCollection.findOne({
    _id: CUSTOMER_CODE_SEQUENCE_ID,
  });

  if (existingSequence) {
    validateSequenceDocument(existingSequence);
    await verifyExistingCustomerCodes({
      customerCollection,
      customerCount,
      sequenceValue: existingSequence.value,
    });

    const verifiedCustomerCount = await customerCollection.countDocuments({});
    if (verifiedCustomerCount !== customerCount) {
      throw new CustomerCodeSequenceInitializationError(
        "Customer collection changed during sequence verification",
        "CUSTOMER_COLLECTION_CHANGED",
      );
    }

    return {
      status: "already-initialized",
      value: existingSequence.value,
      customerCount: verifiedCustomerCount,
    };
  }

  if (customerCount > 0) {
    await inspectCustomerCodes(customerCollection);
    throw new CustomerCodeSequenceInitializationError(
      "Customer records exist but the sequence is missing; no backfill is approved",
      "CUSTOMERS_EXIST_WITHOUT_SEQUENCE",
      { customerCount },
    );
  }

  let inserted = false;
  try {
    await sequenceCollection.insertOne({
      _id: CUSTOMER_CODE_SEQUENCE_ID,
      value: 0,
    });
    inserted = true;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const verifiedSequence = await sequenceCollection.findOne({
    _id: CUSTOMER_CODE_SEQUENCE_ID,
  });
  if (!verifiedSequence) {
    throw new CustomerCodeSequenceInitializationError(
      "Customer code sequence was not found after initialization",
      "CUSTOMER_CODE_SEQUENCE_VERIFICATION_FAILED",
    );
  }
  validateSequenceDocument(verifiedSequence);

  const verifiedCustomerCount = await customerCollection.countDocuments({});
  if (inserted && verifiedSequence.value !== 0) {
    throw new CustomerCodeSequenceInitializationError(
      "Customer code sequence changed during initialization; it was not reset",
      "CUSTOMER_CODE_SEQUENCE_CHANGED",
      { sequenceValue: verifiedSequence.value },
    );
  }
  if (verifiedCustomerCount !== 0) {
    await verifyExistingCustomerCodes({
      customerCollection,
      customerCount: verifiedCustomerCount,
      sequenceValue: verifiedSequence.value,
    });
    throw new CustomerCodeSequenceInitializationError(
      "Customer records appeared during initialization; sequence was not changed",
      "CUSTOMERS_APPEARED_DURING_INITIALIZATION",
      { customerCount: verifiedCustomerCount },
    );
  }

  return {
    status: inserted ? "initialized" : "already-initialized",
    value: verifiedSequence.value,
    customerCount: verifiedCustomerCount,
  };
};

const argumentValue = (prefix, args) =>
  args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);

const run = async () => {
  const targetDatabase = argumentValue(
    "--target-database=",
    process.argv.slice(2),
  );
  const confirmation = argumentValue("--confirm=", process.argv.slice(2));
  const customerWritesPaused = process.argv.includes(
    "--customer-writes-paused",
  );

  validateInitializationArguments({
    env: process.env,
    targetDatabase,
    confirmation,
    customerWritesPaused,
  });

  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);

  await mongoose.connect(process.env.MONGODB_URL, {
    autoIndex: false,
    autoCreate: false,
    readPreference: "primary",
    readConcern: { level: "majority" },
    writeConcern: { w: "majority" },
    serverSelectionTimeoutMS: 10000,
  });

  const [{ default: Customer }, { default: CustomerCodeSequence }] =
    await Promise.all([
      import("../src/modules/customers/customer.model.js"),
      import("../src/modules/customers/customerCodeSequence.model.js"),
    ]);

  const result = await initializeCustomerCodeSequence({
    customerCollection: Customer.collection,
    sequenceCollection: CustomerCodeSequence.collection,
  });

  console.log(
    `Customer code sequence ${result.status}; value=${result.value}, customers=${result.customerCount}`,
  );
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });
  run()
    .catch((error) => {
      console.error(`Customer code sequence initialization failed: ${error.message}`);
      if (error.details) {
        console.error(JSON.stringify(error.details, null, 2));
      }
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });
}
