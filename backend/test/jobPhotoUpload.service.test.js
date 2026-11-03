import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import cloudinary from "../src/config/cloudinary.js";
import {
  buildPublicId,
  calculateSha256,
  claimAssetAttempt,
  detectImageMime,
  downloadAndVerify,
  getCurrentLiveIntent,
  reserveUploadIntent,
  uploadOrReconcileAsset,
  validateUploadedFile,
} from "../src/modules/jobPhotos/jobPhotoUpload.service.js";
import JobPhotoUploadIntent from "../src/modules/jobPhotos/jobPhotoUploadIntent.model.js";
import JobPhotoUploadAsset from "../src/modules/jobPhotos/jobPhotoUploadAsset.model.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const webp = Buffer.from("RIFF0000WEBP", "ascii");

test("calculates SHA-256 from the actual uploaded bytes", () => {
  const expected = createHash("sha256").update(jpeg).digest("hex");
  assert.equal(calculateSha256(jpeg), expected);
});

test("detects supported image signatures", () => {
  assert.equal(detectImageMime(jpeg).mimeType, "image/jpeg");
  assert.equal(detectImageMime(png).mimeType, "image/png");
  assert.equal(detectImageMime(webp).mimeType, "image/webp");
});

test("rejects declared MIME mismatches and malformed bytes", () => {
  assert.throws(
    () => validateUploadedFile({
      buffer: jpeg,
      mimetype: "image/png",
      originalname: "photo.png",
    }),
    /declared file type/,
  );
  assert.throws(
    () => validateUploadedFile({
      buffer: Buffer.from("not-an-image"),
      mimetype: "image/jpeg",
      originalname: "photo.jpg",
    }),
    /malformed or unsupported/,
  );
});

const intentQuery = (value) => ({
  select: async () => value,
  session() {
    return this;
  },
});

const runTransaction = async (operation) => operation({});

const reservationMetadata = {
  jobId: "64b000000000000000000031",
  clientPhotoId: "7d6f1c1a-6c8e-4e51-9c2a-0b1c2d3e4f50",
  photoType: "before",
  contentSha256: "a".repeat(64),
  byteSize: 1024,
  mimeType: "image/jpeg",
  originalName: "before.jpg",
};

