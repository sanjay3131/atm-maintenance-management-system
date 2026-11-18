import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateMongoDatabaseTarget } from "../src/config/databaseTarget.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const ATM_ID_SEQUENCE_ID = "atmId";
export const ATM_ID_SEQUENCE_CONFIRMATION = "INITIALIZE-ATM-ID-SEQUENCE";
const atmIdPattern = /^ATM(\d{4,})$/;

export class ATMIdSequenceInitializationError extends Error {
  constructor(message, code, details = []) {
    super(message);
    this.name = "ATMIdSequenceInitializationError";
    this.code = code;
    this.details = details;
  }
}

export const validateInitializationArguments = ({
  env,
  targetDatabase,
  confirmation,
  atmWritesPaused,
}) => {
  if (
    typeof targetDatabase !== "string" ||
    targetDatabase !== env.MONGODB_EXPECTED_DATABASE
  ) {
    throw new Error(
      "--target-database must exactly match MONGODB_EXPECTED_DATABASE",
    );
  }
  if (confirmation !== ATM_ID_SEQUENCE_CONFIRMATION) {
    throw new Error(
      `Explicit confirmation required: --confirm=${ATM_ID_SEQUENCE_CONFIRMATION}`,
    );
  }
  if (atmWritesPaused !== true) {
    throw new Error(
      "ATM writes must be paused; pass --atm-writes-paused after confirming",
    );
  }

  return validateMongoDatabaseTarget({
    mongodbUrl: env.MONGODB_URL,
    expectedDatabase: targetDatabase,
  });
};

const validateSequenceDocument = (sequence) => {
  if (
    sequence?._id !== ATM_ID_SEQUENCE_ID ||
    !Number.isSafeInteger(sequence.value) ||
    sequence.value < 0
  ) {
    throw new ATMIdSequenceInitializationError(
      "Existing ATM ID sequence has an invalid ID or counter value",
      "ATM_ID_SEQUENCE_INVALID",
    );
  }
};

const inspectATMIds = async (atmCollection) => {
  const missing = [];
  const malformed = [];
  const duplicateSuffixes = new Map();
  const seenSuffixes = new Map();
  let scannedCount = 0;
  let highestSuffix = 0;

  const cursor = atmCollection.find({}, { projection: { _id: 1, atmId: 1 } });

  for await (const atm of cursor) {
    scannedCount += 1;
    const atmDocumentId = String(atm._id);
    if (typeof atm.atmId !== "string") {
      missing.push(atmDocumentId);
      continue;
    }

    const match = atmIdPattern.exec(atm.atmId);
    if (!match || match[0] !== atm.atmId) {
      malformed.push({ atmDocumentId, atmId: atm.atmId });
      continue;
    }

    const suffix = BigInt(match[1]);
    if (suffix <= 0n || suffix > BigInt(Number.MAX_SAFE_INTEGER)) {
      malformed.push({
        atmDocumentId,
        atmId: atm.atmId,
        reason: "suffix must be positive and within the safe sequence range",
      });
      continue;
    }

    highestSuffix = Math.max(highestSuffix, Number(suffix));

    const matchingATMs = seenSuffixes.get(suffix);
    if (matchingATMs) {
      matchingATMs.push({ atmDocumentId, atmId: atm.atmId });
      duplicateSuffixes.set(suffix, matchingATMs);
    } else {
      seenSuffixes.set(suffix, [
        { atmDocumentId, atmId: atm.atmId },
      ]);
    }
  }

  const duplicates = [...duplicateSuffixes].map(
    ([suffix, matchingATMs]) => ({
      suffix: suffix.toString(),
      atms: matchingATMs,
    }),
  );
  const issues = { missing, malformed, duplicates };

  if (missing.length || malformed.length || duplicates.length) {
    throw new ATMIdSequenceInitializationError(
      "Existing ATM IDs require manual investigation",
      "ATM_IDS_REQUIRE_REVIEW",
      issues,
    );
  }

  return { scannedCount, highestSuffix };
};

const auditATMs = async (atmCollection, expectedCount) => {
  const audit = await inspectATMIds(atmCollection);
  if (audit.scannedCount !== expectedCount) {
    throw new ATMIdSequenceInitializationError(
      "ATM collection changed during sequence verification",
      "ATM_COLLECTION_CHANGED",
    );
  }

  return audit;
};

