import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import JobPhotoUploadAsset from "../src/modules/jobPhotos/jobPhotoUploadAsset.model.js";

const validAsset = () => ({
  intentId: new mongoose.Types.ObjectId(),
  jobId: new mongoose.Types.ObjectId(),
  clientPhotoId: "7d6f1c1a-6c8e-4e51-9c2a-0b1c2d3e4f50",
  photoType: "before",
  ownerVersion: 1,
  publicId: "jobs/job/before/intent/v1",
  assetId: "cloudinary-asset-id",
  resourceType: "image",
  format: "jpg",
  secureUrl: "https://res.cloudinary.com/example/image/upload/v1/photo.jpg",
  cloudinaryBytes: 1024,
  expectedSha256: "a".repeat(64),
  verifiedSha256: "a".repeat(64),
  verifiedMimeType: "image/jpeg",
  state: "verified",
});

test("creates a valid asset for an independent owner generation", () => {
  const asset = new JobPhotoUploadAsset(validAsset());
  const error = asset.validateSync();

  assert.ifError(error);
  assert.equal(asset.ownerVersion, 1);
  assert.equal(asset.adoptedJobPhotoId, undefined);
});

test("stores claim token hashes privately and validates their shape", () => {
  const asset = new JobPhotoUploadAsset({
    ...validAsset(),
    state: "uploading",
    claimTokenHash: "b".repeat(64),
    claimStartedAt: new Date(),
    claimExpiresAt: new Date(Date.now() + 120000),
  });

  assert.ifError(asset.validateSync());
  assert.equal(
    JobPhotoUploadAsset.schema.path("claimTokenHash").options.select,
    false,
  );

  const invalid = new JobPhotoUploadAsset({
    ...validAsset(),
    state: "uploading",
    claimTokenHash: "not-a-hash",
  });
  assert.ok(invalid.validateSync()?.errors.claimTokenHash);
});

test("rejects invalid owner generations, hashes, states, and MIME types", () => {
  const asset = new JobPhotoUploadAsset({
    ...validAsset(),
    clientPhotoId: "not-a-uuid",
    ownerVersion: 0,
    expectedSha256: "invalid",
    verifiedSha256: "B".repeat(64),
    verifiedMimeType: "image/gif",
    state: "reserved",
  });
  const error = asset.validateSync();

  assert.ok(error);
  assert.ok(error.errors.clientPhotoId);
  assert.ok(error.errors.ownerVersion);
  assert.ok(error.errors.expectedSha256);
  assert.ok(error.errors.verifiedSha256);
  assert.ok(error.errors.verifiedMimeType);
  assert.ok(error.errors.state);

  const fractionalOwnerVersion = new JobPhotoUploadAsset({
    ...validAsset(),
    ownerVersion: 1.5,
  });
  assert.ok(fractionalOwnerVersion.validateSync()?.errors.ownerVersion);
});

test("declares the generation, public ID, intent-state, and reconciliation indexes", () => {
  const indexes = JobPhotoUploadAsset.schema.indexes();
  const byName = new Map(indexes.map(([fields, options]) => [options.name, { fields, options }]));

  assert.deepEqual(byName.get("job_photo_upload_asset_intent_version").fields, {
    intentId: 1,
    ownerVersion: 1,
  });
  assert.equal(
    byName.get("job_photo_upload_asset_intent_version").options.unique,
    true,
  );
  assert.deepEqual(byName.get("job_photo_upload_asset_public_id").fields, {
    publicId: 1,
  });
  assert.equal(
    byName.get("job_photo_upload_asset_public_id").options.unique,
    true,
  );
  assert.deepEqual(byName.get("job_photo_upload_asset_intent_state").fields, {
    intentId: 1,
    state: 1,
  });
  assert.deepEqual(byName.get("job_photo_upload_asset_reconciliation").fields, {
    state: 1,
    createdAt: 1,
  });
  assert.equal(
    indexes.some(([, options]) => options.expireAfterSeconds !== undefined),
    false,
  );
  assert.equal(
    indexes.some(([fields]) => Object.hasOwn(fields, "expectedSha256")),
    false,
  );
});
