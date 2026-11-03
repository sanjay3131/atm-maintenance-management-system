import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import test from "node:test";
import Job from "../../src/modules/jobs/jobs.model.js";
import JobPhoto from "../../src/modules/jobPhotos/jobPhotos.model.js";
import JobPhotoUploadAsset from "../../src/modules/jobPhotos/jobPhotoUploadAsset.model.js";
import JobPhotoUploadIntent from "../../src/modules/jobPhotos/jobPhotoUploadIntent.model.js";
import { finalizeUploadIntent } from "../../src/modules/jobPhotos/jobPhotoUpload.service.js";

const expectedDatabaseName = "atm_job_photo_foundation_integration_test";
const testMongoUri = process.env.TEST_MONGODB_URI;
const enabled =
  testMongoUri && process.env.ALLOW_LOCAL_MONGODB_INTEGRATION_TESTS === "1";
let integrationTail = Promise.resolve();
const integrationTest = enabled
  ? (name, fn) =>
      test(name, async () => {
        const previous = integrationTail;
        let release;
        integrationTail = new Promise((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await fn();
        } finally {
          release();
        }
      })
  : (name, fn) => test(name, { skip: true }, fn);

const owned = {
  jobs: [],
  photos: [],
  intents: [],
  assets: [],
};

const assertSafeUri = (uri) => {
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, "mongodb:");
  assert.ok(["localhost", "127.0.0.1"].includes(parsed.hostname));
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.equal(decodeURIComponent(parsed.pathname.slice(1)), expectedDatabaseName);
  assert.deepEqual(parsed.searchParams.getAll("replicaSet"), ["rs0"]);
};

const createFixture = async ({
  status = "IN_PROGRESS",
  uploadedAt = new Date("2026-11-03T10:00:00.000Z"),
  completedAt,
  photoType = "before",
  existingBefore = 0,
  existingAfter = 0,
} = {}) => {
  const job = await Job.create({
    jobId: `FINALIZE-${new mongoose.Types.ObjectId()}`,
    title: "Finalization integration fixture",
    atmId: new mongoose.Types.ObjectId(),
    createdBy: new mongoose.Types.ObjectId(),
    assignedEmployeeId: new mongoose.Types.ObjectId(),
    status,
    ...(completedAt ? { completedAt } : {}),
    beforePhotos: [],
    afterPhotos: [],
  });
  for (const [type, count] of [
    ["before", existingBefore],
    ["after", existingAfter],
  ]) {
    for (let index = 0; index < count; index += 1) {
      const uploadIntentId = new mongoose.Types.ObjectId();
      const photo = await JobPhoto.create({
        jobId: job._id,
        uploadIntentId,
        atmId: job.atmId,
        photoType: type,
        publicId: `legacy/${job._id}/${type}/${uploadIntentId}`,
        url: `https://example.invalid/${type}-${index}.jpg`,
        originalName: `${type}-${index}.jpg`,
        size: 1024,
        mimeType: "image/jpeg",
        uploadedBy: job.assignedEmployeeId,
      });
      owned.photos.push(photo._id);
      owned.intents.push(uploadIntentId);
      job[type === "before" ? "beforePhotos" : "afterPhotos"].push(photo._id);
    }
  }
  if (existingBefore || existingAfter) await job.save();
  const owner = job.assignedEmployeeId;
  const intent = await JobPhotoUploadIntent.create({
    jobId: job._id,
    clientPhotoId: randomUUID(),
    ownerUserId: owner,
    currentOwnerUserId: owner,
    photoType,
    contentSha256: "a".repeat(64),
    byteSize: 1024,
    verifiedMimeType: "image/jpeg",
    originalName: "photo.jpg",
    state: "uploaded",
    uploadedAt,
    ownerTokenHash: "b".repeat(64),
    ownerVersion: 1,
  });
  const asset = await JobPhotoUploadAsset.create({
    intentId: intent._id,
    jobId: job._id,
    clientPhotoId: intent.clientPhotoId,
    photoType,
    ownerVersion: 1,
    publicId: `jobs/${job._id}/${photoType}/${intent._id}/v1`,
    secureUrl: "https://example.invalid/photo.jpg",
    expectedSha256: intent.contentSha256,
    verifiedSha256: intent.contentSha256,
    verifiedMimeType: intent.verifiedMimeType,
    cloudinaryBytes: intent.byteSize,
    state: "verified",
    uploadedAt,
    verifiedAt: uploadedAt,
  });
  owned.jobs.push(job._id);
  owned.intents.push(intent._id);
  owned.assets.push(asset._id);
  return { job, intent, asset };
};

