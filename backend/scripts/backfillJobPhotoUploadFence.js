import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import JobPhotoUploadIntent from "../src/modules/jobPhotos/jobPhotoUploadIntent.model.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });

const CONFIRMATION = "1";
const REQUIRED_ENVIRONMENT = "non-production";

const assertTargetDatabase = (uri) => {
  let parsedUri;
  try {
    parsedUri = new URL(uri);
  } catch {
    throw new Error("MONGODB_URL is not a valid MongoDB URI");
  }
  if (!["mongodb:", "mongodb+srv:"].includes(parsedUri.protocol)) {
    throw new Error("MONGODB_URL must use mongodb: or mongodb+srv: protocol");
  }
  if (!parsedUri.pathname || parsedUri.pathname === "/") {
    throw new Error("MONGODB_URL must include a target database name");
  }
  const targetDatabase = process.env.JOB_PHOTO_FENCE_BACKFILL_TARGET_DATABASE;
  if (!targetDatabase) {
    throw new Error(
      "JOB_PHOTO_FENCE_BACKFILL_TARGET_DATABASE is required to identify the target database.",
    );
  }
  const databaseName = decodeURIComponent(parsedUri.pathname.slice(1));
  if (databaseName !== targetDatabase) {
    throw new Error(
      `MONGODB_URL database ${databaseName} does not match the explicit target ${targetDatabase}.`,
    );
  }
  if (process.env.JOB_PHOTO_FENCE_BACKFILL_ENV !== REQUIRED_ENVIRONMENT) {
    throw new Error(
      "Set JOB_PHOTO_FENCE_BACKFILL_ENV=non-production; production and ambiguous targets are rejected.",
    );
  }
  if (/(^|[-_])prod(uction)?([-_]|$)/i.test(databaseName)) {
    throw new Error("Production-looking target database names are rejected.");
  }
};

const run = async () => {
  if (process.env.CONFIRM_JOB_PHOTO_FENCE_BACKFILL !== CONFIRMATION) {
    throw new Error(
      "Set CONFIRM_JOB_PHOTO_FENCE_BACKFILL=1 to explicitly confirm the idempotent fence backfill.",
    );
  }
  if (!process.env.MONGODB_URL) {
    throw new Error("MONGODB_URL is required for the fence backfill.");
  }
  assertTargetDatabase(process.env.MONGODB_URL);

  await mongoose.connect(process.env.MONGODB_URL, {
    autoIndex: false,
    autoCreate: false,
  });
  try {
    const result = await JobPhotoUploadIntent.updateMany(
      { assetClaimFenceVersion: { $exists: false } },
      { $set: { assetClaimFenceVersion: 0 } },
    );
    const remaining = await JobPhotoUploadIntent.countDocuments({
      assetClaimFenceVersion: { $exists: false },
    });
    if (remaining !== 0) {
      throw new Error(
        `Fence backfill verification failed: ${remaining} upload intents remain without assetClaimFenceVersion.`,
      );
    }
    console.log(
      `Fence backfill matched ${result.matchedCount} and modified ${result.modifiedCount} upload intents; verification found zero missing counters.`,
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