test("reserves a new generation with original and current owners", async () => {
  const ownerUserId = "64b000000000000000000032";
  const created = {
    _id: "64b000000000000000000034",
    ...reservationMetadata,
    verifiedMimeType: reservationMetadata.mimeType,
    ownerUserId,
    currentOwnerUserId: ownerUserId,
    ownerVersion: 1,
    ownerTokenHash: "b".repeat(64),
    leaseExpiresAt: new Date(Date.now() + 600000),
    state: "reserved",
  };
  const originals = [
    [JobPhotoUploadIntent, "findOne", JobPhotoUploadIntent.findOne],
    [JobPhotoUploadIntent, "create", JobPhotoUploadIntent.create],
  ];
  JobPhotoUploadIntent.findOne = () => intentQuery(null);
  JobPhotoUploadIntent.create = async () => created;
  try {
    const result = await reserveUploadIntent({
      ...reservationMetadata,
      ownerUserId,
      metadata: reservationMetadata,
    });
    assert.equal(result.replay, false);
    assert.equal(result.intent.ownerUserId, ownerUserId);
    assert.equal(result.intent.currentOwnerUserId, ownerUserId);
    assert.equal(result.intent.ownerVersion, 1);
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
});

test("rejects active takeover and increments exactly once after expiry", async () => {
  const originalOwner = "64b000000000000000000032";
  const otherUser = "64b000000000000000000037";
  const active = {
    _id: "64b000000000000000000034",
    ...reservationMetadata,
    verifiedMimeType: reservationMetadata.mimeType,
    ownerUserId: originalOwner,
    currentOwnerUserId: originalOwner,
    ownerVersion: 1,
    ownerTokenHash: "b".repeat(64),
    leaseExpiresAt: new Date(Date.now() + 600000),
    state: "reserved",
  };
  const expired = {
    ...active,
    leaseExpiresAt: new Date(Date.now() - 1),
  };
  const updated = {
    ...expired,
    currentOwnerUserId: otherUser,
    ownerVersion: 2,
    ownerTokenHash: "c".repeat(64),
    leaseExpiresAt: new Date(Date.now() + 600000),
  };
  const originals = [
    [JobPhotoUploadIntent, "findOne", JobPhotoUploadIntent.findOne],
    [JobPhotoUploadIntent, "findOneAndUpdate", JobPhotoUploadIntent.findOneAndUpdate],
  ];
  JobPhotoUploadIntent.findOne = () => intentQuery(active);
  try {
    await assert.rejects(
      reserveUploadIntent({
        ...reservationMetadata,
        ownerUserId: otherUser,
        metadata: reservationMetadata,
        transactionRunner: runTransaction,
      }),
      /currently owned by another user/,
    );
    JobPhotoUploadIntent.findOne = () => intentQuery(expired);
    JobPhotoUploadIntent.findOneAndUpdate = () => intentQuery(updated);
    const result = await reserveUploadIntent({
      ...reservationMetadata,
      ownerUserId: otherUser,
      metadata: reservationMetadata,
      transactionRunner: runTransaction,
    });
    assert.equal(result.intent.ownerUserId, originalOwner);
    assert.equal(result.intent.currentOwnerUserId, otherUser);
    assert.equal(result.intent.ownerVersion, 2);
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
});

test("replays an active reservation using validator metadata", async () => {
  const ownerUserId = "64b000000000000000000032";
  const photoMetadata = {
    ...reservationMetadata,
    originalName: "photo",
  };
  const active = {
    _id: "64b000000000000000000034",
    ...photoMetadata,
    verifiedMimeType: photoMetadata.mimeType,
    originalName: photoMetadata.originalName,
    ownerUserId,
    currentOwnerUserId: ownerUserId,
    ownerVersion: 1,
    ownerTokenHash: "b".repeat(64),
    leaseExpiresAt: new Date(Date.now() + 600000),
    state: "reserved",
  };
  const originalFindOne = JobPhotoUploadIntent.findOne;
  JobPhotoUploadIntent.findOne = () => intentQuery(active);
  try {
    const result = await reserveUploadIntent({
      ...photoMetadata,
      ownerUserId,
      metadata: photoMetadata,
    });
    assert.equal(result.replay, true);
    assert.equal(result.intent.currentOwnerUserId, ownerUserId);
    assert.equal(result.intent.ownerVersion, 1);
  } finally {
    JobPhotoUploadIntent.findOne = originalFindOne;
  }
});

test("rejects malformed original names before reading or creating an intent", async () => {
  const originalFindOne = JobPhotoUploadIntent.findOne;
  const originalCreate = JobPhotoUploadIntent.create;
  const invalidNames = [undefined, null, "", "   "];
  JobPhotoUploadIntent.findOne = () => {
    throw new Error("intent lookup should not run");
  };
  JobPhotoUploadIntent.create = async () => {
    throw new Error("intent creation should not run");
  };
  try {
    for (const originalName of invalidNames) {
      await assert.rejects(
        reserveUploadIntent({
          ...reservationMetadata,
          ownerUserId: "64b000000000000000000032",
          metadata: {
            ...reservationMetadata,
            originalName,
          },
        }),
        /originalName must be a non-empty string/,
        String(originalName),
      );
    }
  } finally {
    JobPhotoUploadIntent.findOne = originalFindOne;
    JobPhotoUploadIntent.create = originalCreate;
  }
});

test("rejects immutable metadata changes for an existing reservation", async () => {
  const ownerUserId = "64b000000000000000000032";
  const active = {
    _id: "64b000000000000000000034",
    ...reservationMetadata,
    verifiedMimeType: reservationMetadata.mimeType,
    ownerUserId,
    currentOwnerUserId: ownerUserId,
    ownerVersion: 1,
    ownerTokenHash: "b".repeat(64),
    leaseExpiresAt: new Date(Date.now() + 600000),
    state: "reserved",
  };
  const mismatches = [
    ["mimeType", "image/png"],
    ["photoType", "after"],
    ["contentSha256", "b".repeat(64)],
    ["byteSize", 2048],
    ["originalName", "after.jpg"],
  ];
  const originalFindOne = JobPhotoUploadIntent.findOne;
  JobPhotoUploadIntent.findOne = () => intentQuery(active);
  try {
    for (const [field, value] of mismatches) {
      await assert.rejects(
        reserveUploadIntent({
          ...reservationMetadata,
          [field]: value,
          ownerUserId,
          metadata: {
            ...reservationMetadata,
            [field]: value,
          },
        }),
        /different photo data/,
        field,
      );
    }
  } finally {
    JobPhotoUploadIntent.findOne = originalFindOne;
  }
});

test("builds generation-specific deterministic Cloudinary public IDs", () => {
  assert.equal(
    buildPublicId({
      jobId: "job-1",
      photoType: "before",
      intentId: "intent-1",
      ownerVersion: 2,
    }),
    "jobs/job-1/before/intent-1/v2",
  );
});

const responseFor = (chunks, headers = {}) => ({
  ok: true,
  headers: { get: (name) => headers[name] ?? null },
  body: new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }),
});