const createAdditionalIntent = async (job, photoType) => {
  const uploadedAt = new Date("2026-11-03T10:00:00.000Z");
  const intent = await JobPhotoUploadIntent.create({
    jobId: job._id,
    clientPhotoId: randomUUID(),
    ownerUserId: job.assignedEmployeeId,
    currentOwnerUserId: job.assignedEmployeeId,
    photoType,
    contentSha256: "c".repeat(64),
    byteSize: 1024,
    verifiedMimeType: "image/jpeg",
    originalName: `${photoType}-additional.jpg`,
    state: "uploaded",
    uploadedAt,
    ownerTokenHash: "d".repeat(64),
    ownerVersion: 1,
  });
  const asset = await JobPhotoUploadAsset.create({
    intentId: intent._id,
    jobId: job._id,
    clientPhotoId: intent.clientPhotoId,
    photoType,
    ownerVersion: 1,
    publicId: `jobs/${job._id}/${photoType}/${intent._id}/v1`,
    secureUrl: "https://example.invalid/additional.jpg",
    expectedSha256: intent.contentSha256,
    verifiedSha256: intent.contentSha256,
    verifiedMimeType: intent.verifiedMimeType,
    cloudinaryBytes: intent.byteSize,
    state: "verified",
    uploadedAt,
    verifiedAt: uploadedAt,
  });
  owned.intents.push(intent._id);
  owned.assets.push(asset._id);
  return { intent, asset };
};

const connectLocalDatabase = async () => {
  assertSafeUri(testMongoUri);
  await mongoose.connect(testMongoUri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });
  await JobPhoto.syncIndexes();
};

const cleanupOwned = async () => {
  await JobPhoto.deleteMany({
    $or: [
      { uploadIntentId: { $in: owned.intents } },
      { _id: { $in: owned.photos } },
    ],
  });
  await JobPhotoUploadAsset.deleteMany({ _id: { $in: owned.assets } });
  await JobPhotoUploadIntent.deleteMany({ _id: { $in: owned.intents } });
  await Job.deleteMany({ _id: { $in: owned.jobs } });
  await mongoose.disconnect();
  owned.jobs.length = 0;
  owned.photos.length = 0;
  owned.intents.length = 0;
  owned.assets.length = 0;
};

