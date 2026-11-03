import assert from "node:assert/strict";
import mongoose from "mongoose";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import JobPhotoUploadIntent from "../../src/modules/jobPhotos/jobPhotoUploadIntent.model.js";
import JobPhotoUploadAsset from "../../src/modules/jobPhotos/jobPhotoUploadAsset.model.js";
import {
  markAssetOrphaned,
  markAssetReconciliationRequired,
  markAssetVerified,
  releaseAssetClaim,
  renewAssetClaim,
  reserveUploadIntent,
} from "../../src/modules/jobPhotos/jobPhotoUpload.service.js";

const expectedDatabaseName = "atm_job_photo_foundation_integration_test";
const testMongoUri = process.env.TEST_MONGODB_URI;
const enabled =
  testMongoUri && process.env.ALLOW_LOCAL_MONGODB_INTEGRATION_TESTS === "1";
const integrationTest = enabled ? test : test.skip;
const hash = (value) => createHash("sha256").update(value).digest("hex");

const assertSafeUri = (uri) => {
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, "mongodb:");
  assert.ok(["localhost", "127.0.0.1"].includes(parsed.hostname));
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.equal(decodeURIComponent(parsed.pathname.slice(1)), expectedDatabaseName);
  assert.deepEqual(parsed.searchParams.getAll("replicaSet"), ["rs0"]);
};

const createFixture = async () => {
  const owner = new mongoose.Types.ObjectId();
  const intent = await JobPhotoUploadIntent.create({
    jobId: new mongoose.Types.ObjectId(),
    clientPhotoId: randomUUID(),
    ownerUserId: owner,
    currentOwnerUserId: owner,
    photoType: "before",
    contentSha256: "a".repeat(64),
    byteSize: 1024,
    verifiedMimeType: "image/jpeg",
    originalName: "photo.jpg",
    state: "uploading",
    ownerTokenHash: hash("owner"),
    ownerVersion: 1,
    assetClaimFenceVersion: 0,
    leaseExpiresAt: new Date(Date.now() + 600_000),
  });
  const assets = await JobPhotoUploadAsset.create(
    [1, 2].map((number) => ({
      intentId: intent._id,
      jobId: intent.jobId,
      clientPhotoId: intent.clientPhotoId,
      photoType: intent.photoType,
      ownerVersion: 1,
      publicId: `jobs/${intent.jobId}/before/${intent._id}/v1-${number}`,
      expectedSha256: intent.contentSha256,
      state: "uploading",
      claimStartedAt: new Date(),
      claimExpiresAt: new Date(Date.now() + 120_000),
      claimTokenHash: hash(`claim-${number}`),
    })),
  );
  return { intent, assets };
};

integrationTest("two asset heartbeats serialize and both succeed", async () => {
  assertSafeUri(testMongoUri);
  await mongoose.connect(testMongoUri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });
  let fixture;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.equal(hello.setName, "rs0");
    assert.equal(hello.isWritablePrimary, true);
    fixture = await createFixture();
    const intent = await JobPhotoUploadIntent.findById(fixture.intent._id)
      .select("+ownerTokenHash");
    await Promise.all(
      fixture.assets.map((asset, index) =>
        renewAssetClaim(intent, {
          asset,
          claimTokenHash: hash(`claim-${index + 1}`),
          intentId: intent._id,
          ownerVersion: 1,
        }),
      ),
    );
    const refreshed = await JobPhotoUploadIntent.findById(intent._id).select(
      "+assetClaimFenceVersion",
    );
    assert.equal(refreshed.assetClaimFenceVersion, 2);
  } finally {
    if (fixture) {
      await JobPhotoUploadAsset.deleteMany({ intentId: fixture.intent._id });
      await JobPhotoUploadIntent.deleteOne({ _id: fixture.intent._id });
    }
    await mongoose.disconnect();
  }
});

integrationTest("asset failure rolls back the parent fence increment", async () => {
  assertSafeUri(testMongoUri);
  await mongoose.connect(testMongoUri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });
  let fixture;
  try {
    fixture = await createFixture();
    const intent = await JobPhotoUploadIntent.findById(fixture.intent._id)
      .select("+ownerTokenHash");
    await assert.rejects(
      renewAssetClaim(intent, {
        asset: fixture.assets[0],
        claimTokenHash: hash("wrong-token"),
        intentId: intent._id,
        ownerVersion: 1,
      }),
      /claim/,
    );
    const refreshed = await JobPhotoUploadIntent.findById(intent._id).select(
      "+assetClaimFenceVersion",
    );
    assert.equal(refreshed.assetClaimFenceVersion, 0);
  } finally {
    if (fixture) {
      await JobPhotoUploadAsset.deleteMany({ intentId: fixture.intent._id });
      await JobPhotoUploadIntent.deleteOne({ _id: fixture.intent._id });
    }
    await mongoose.disconnect();
  }
});