test("bounds reconciliation downloads without Content-Length", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    responseFor([Buffer.alloc(5 * 1024 * 1024 + 1)]);
  try {
    await assert.rejects(
      downloadAndVerify(
        { secure_url: "https://cloudinary.invalid/large" },
        "a".repeat(64),
        "image/jpeg",
      ),
      /exceeds the allowed size/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects interrupted and timed-out reconciliation downloads", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          async read() {
            throw new Error("connection interrupted");
          },
        };
      },
    },
  });

  try {
    await assert.rejects(
      downloadAndVerify(
        { secure_url: "https://cloudinary.invalid/interrupted" },
        "a".repeat(64),
        "image/jpeg",
      ),
      /connection interrupted/,
    );
    globalThis.fetch = async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    };
    await assert.rejects(
      downloadAndVerify(
        { secure_url: "https://cloudinary.invalid/timeout" },
        "a".repeat(64),
        "image/jpeg",
      ),
      /timed out/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reclaims an expired asset claim but not a live claim", async () => {
    const asset = {
      _id: "64b000000000000000000035",
      intentId: "64b000000000000000000034",
      ownerVersion: 1,
      state: "uploading",
      claimExpiresAt: new Date(1000),
    };
    const claimed = {
      ...asset,
      state: "uploading",
      claimExpiresAt: new Date(3000),
    };
    const originalUpdate = JobPhotoUploadAsset.findOneAndUpdate;
    const originalFind = JobPhotoUploadAsset.findOne;
    let updateCalls = 0;
    JobPhotoUploadAsset.findOneAndUpdate = async () => {
      updateCalls += 1;
      return updateCalls === 1 ? claimed : null;
    };
    JobPhotoUploadAsset.findOne = async () => ({
      ...asset,
      claimExpiresAt: new Date(3000),
});

    try {
      assert.equal(
        await claimAssetAttempt(asset, new Date(2000)),
        claimed,
      );
      await assert.rejects(
        claimAssetAttempt(
          { ...asset, claimExpiresAt: new Date(3000) },
          new Date(2000),
        ),
        (error) => error.uploadInProgress === true,
      );
    } finally {
      JobPhotoUploadAsset.findOneAndUpdate = originalUpdate;
      JobPhotoUploadAsset.findOne = originalFind;
    }
  });

