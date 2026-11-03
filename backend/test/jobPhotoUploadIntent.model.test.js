import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import JobPhotoUploadIntent from "../src/modules/jobPhotos/jobPhotoUploadIntent.model.js";

const objectId = () => new mongoose.Types.ObjectId();
const validIntent = () => ({
  jobId: objectId(),
  clientPhotoId: "7d6f1c1a-6c8e-4e51-9c2a-0b1c2d3e4f50",
  ownerUserId: objectId(),
  currentOwnerUserId: objectId(),
  photoType: "before",
  contentSha256: "a".repeat(64),
  byteSize: 1024,
  verifiedMimeType: "image/jpeg",
  originalName: "before.jpg",
  state: "reserved",
  ownerTokenHash: "b".repeat(64),
  ownerVersion: 1,
});

test("creates a valid upload intent with nullable retention", () => {
  const intent = new JobPhotoUploadIntent(validIntent());
  const error = intent.validateSync();

  assert.ifError(error);
  assert.equal(intent.retentionExpiresAt, null);
  assert.equal(intent.ownerVersion, 1);
  assert.equal(intent.assetClaimFenceVersion, 0);
  assert.ok(intent.currentOwnerUserId);
});

test("keeps the parent fence counter private and non-negative", () => {
  const path = JobPhotoUploadIntent.schema.path("assetClaimFenceVersion");
  assert.equal(path.options.select, false);
  assert.equal(path.options.default, 0);
  assert.equal(
    new JobPhotoUploadIntent({
      ...validIntent(),
      assetClaimFenceVersion: -1,
    }).validateSync().errors.assetClaimFenceVersion !== undefined,
    true,
  );
});

test("rejects invalid identity, content, owner version, and photo type values", () => {
  const intent = new JobPhotoUploadIntent({
    ...validIntent(),
    clientPhotoId: "not-a-uuid",
    contentSha256: "A".repeat(64),
    byteSize: 1.5,
    ownerVersion: 1.5,
    photoType: "other",
  });
  const error = intent.validateSync();

  assert.ok(error);
  assert.ok(error.errors.clientPhotoId);
  assert.ok(error.errors.contentSha256);
  assert.ok(error.errors.byteSize);
  assert.ok(error.errors.ownerVersion);
  assert.ok(error.errors.photoType);
});

test("rejects unsupported MIME types, negative sizes, and invalid states", () => {
  const intent = new JobPhotoUploadIntent({
    ...validIntent(),
    verifiedMimeType: "image/gif",
    byteSize: -1,
    state: "unknown",
  });
  const error = intent.validateSync();

  assert.ok(error);
  assert.ok(error.errors.verifiedMimeType);
  assert.ok(error.errors.byteSize);
  assert.ok(error.errors.state);
});

test("does not select the owner token hash by default", () => {
  assert.equal(
    JobPhotoUploadIntent.schema.path("ownerTokenHash").options.select,
    false,
  );
});

test("keeps the original owner immutable while allowing the current owner to change", () => {
  const originalOwner = objectId();
  const currentOwner = objectId();
  const intent = new JobPhotoUploadIntent({
    ...validIntent(),
    ownerUserId: originalOwner,
    currentOwnerUserId: currentOwner,
  });

  assert.equal(intent.schema.path("ownerUserId").options.immutable, true);
  assert.equal(intent.schema.path("currentOwnerUserId").options.immutable, undefined);
});

test("keeps reservation identity and content metadata immutable", () => {
  const immutablePaths = [
    "jobId",
    "clientPhotoId",
    "ownerUserId",
    "photoType",
    "contentSha256",
    "byteSize",
    "verifiedMimeType",
    "originalName",
  ];
  const intent = JobPhotoUploadIntent.hydrate({
    _id: objectId(),
    ...validIntent(),
  });

  for (const path of immutablePaths) {
    assert.equal(
      JobPhotoUploadIntent.schema.path(path).options.immutable,
      true,
      `${path} must be immutable`,
    );
  }

  const originalValues = Object.fromEntries(
    immutablePaths.map((path) => [path, intent.get(path)]),
  );
  intent.clientPhotoId = "8d6f1c1a-6c8e-4e51-9c2a-0b1c2d3e4f50";
  intent.photoType = "after";
  intent.byteSize = 2048;

  assert.equal(intent.clientPhotoId, originalValues.clientPhotoId);
  assert.equal(intent.photoType, originalValues.photoType);
  assert.equal(intent.byteSize, originalValues.byteSize);
});

test("strips immutable identity updates during update casting", () => {
  const query = JobPhotoUploadIntent.updateOne(
    { _id: objectId() },
    {
      $set: {
        clientPhotoId: "8d6f1c1a-6c8e-4e51-9c2a-0b1c2d3e4f50",
        state: "uploading",
      },
    },
  );
  const castedUpdate = query._castUpdate(query.getUpdate());

  assert.equal(castedUpdate.$set.clientPhotoId, undefined);
  assert.equal(castedUpdate.$set.state, "uploading");
});

test("declares the identity and lease indexes without retention or content indexes", () => {
  const indexes = JobPhotoUploadIntent.schema.indexes();
  const byName = new Map(indexes.map(([fields, options]) => [options.name, { fields, options }]));

  assert.deepEqual(byName.get("job_photo_upload_intent_identity").fields, {
    jobId: 1,
    clientPhotoId: 1,
  });
  assert.equal(
    byName.get("job_photo_upload_intent_identity").options.unique,
    true,
  );
  assert.deepEqual(byName.get("job_photo_upload_intent_lease_recovery").fields, {
    state: 1,
    leaseExpiresAt: 1,
  });
  assert.equal(
    byName.get("job_photo_upload_intent_lease_recovery").options.unique,
    undefined,
  );
  assert.equal(
    indexes.some(([, options]) => options.expireAfterSeconds !== undefined),
    false,
  );
  assert.equal(
    indexes.some(([fields]) => Object.hasOwn(fields, "contentSha256")),
    false,
  );
  assert.equal(
    Object.hasOwn(
      byName.get("job_photo_upload_intent_identity").fields,
      "photoType",
    ),
    false,
  );
});