const isDuplicateKeyError = (error) =>
  error?.code === 11000 || error?.codeName === "DuplicateKey";

export const initializeATMIdSequence = async ({
  atmCollection,
  sequenceCollection,
}) => {
  const atmCount = await atmCollection.countDocuments({});
  const existingSequence = await sequenceCollection.findOne({
    _id: ATM_ID_SEQUENCE_ID,
  });

  const existingATMAudit = await auditATMs(atmCollection, atmCount);
  if (existingSequence) {
    validateSequenceDocument(existingSequence);
    if (existingATMAudit.highestSuffix > existingSequence.value) {
      throw new ATMIdSequenceInitializationError(
        "ATM ID sequence is behind existing ATM IDs",
        "ATM_ID_SEQUENCE_BEHIND",
        {
          highestATMSuffix: existingATMAudit.highestSuffix,
          sequenceValue: existingSequence.value,
        },
      );
    }

    const verifiedATMCount = await atmCollection.countDocuments({});
    if (verifiedATMCount !== atmCount) {
      throw new ATMIdSequenceInitializationError(
        "ATM collection changed during sequence verification",
        "ATM_COLLECTION_CHANGED",
      );
    }

    return {
      status: "already-initialized",
      value: existingSequence.value,
      atmCount: verifiedATMCount,
    };
  }

  let inserted = false;
  try {
    await sequenceCollection.insertOne({
      _id: ATM_ID_SEQUENCE_ID,
      value: existingATMAudit.highestSuffix,
    });
    inserted = true;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const verifiedSequence = await sequenceCollection.findOne({
    _id: ATM_ID_SEQUENCE_ID,
  });
  if (!verifiedSequence) {
    throw new ATMIdSequenceInitializationError(
      "ATM ID sequence was not found after initialization",
      "ATM_ID_SEQUENCE_VERIFICATION_FAILED",
    );
  }
  validateSequenceDocument(verifiedSequence);

  const finalATMCount = await atmCollection.countDocuments({});
  const finalATMAudit = await auditATMs(atmCollection, finalATMCount);
  if (finalATMCount !== atmCount) {
    throw new ATMIdSequenceInitializationError(
      "ATM collection changed during sequence initialization",
      "ATM_COLLECTION_CHANGED",
      { initialATMCount: atmCount, finalATMCount },
    );
  }
  if (finalATMAudit.highestSuffix > verifiedSequence.value) {
    throw new ATMIdSequenceInitializationError(
      "ATM ID sequence is behind existing ATM IDs",
      "ATM_ID_SEQUENCE_BEHIND",
      {
        highestATMSuffix: finalATMAudit.highestSuffix,
        sequenceValue: verifiedSequence.value,
      },
    );
  }
  if (inserted && verifiedSequence.value !== existingATMAudit.highestSuffix) {
    throw new ATMIdSequenceInitializationError(
      "ATM ID sequence changed during initialization; it was not reset",
      "ATM_ID_SEQUENCE_CHANGED",
      { sequenceValue: verifiedSequence.value },
    );
  }

  return {
    status: inserted ? "initialized" : "already-initialized",
    value: verifiedSequence.value,
    atmCount: finalATMCount,
  };
};

const argumentValue = (prefix, args) =>
  args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);

const run = async () => {
  const args = process.argv.slice(2);
  const targetDatabase = argumentValue("--target-database=", args);
  const confirmation = argumentValue("--confirm=", args);
  const atmWritesPaused = args.includes("--atm-writes-paused");

  validateInitializationArguments({
    env: process.env,
    targetDatabase,
    confirmation,
    atmWritesPaused,
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

  const [{ default: ATM }, { default: ATMIdSequence }] = await Promise.all([
    import("../src/modules/atms/atm.model.js"),
    import("../src/modules/atms/atmIdSequence.model.js"),
  ]);

  const result = await initializeATMIdSequence({
    atmCollection: ATM.collection,
    sequenceCollection: ATMIdSequence.collection,
  });

  console.log(
    `ATM ID sequence ${result.status}; value=${result.value}, ATMs=${result.atmCount}`,
  );
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });
  run()
    .catch((error) => {
      console.error(`ATM ID sequence initialization failed: ${error.message}`);
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