test("reconciles an expired claim from an existing matching Cloudinary asset", async () => {
    const fileBuffer = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
    const intent = {
      _id: "64b000000000000000000034",
      jobId: "64b000000000000000000031",
      clientPhotoId: reservationMetadata.clientPhotoId,
      currentOwnerUserId: "64b000000000000000000032",
      ownerVersion: 1,
      ownerTokenHash: "b".repeat(64),
      leaseExpiresAt: new Date(Date.now() + 600000),
      state: "uploading",
      contentSha256: calculateSha256(fileBuffer),
      verifiedMimeType: "image/jpeg",
      photoType: "before",
    };
    const asset = {
      _id: "64b000000000000000000035",
      intentId: intent._id,
      ownerVersion: 1,
      state: "uploading",
      claimExpiresAt: new Date(Date.now() - 1),
      uploadedAt: new Date(),
    };
    const verified = { ...asset, state: "verified", publicId: buildPublicId({
      jobId: intent.jobId,
      photoType: intent.photoType,
      intentId: intent._id,
      ownerVersion: intent.ownerVersion,
    }), verifiedSha256: intent.contentSha256 };
    const originals = [
      [JobPhotoUploadIntent, "findOne", JobPhotoUploadIntent.findOne],
      [JobPhotoUploadIntent, "findOneAndUpdate", JobPhotoUploadIntent.findOneAndUpdate],
      [JobPhotoUploadAsset, "findOne", JobPhotoUploadAsset.findOne],
      [JobPhotoUploadAsset, "findOneAndUpdate", JobPhotoUploadAsset.findOneAndUpdate],
      [cloudinary.api, "resource", cloudinary.api.resource],
    ];
    const originalFetch = globalThis.fetch;
    JobPhotoUploadIntent.findOne = () => intentQuery(intent);
    JobPhotoUploadIntent.findOneAndUpdate = () => intentQuery(intent);
    JobPhotoUploadAsset.findOne = async () => asset;
    JobPhotoUploadAsset.findOneAndUpdate = async (filter) =>
      filter.state === "uploading" ? { ...asset, claimExpiresAt: new Date(Date.now() + 120000) } : verified;
    cloudinary.api.resource = async () => ({
      secure_url: "https://cloudinary.invalid/existing",
      format: "jpg",
    });

    globalThis.fetch = async () =>
      responseFor([fileBuffer], {
        "content-type": "image/jpeg",
        "content-length": String(fileBuffer.length),
      });
    try {
      const result = await uploadOrReconcileAsset({
        intent,
        file: { buffer: fileBuffer },
        metadata: {
          contentSha256: intent.contentSha256,
          mimeType: "image/jpeg",
          format: "jpg",
        },
        transactionRunner: runTransaction,
      });
      assert.equal(result.verifiedSha256, intent.contentSha256);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [target, key, original] of originals) target[key] = original;
    }
  });

test("only one concurrent request can claim an unknown asset attempt", async () => {
    const asset = {
      _id: "64b000000000000000000035",
      intentId: "64b000000000000000000034",
      ownerVersion: 1,
      state: "unknown",
    };
    const claimed = {
      ...asset,
      state: "uploading",
      claimExpiresAt: new Date(Date.now() + 120000),
    };
    const originalUpdate = JobPhotoUploadAsset.findOneAndUpdate;
    const originalFind = JobPhotoUploadAsset.findOne;
    let calls = 0;
    JobPhotoUploadAsset.findOneAndUpdate = async () => {
      calls += 1;
      return calls === 1 ? claimed : null;
    };
    JobPhotoUploadAsset.findOne = async () => claimed;
    try {
      const results = await Promise.allSettled([
        claimAssetAttempt(asset),
        claimAssetAttempt(asset),
      ]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        results.filter(
          (result) =>
            result.status === "rejected" &&
            result.reason.uploadInProgress === true,
        ).length,
        1,
      );
    } finally {
      JobPhotoUploadAsset.findOneAndUpdate = originalUpdate;
      JobPhotoUploadAsset.findOne = originalFind;
    }
  });