integrationTest("finalization is durable and idempotent on a replica set", async () => {
  assertSafeUri(testMongoUri);
  await mongoose.connect(testMongoUri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });

  const runLastSlotRace = async ({
    photoType,
    existingBefore,
    existingAfter,
    expectedBefore,
    expectedAfter,
  }) => {
    await connectLocalDatabase();
    try {
      const fixture = await createFixture({
        existingBefore,
        existingAfter,
        photoType,
      });
      const competing = await createAdditionalIntent(fixture.job, photoType);
      const outcomes = await Promise.allSettled(
        [fixture.intent, competing.intent].map((intent) =>
          finalizeUploadIntent({
            jobId: fixture.job._id,
            uploadIntentId: intent._id,
            userId: fixture.job.assignedEmployeeId,
            userType: "employee",
          }),
        ),
      );
      const successful = outcomes.filter(
        (outcome) => outcome.status === "fulfilled",
      );
      assert.equal(successful.length, 1);
      assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);

      const job = await Job.findById(fixture.job._id);
      const photos = await JobPhoto.find({ jobId: fixture.job._id });
      assert.equal(job.beforePhotos.length, expectedBefore);
      assert.equal(job.afterPhotos.length, expectedAfter);
      assert.ok(job.beforePhotos.length <= 3);
      assert.ok(job.afterPhotos.length <= 3);
      assert.ok(photos.length <= 6);
      for (const photoId of [...job.beforePhotos, ...job.afterPhotos]) {
        assert.ok(photos.some((photo) => photo._id.equals(photoId)));
      }

      const successfulIntentId = successful[0].value.intent._id;
      const losingIntent = [fixture.intent, competing.intent].find(
        (intent) => !intent._id.equals(successfulIntentId),
      );
      assert.equal(
        await JobPhoto.countDocuments({ uploadIntentId: losingIntent._id }),
        0,
      );
    } finally {
      await cleanupOwned();
    }
  };

  integrationTest("different intents serialize for the last before-photo slot", async () => {
    await runLastSlotRace({
      photoType: "before",
      existingBefore: 2,
      existingAfter: 0,
      expectedBefore: 3,
      expectedAfter: 0,
    });
  });

  integrationTest("different intents serialize for the last after-photo slot", async () => {
    await runLastSlotRace({
      photoType: "after",
      existingBefore: 0,
      existingAfter: 2,
      expectedBefore: 0,
      expectedAfter: 3,
    });
  });

  integrationTest("different intents serialize for the last total-photo slot", async () => {
    await runLastSlotRace({
      photoType: "after",
      existingBefore: 3,
      existingAfter: 2,
      expectedBefore: 3,
      expectedAfter: 3,
    });
  });

  integrationTest("rejects an asset adopted by a different JobPhoto without partial writes", async () => {
    await connectLocalDatabase();
    try {
      const fixture = await createFixture();
      await JobPhotoUploadAsset.updateOne(
        { _id: fixture.asset._id },
        {
          $set: {
            state: "adopted",
            adoptedJobPhotoId: new mongoose.Types.ObjectId(),
          },
        },
      );
      await assert.rejects(
        finalizeUploadIntent({
          jobId: fixture.job._id,
          uploadIntentId: fixture.intent._id,
          userId: fixture.job.assignedEmployeeId,
          userType: "employee",
        }),
        /already adopted/,
      );
      const [job, photos] = await Promise.all([
        Job.findById(fixture.job._id),
        JobPhoto.find({ uploadIntentId: fixture.intent._id }),
      ]);
      assert.deepEqual(job.beforePhotos, []);
      assert.equal(photos.length, 0);
    } finally {
      await cleanupOwned();
    }
  });

  for (const [label, update] of [
    ["intent", { intentId: new mongoose.Types.ObjectId() }],
    ["Job", { jobId: new mongoose.Types.ObjectId() }],
    ["ownerVersion", { ownerVersion: 2 }],
  ]) {
    integrationTest(`rejects an asset with mismatched ${label} atomically`, async () => {
      await connectLocalDatabase();
      try {
        const fixture = await createFixture();
        await JobPhotoUploadAsset.updateOne({ _id: fixture.asset._id }, { $set: update });
        await assert.rejects(
          finalizeUploadIntent({
            jobId: fixture.job._id,
            uploadIntentId: fixture.intent._id,
            userId: fixture.job.assignedEmployeeId,
            userType: "employee",
          }),
          /asset is missing|asset does not match/,
        );
        const [job, photos] = await Promise.all([
          Job.findById(fixture.job._id),
          JobPhoto.find({ uploadIntentId: fixture.intent._id }),
        ]);
        assert.deepEqual(job.beforePhotos, []);
        assert.equal(photos.length, 0);
      } finally {
        await cleanupOwned();
      }
    });
  }
  try {
    await JobPhoto.syncIndexes();
    const fixture = await createFixture();
    const first = await finalizeUploadIntent({
      jobId: fixture.job._id,
      uploadIntentId: fixture.intent._id,
      userId: fixture.intent.currentOwnerUserId,
      userType: "employee",
    });
    const second = await finalizeUploadIntent({
      jobId: fixture.job._id,
      uploadIntentId: fixture.intent._id,
      userId: fixture.intent.currentOwnerUserId,
      userType: "employee",
    });

    assert.equal(first.jobPhoto._id.toString(), second.jobPhoto._id.toString());
    const [intent, job, photos, asset] = await Promise.all([
      JobPhotoUploadIntent.findById(fixture.intent._id),
      Job.findById(fixture.job._id),
      JobPhoto.find({ uploadIntentId: fixture.intent._id }),
      JobPhotoUploadAsset.findById(fixture.asset._id),
    ]);
    assert.equal(intent.state, "finalized");
    assert.equal(job.beforePhotos.length, 1);
    assert.equal(photos.length, 1);
    assert.equal(asset.state, "adopted");
    assert.equal(asset.adoptedJobPhotoId.toString(), photos[0]._id.toString());
  } finally {
    await JobPhoto.deleteMany({ uploadIntentId: { $in: owned.intents } });
    await JobPhotoUploadAsset.deleteMany({ _id: { $in: owned.assets } });
    await JobPhotoUploadIntent.deleteMany({ _id: { $in: owned.intents } });
    await Job.deleteMany({ _id: { $in: owned.jobs } });
    await mongoose.disconnect();
    owned.jobs.length = 0;
    owned.photos.length = 0;
    owned.intents.length = 0;
    owned.assets.length = 0;
  }
});

