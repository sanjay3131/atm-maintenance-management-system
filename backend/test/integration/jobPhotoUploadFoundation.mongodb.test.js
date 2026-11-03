import assert from "node:assert/strict";
import mongoose from "mongoose";
import test from "node:test";
import Job from "../../src/modules/jobs/jobs.model.js";
import JobPhotoUploadAsset from "../../src/modules/jobPhotos/jobPhotoUploadAsset.model.js";
import JobPhotoUploadIntent from "../../src/modules/jobPhotos/jobPhotoUploadIntent.model.js";
import JobPhoto from "../../src/modules/jobPhotos/jobPhotos.model.js";

const expectedDatabaseName = "atm_job_photo_foundation_integration_test";
const testMongoUri = process.env.TEST_MONGODB_URI;
const integrationEnabled =
  testMongoUri && process.env.ALLOW_LOCAL_MONGODB_INTEGRATION_TESTS === "1";
const integrationTest = integrationEnabled
  ? test
  : test.skip;

const runId = new mongoose.Types.ObjectId().toString();
const ownedIds = new Map([
  [Job, []],
  [JobPhotoUploadIntent, []],
  [JobPhotoUploadAsset, []],
  [JobPhoto, []],
]);

const remember = (model, document) => {
  ownedIds.get(model).push(document._id);
  return document;
};

const assertSafeUri = (uri) => {
  let parsedUri;
  assert.doesNotThrow(() => {
    parsedUri = new URL(uri);
  }, "TEST_MONGODB_URI must be a valid MongoDB URI");
  assert.equal(parsedUri.protocol, "mongodb:");
  assert.ok(["localhost", "127.0.0.1"].includes(parsedUri.hostname));
  assert.equal(parsedUri.username, "");
  assert.equal(parsedUri.password, "");
  assert.equal(
    decodeURIComponent(parsedUri.pathname.slice(1)),
    expectedDatabaseName,
  );
  assert.deepEqual(parsedUri.searchParams.getAll("replicaSet"), ["rs0"]);
  assert.deepEqual(
    [...new Set(parsedUri.searchParams.keys())],
    ["replicaSet"],
  );
};

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

const expectedIndexes = new Map([
  [
    JobPhoto.collection.collectionName,
    [
      {
        name: "job_photo_upload_intent_unique",
        key: { uploadIntentId: 1 },
        unique: true,
      },
    ],
  ],
  [
    JobPhotoUploadIntent.collection.collectionName,
    [
      {
        name: "job_photo_upload_intent_identity",
        key: { jobId: 1, clientPhotoId: 1 },
        unique: true,
      },
      {
        name: "job_photo_upload_intent_lease_recovery",
        key: { state: 1, leaseExpiresAt: 1 },
        unique: false,
      },
    ],
  ],
  [
    JobPhotoUploadAsset.collection.collectionName,
    [
      {
        name: "job_photo_upload_asset_intent_version",
        key: { intentId: 1, ownerVersion: 1 },
        unique: true,
      },
      {
        name: "job_photo_upload_asset_public_id",
        key: { publicId: 1 },
        unique: true,
      },
      {
        name: "job_photo_upload_asset_intent_state",
        key: { intentId: 1, state: 1 },
        unique: false,
      },
      {
        name: "job_photo_upload_asset_reconciliation",
        key: { state: 1, createdAt: 1 },
        unique: false,
      },
    ],
  ],
]);