test("stale generations are rejected before asset verification can continue", async () => {
    const originalFindOne = JobPhotoUploadIntent.findOne;
    JobPhotoUploadIntent.findOne = () => intentQuery(null);
    try {
      await assert.rejects(
        getCurrentLiveIntent({
          _id: "64b000000000000000000034",
          currentOwnerUserId: "64b000000000000000000032",
          ownerVersion: 1,
          ownerTokenHash: "b".repeat(64),
        }, ["uploading"]),
        /lease is no longer active/,
      );
    } finally {
      JobPhotoUploadIntent.findOne = originalFindOne;
    }
});

test("uploads once after reclaim when the deterministic Cloudinary asset is absent", async () => {
  const fileBuffer = Buffer.from([0xff, 0xd8, 0xff, 0x02]);
  const intent = {
    _id: "64b000000000000000000034",
    jobId: "64b000000000000000000031",
    clientPhotoId: reservationMetadata.clientPhotoId,
    currentOwnerUserId: "64b000000000000000000032",
    ownerVersion: 1,
    ownerTokenHash: "b".repeat(64),
    leaseExpiresAt: new Date(Date.now() + 600000),
    state: "uploading",
    contentSha256: calculateSha256(fileBuffer),
    verifiedMimeType: "image/jpeg",
    photoType: "before",
  };
  const asset = {
    _id: "64b000000000000000000035",
    intentId: intent._id,
    ownerVersion: 1,
    state: "uploading",
    claimExpiresAt: new Date(Date.now() - 1),
    uploadedAt: new Date(),
  };
  const publicId = buildPublicId({
    jobId: intent.jobId,
    photoType: intent.photoType,
    intentId: intent._id,
    ownerVersion: intent.ownerVersion,
  });
  const originals = [
    [JobPhotoUploadIntent, "findOne", JobPhotoUploadIntent.findOne],
    [JobPhotoUploadIntent, "findOneAndUpdate", JobPhotoUploadIntent.findOneAndUpdate],
    [JobPhotoUploadAsset, "findOne", JobPhotoUploadAsset.findOne],
    [JobPhotoUploadAsset, "findOneAndUpdate", JobPhotoUploadAsset.findOneAndUpdate],
    [cloudinary.api, "resource", cloudinary.api.resource],
    [cloudinary.uploader, "upload_stream", cloudinary.uploader.upload_stream],
  ];
  const originalFetch = globalThis.fetch;
  let uploadCount = 0;
  JobPhotoUploadIntent.findOne = () => intentQuery(intent);
  JobPhotoUploadIntent.findOneAndUpdate = () => intentQuery(intent);
  JobPhotoUploadAsset.findOne = async () => asset;
  JobPhotoUploadAsset.findOneAndUpdate = async (_filter, update) =>
    update.$set.state === "uploading"
      ? { ...asset, state: "uploading", claimExpiresAt: new Date(Date.now() + 120000) }
      : { ...asset, state: "verified", publicId, verifiedSha256: intent.contentSha256 };
  cloudinary.api.resource = async () => {
    const error = new Error("not found");
    error.http_code = 404;
    throw error;
  };
  cloudinary.uploader.upload_stream = (_options, callback) => ({
    end() {
      uploadCount += 1;
      callback(null, {
        public_id: publicId,
        secure_url: "https://cloudinary.invalid/new",
        format: "jpg",
      });
    },
  });
  globalThis.fetch = async () =>
    responseFor([fileBuffer], {
      "content-type": "image/jpeg",
      "content-length": String(fileBuffer.length),
    });
  try {
    await uploadOrReconcileAsset({
      intent,
      file: { buffer: fileBuffer },
      metadata: {
        contentSha256: intent.contentSha256,
        mimeType: "image/jpeg",
        format: "jpg",
      },
      transactionRunner: runTransaction,
    });
    assert.equal(uploadCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [target, key, original] of originals) target[key] = original;
  }
});
