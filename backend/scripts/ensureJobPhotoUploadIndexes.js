import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import JobPhotoUploadIntent from "../src/modules/jobPhotos/jobPhotoUploadIntent.model.js";
import JobPhotoUploadAsset from "../src/modules/jobPhotos/jobPhotoUploadAsset.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });

mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const CONFIRMATION = "1";
const DUPLICATE_LIMIT = 50;

const requiredIndexes = [
  {
    collectionName: JobPhoto.collection.collectionName,
    model: JobPhoto,
    definitions: [
      {
        fields: { uploadIntentId: 1 },
        options: {
          unique: true,
          name: "job_photo_upload_intent_unique",
          partialFilterExpression: {
            uploadIntentId: { $exists: true },
          },
        },
      },
    ],
  },
  {
    collectionName: JobPhotoUploadIntent.collection.collectionName,
    model: JobPhotoUploadIntent,
    definitions: [
      {
        fields: { jobId: 1, clientPhotoId: 1 },
        options: {
          unique: true,
          name: "job_photo_upload_intent_identity",
        },
      },
      {
        fields: { state: 1, leaseExpiresAt: 1 },
        options: {
          name: "job_photo_upload_intent_lease_recovery",
        },
      },
    ],
  },
  {
    collectionName: JobPhotoUploadAsset.collection.collectionName,
    model: JobPhotoUploadAsset,
    definitions: [
      {
        fields: { intentId: 1, ownerVersion: 1 },
        options: {
          unique: true,
          name: "job_photo_upload_asset_intent_version",
        },
      },
      {
        fields: { publicId: 1 },
        options: {
          unique: true,
          name: "job_photo_upload_asset_public_id",
        },
      },
      {
        fields: { intentId: 1, state: 1 },
        options: {
          name: "job_photo_upload_asset_intent_state",
        },
      },
      {
        fields: { state: 1, createdAt: 1 },
        options: {
          name: "job_photo_upload_asset_reconciliation",
        },
      },
    ],
  },
];

const canonicalize = (value) => {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
};

const comparableKey = (key) => JSON.stringify(Object.entries(key));

const comparableOptions = (options = {}) => {
  const {
    name,
    ns,
    v,
    key,
    unique = false,
    sparse = false,
    hidden = false,
    ...remainingOptions
  } = options;

  return {
    ...remainingOptions,
    unique: unique === true,
    sparse: sparse === true,
    hidden: hidden === true,
  };
};

const indexMatches = (index, definition) =>
  comparableKey(index.key) === comparableKey(definition.fields) &&
  JSON.stringify(canonicalize(comparableOptions(index))) ===
    JSON.stringify(
      canonicalize(comparableOptions(definition.options)),
    );

const listIndexes = async (collection) => {
  try {
    return await collection.listIndexes().toArray();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") {
      return [];
    }
    throw error;
  }
};

const duplicateGroups = async (collection, fields, match = null) => {
  try {
    const pipeline = [];
    if (match) pipeline.push({ $match: match });
    pipeline.push(
      {
          $group: {
            _id: fields.reduce(
              (group, field) => ({ ...group, [field]: `$${field}` }),
              {},
            ),
            documentIds: { $push: "$_id" },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $limit: DUPLICATE_LIMIT },
      );
    return await collection
      .aggregate(pipeline)
      .toArray();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") {
      return [];
    }
    throw error;
  }
};

const formatDuplicateGroups = (collectionName, fields, groups) =>
  groups.map((group) => ({
    collection: collectionName,
    fields: fields.reduce(
      (values, field) => ({ ...values, [field]: group._id[field] }),
      {},
    ),
    documentIds: group.documentIds.map(String),
    count: group.count,
  }));

const collectDuplicateIssues = async () => {
  const checks = [
    [
      JobPhotoUploadIntent.collection,
      ["jobId", "clientPhotoId"],
    ],
    [JobPhotoUploadAsset.collection, ["intentId", "ownerVersion"]],
    [JobPhotoUploadAsset.collection, ["publicId"]],
    [
      JobPhoto.collection,
      ["uploadIntentId"],
      { uploadIntentId: { $exists: true } },
    ],
  ];
  const duplicates = [];

  for (const [collection, fields, match] of checks) {
    const groups = await duplicateGroups(collection, fields, match);
    duplicates.push(
      ...formatDuplicateGroups(collection.collectionName, fields, groups),
    );
  }

  return duplicates;
};

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
};

const preflightIndexes = async () => {
  const missingIndexes = [];
  const conflicts = [];

  for (const group of requiredIndexes) {
    const indexes = await listIndexes(group.model.collection);
    const indexesByName = new Map(indexes.map((index) => [index.name, index]));

    for (const definition of group.definitions) {
      const existing = indexesByName.get(definition.options.name);
      if (existing) {
        if (!indexMatches(existing, definition)) {
          conflicts.push(
            `${definition.options.name} on ${group.collectionName} has a conflicting definition`,
          );
        }
        continue;
      }

      missingIndexes.push({
        collectionName: group.collectionName,
        collection: group.model.collection,
        definition,
      });
    }
  }

  const duplicateIssues = await collectDuplicateIssues();
  if (conflicts.length > 0 || duplicateIssues.length > 0) {
    const details = [
      ...conflicts,
      ...(duplicateIssues.length > 0
        ? [
            `Duplicate upload-intent/index keys found:\n${JSON.stringify(
              duplicateIssues,
              null,
              2,
            )}`,
          ]
        : []),
    ];
    throw new Error(
      `Index preflight failed; no index mutations occurred:\n${details.join(
        "\n",
      )}`,
    );
  }

  return missingIndexes;
};

const createMissingIndexes = async (missingIndexes) => {
  for (const { collection, definition } of missingIndexes) {
    await collection.createIndex(definition.fields, definition.options);
  }
};

const run = async () => {
  if (process.env.CONFIRM_JOB_PHOTO_INDEX_SETUP !== CONFIRMATION) {
    throw new Error(
      "Set CONFIRM_JOB_PHOTO_INDEX_SETUP=1 to explicitly confirm upload index setup.",
    );
  }

  const uri = process.env.MONGODB_URL;
  if (!uri) throw new Error("MONGODB_URL is not configured");
  assertTargetDatabase(uri);

  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
    readPreference: "primary",
    readConcern: { level: "majority" },
    serverSelectionTimeoutMS: 10000,
  });

  const missingIndexes = await preflightIndexes();
  await createMissingIndexes(missingIndexes);
  console.log("Job photo upload indexes are ready.");
};

try {
  await run();
} catch (error) {
  console.error(
    "Job photo upload index setup failed:",
    error?.message ?? "Unknown error",
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