const assertCompatibleExistingIndexes = async () => {
  for (const [collectionName, definitions] of expectedIndexes) {
    let indexes;
    try {
      indexes = await mongoose.connection.db
        .collection(collectionName)
        .listIndexes()
        .toArray();
    } catch (error) {
      if (error?.code === 26 || error?.codeName === "NamespaceNotFound") {
        continue;
      }
      throw error;
    }

    for (const definition of definitions) {
      const existing = indexes.find(({ name }) => name === definition.name);
      if (!existing) continue;
      assert.deepEqual(
        canonicalize(existing.key),
        canonicalize(definition.key),
        `${collectionName}.${definition.name} has an unexpected key pattern`,
      );
      assert.equal(
        existing.unique === true,
        definition.unique,
        `${collectionName}.${definition.name} has an unexpected uniqueness setting`,
      );
      assert.equal(
        existing.sparse === true,
        false,
        `${collectionName}.${definition.name} must not be sparse`,
      );
      assert.equal(
        existing.expireAfterSeconds,
        undefined,
        `${collectionName}.${definition.name} must not be a TTL index`,
      );
    }
  }
};

integrationTest(
  "job photo foundation uses a safe opt-in local replica-set database",
  async () => {
    assert.ok(testMongoUri);

    try {
      assertSafeUri(testMongoUri);
      await mongoose.connect(testMongoUri, {
        autoIndex: false,
        autoCreate: false,
        serverSelectionTimeoutMS: 5000,
      });

      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      assert.equal(hello.setName, "rs0");
      assert.equal(hello.isWritablePrimary, true);
      assert.notEqual(hello.logicalSessionTimeoutMinutes, undefined);

      await assertCompatibleExistingIndexes();

      const job = remember(
        Job,
        await Job.create({
          jobId: `PHOTO-FOUNDATION-${runId}`,
          title: "Photo foundation integration fixture",
          atmId: new mongoose.Types.ObjectId(),
          createdBy: new mongoose.Types.ObjectId(),
          status: "IN_PROGRESS",
        }),
      );
      assert.equal(job.photoFinalizationRevision, undefined);
      const ownerUserId = new mongoose.Types.ObjectId();
      const intent = remember(
        JobPhotoUploadIntent,
        await JobPhotoUploadIntent.create({
          jobId: job._id,
          clientPhotoId: "7d6f1c1a-6c8e-4e51-9c2a-0b1c2d3e4f50",
          ownerUserId,
          currentOwnerUserId: ownerUserId,
          photoType: "before",
          contentSha256: "a".repeat(64),
          byteSize: 1024,
          verifiedMimeType: "image/jpeg",
          state: "reserved",
          ownerTokenHash: "b".repeat(64),
          ownerVersion: 1,
        }),
      );
      const asset = remember(
        JobPhotoUploadAsset,
        await JobPhotoUploadAsset.create({
          intentId: intent._id,
          jobId: job._id,
          clientPhotoId: intent.clientPhotoId,
          photoType: intent.photoType,
          ownerVersion: 1,
          publicId: `jobs/${job._id}/before/${intent._id}/v1`,
          expectedSha256: intent.contentSha256,
          state: "verified",
        }),
      );

      assert.equal(asset.ownerVersion, 1);
      assert.equal(intent.retentionExpiresAt, null);

      const legacyJobId = new mongoose.Types.ObjectId();
      await Job.collection.insertOne({
        _id: legacyJobId,
        jobId: `PHOTO-LEGACY-${runId}`,
        title: "Legacy photo foundation fixture",
        atmId: new mongoose.Types.ObjectId(),
        createdBy: new mongoose.Types.ObjectId(),
        status: "IN_PROGRESS",
        beforePhotos: [],
        afterPhotos: [],
        isDeleted: false,
      });
      ownedIds.get(Job).push(legacyJobId);

      const rawLegacyJob = await Job.collection.findOne({ _id: legacyJobId });
      assert.equal(
        Object.hasOwn(rawLegacyJob, "photoFinalizationRevision"),
        false,
      );
    } finally {
      try {
        if (mongoose.connection.readyState === 1) {
          for (const [model, ids] of ownedIds) {
            if (ids.length > 0) {
              await model.deleteMany({ _id: { $in: ids } });
            }
          }
        }
      } finally {
        await mongoose.disconnect();
      }
    }
  },
);