integrationTest("takeover fences the old owner generation", async () => {
  assertSafeUri(testMongoUri);
  await mongoose.connect(testMongoUri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });
  let fixture;
  try {
    fixture = await createFixture();
    const oldIntent = await JobPhotoUploadIntent.findById(fixture.intent._id)
      .select("+ownerTokenHash");
    await JobPhotoUploadIntent.updateOne(
      { _id: oldIntent._id },
      { $set: { leaseExpiresAt: new Date(Date.now() - 1) } },
    );
    const newOwner = new mongoose.Types.ObjectId();
    const takeover = await reserveUploadIntent({
      jobId: oldIntent.jobId,
      clientPhotoId: oldIntent.clientPhotoId,
      ownerUserId: newOwner,
      photoType: oldIntent.photoType,
      metadata: {
        contentSha256: oldIntent.contentSha256,
        byteSize: oldIntent.byteSize,
        mimeType: oldIntent.verifiedMimeType,
        originalName: oldIntent.originalName,
      },
    });
    assert.equal(takeover.intent.ownerVersion, 2);
    const refreshed = await JobPhotoUploadIntent.findById(oldIntent._id).select(
      "+assetClaimFenceVersion",
    );
    assert.equal(refreshed.assetClaimFenceVersion, 1);
    await assert.rejects(
      renewAssetClaim(oldIntent, {
        asset: fixture.assets[0],
        claimTokenHash: hash("claim-1"),
        intentId: oldIntent._id,
        ownerVersion: 1,
      }),
      /claim/,
    );
  } finally {
    if (fixture) {
      await JobPhotoUploadAsset.deleteMany({ intentId: fixture.intent._id });
      await JobPhotoUploadIntent.deleteOne({ _id: fixture.intent._id });
    }
    await mongoose.disconnect();
  }
});

integrationTest("takeover fences every terminal asset mutation", async () => {
  assertSafeUri(testMongoUri);
  await mongoose.connect(testMongoUri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });
  const mutations = [
    {
      name: "verified transition",
      state: "uploading",
      invoke: (intent, asset) =>
        markAssetVerified(
          intent,
          {
            asset,
            intentId: intent._id,
            ownerVersion: 1,
            claimTokenHash: hash("claim-1"),
          },
          {
            byteSize: 4,
            verifiedSha256: intent.contentSha256,
            verifiedMimeType: intent.verifiedMimeType,
          },
          { publicId: asset.publicId },
        ),
    },
    {
      name: "orphaning",
      state: "uploading",
      invoke: (intent, asset) =>
        markAssetOrphaned(intent, {
          asset,
          intentId: intent._id,
          ownerVersion: 1,
          claimTokenHash: hash("claim-1"),
        }),
    },
    {
      name: "reconciliation-required",
      state: "uploading",
      invoke: (intent, asset) =>
        markAssetReconciliationRequired(
          intent,
          {
            asset,
            intentId: intent._id,
            ownerVersion: 1,
            claimTokenHash: hash("claim-1"),
          },
          "verification_required",
        ),
    },
    {
      name: "claim release",
      state: "verified",
      invoke: (intent, asset) =>
        releaseAssetClaim(intent, {
          asset,
          intentId: intent._id,
          ownerVersion: 1,
          claimTokenHash: hash("claim-1"),
        }),
    },
  ];

  try {
    for (const mutation of mutations) {
      const fixture = await createFixture();
      const oldIntent = await JobPhotoUploadIntent.findById(fixture.intent._id)
        .select("+ownerTokenHash");
      await JobPhotoUploadAsset.updateOne(
        { _id: fixture.assets[0]._id },
        { $set: { state: mutation.state } },
      );
      await JobPhotoUploadIntent.updateOne(
        { _id: oldIntent._id },
        { $set: { leaseExpiresAt: new Date(Date.now() - 1) } },
      );
      await reserveUploadIntent({
        jobId: oldIntent.jobId,
        clientPhotoId: oldIntent.clientPhotoId,
        ownerUserId: new mongoose.Types.ObjectId(),
        photoType: oldIntent.photoType,
        metadata: {
          contentSha256: oldIntent.contentSha256,
          byteSize: oldIntent.byteSize,
          mimeType: oldIntent.verifiedMimeType,
          originalName: oldIntent.originalName,
        },
      });
      const staleIntent = oldIntent;
      const staleAsset = {
        ...fixture.assets[0].toObject(),
        state: mutation.state,
      };
      await assert.rejects(
        mutation.invoke(staleIntent, staleAsset),
        (error) => error.claimLost === true,
        mutation.name,
      );
      await JobPhotoUploadAsset.deleteMany({ intentId: fixture.intent._id });
      await JobPhotoUploadIntent.deleteOne({ _id: fixture.intent._id });
    }
  } finally {
    await mongoose.disconnect();
  }
});