integrationTest("completed Job recovery requires upload before completion", async () => {
  assertSafeUri(testMongoUri);
  await mongoose.connect(testMongoUri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });
  try {
    const fixture = await createFixture({
      status: "COMPLETED",
      uploadedAt: new Date("2026-11-03T12:00:00.000Z"),
      completedAt: new Date("2026-11-03T11:00:00.000Z"),
    });
    await assert.rejects(
      finalizeUploadIntent({
        jobId: fixture.job._id,
        uploadIntentId: fixture.intent._id,
        userId: fixture.intent.currentOwnerUserId,
        userType: "employee",
      }),
      /did not complete before/,
    );
  } finally {
    await JobPhoto.deleteMany({ uploadIntentId: { $in: owned.intents } });
    await JobPhotoUploadAsset.deleteMany({ _id: { $in: owned.assets } });
    await JobPhotoUploadIntent.deleteMany({ _id: { $in: owned.intents } });
    await Job.deleteMany({ _id: { $in: owned.jobs } });
    await mongoose.disconnect();
    owned.jobs.length = 0;
    owned.photos.length = 0;
    owned.intents.length = 0;
    owned.assets.length = 0;
  }
});

integrationTest("concurrent finalization of one intent resolves to one JobPhoto", async () => {
  assertSafeUri(testMongoUri);
  await mongoose.connect(testMongoUri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });
  try {
    const fixture = await createFixture();
    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        finalizeUploadIntent({
          jobId: fixture.job._id,
          uploadIntentId: fixture.intent._id,
          userId: fixture.intent.currentOwnerUserId,
          userType: "employee",
        }),
      ),
    );
    const successful = outcomes.filter(
      (outcome) => outcome.status === "fulfilled",
    );
    assert.equal(successful.length, 2);
    assert.equal(
      successful[0].value.jobPhoto._id.toString(),
      successful[1].value.jobPhoto._id.toString(),
    );
    assert.equal(
      await JobPhoto.countDocuments({ uploadIntentId: fixture.intent._id }),
      1,
    );
  } finally {
    await JobPhoto.deleteMany({ uploadIntentId: { $in: owned.intents } });
    await JobPhotoUploadAsset.deleteMany({ _id: { $in: owned.assets } });
    await JobPhotoUploadIntent.deleteMany({ _id: { $in: owned.intents } });
    await Job.deleteMany({ _id: { $in: owned.jobs } });
    await mongoose.disconnect();
    owned.jobs.length = 0;
    owned.photos.length = 0;
    owned.intents.length = 0;
    owned.assets.length = 0;
  }
});
