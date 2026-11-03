import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Job from "../src/modules/jobs/jobs.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import JobPhotoUploadIntent from "../src/modules/jobPhotos/jobPhotoUploadIntent.model.js";
import JobPhotoUploadAsset from "../src/modules/jobPhotos/jobPhotoUploadAsset.model.js";
import { finalizeUploadIntent } from "../src/modules/jobPhotos/jobPhotoUpload.service.js";

const jobId = new mongoose.Types.ObjectId();
const intentId = new mongoose.Types.ObjectId();
const ownerId = new mongoose.Types.ObjectId();
const assetId = new mongoose.Types.ObjectId();
const clientPhotoId = "7d6f1c1a-6c8e-4e51-9c2a-0b1c2d3e4f50";
const uploadedAt = new Date("2026-11-03T10:00:00.000Z");
const completedAt = new Date("2026-11-03T11:00:00.000Z");

const chain = (value) => ({
  session() {
    return this;
  },
  select() {
    return Promise.resolve(value);
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
  catch(reject) {
    return Promise.resolve(value).catch(reject);
  },
});

const createFixture = ({
  state = "uploaded",
  status = "IN_PROGRESS",
  revision,
  uploaded = uploadedAt,
  completed = null,
} = {}) => {
  const intent = {
    _id: intentId,
    jobId,
    clientPhotoId,
    currentOwnerUserId: ownerId,
    ownerUserId: ownerId,
    ownerVersion: 1,
    ownerTokenHash: "a".repeat(64),
    photoType: "before",
    contentSha256: "b".repeat(64),
    byteSize: 1024,
    verifiedMimeType: "image/jpeg",
    originalName: "before.jpg",
    uploadedAt: uploaded,
    state,
    finalizedJobPhotoId: null,
    finalizedAssetId: null,
    finalizedOwnerVersion: null,
  };
  const asset = {
    _id: assetId,
    intentId,
    jobId,
    clientPhotoId,
    photoType: "before",
    ownerVersion: 1,
    publicId: `jobs/${jobId}/before/${intentId}/v1`,
    secureUrl: "https://example.invalid/photo.jpg",
    state: "verified",
    adoptedJobPhotoId: null,
    verifiedSha256: "b".repeat(64),
    verifiedMimeType: "image/jpeg",
    cloudinaryBytes: 1024,
  };
  const job = {
    _id: jobId,
    atmId: new mongoose.Types.ObjectId(),
    assignedEmployeeId: ownerId,
    status,
    beforePhotos: [],
    afterPhotos: [],
    ...(revision === undefined
      ? {}
      : { photoFinalizationRevision: revision }),
    ...(completed ? { completedAt: completed } : {}),
  };
  return { intent, asset, job };
};

const installMocks = (fixture) => {
  const original = [
    [JobPhotoUploadIntent, "findById", JobPhotoUploadIntent.findById],
    [
      JobPhotoUploadIntent,
      "findOneAndUpdate",
      JobPhotoUploadIntent.findOneAndUpdate,
    ],
    [Job, "findById", Job.findById],
    [Job, "updateOne", Job.updateOne],
    [JobPhoto, "findOne", JobPhoto.findOne],
    [JobPhoto, "countDocuments", JobPhoto.countDocuments],
    [JobPhoto, "create", JobPhoto.create],
    [JobPhotoUploadAsset, "findOne", JobPhotoUploadAsset.findOne],
    [
      JobPhotoUploadAsset,
      "findOneAndUpdate",
      JobPhotoUploadAsset.findOneAndUpdate,
    ],
  ];
  let photo;

  JobPhotoUploadIntent.findById = () => chain(fixture.intent);
  JobPhotoUploadIntent.findOneAndUpdate = (_filter, update) => {
    fixture.intent = {
      ...fixture.intent,
      ...update.$set,
    };
    return chain(fixture.intent);
  };
  Job.findById = () => chain(fixture.job);
  Job.updateOne = (_filter, update) => {
    fixture.job = {
      ...fixture.job,
      beforePhotos: [...fixture.job.beforePhotos, update.$addToSet.beforePhotos],
      photoFinalizationRevision:
        (fixture.job.photoFinalizationRevision ?? 0) + 1,
    };
    return chain({ matchedCount: 1 });
  };
  JobPhoto.findOne = () => chain(photo);
  JobPhoto.countDocuments = () => chain(0);
  JobPhoto.create = async ([data]) => {
    photo = { _id: new mongoose.Types.ObjectId(), ...data };
    return [photo];
  };
  JobPhotoUploadAsset.findOne = () =>
    chain({
      ...fixture.asset,
      state: fixture.intent.state === "finalized" ? "adopted" : fixture.asset.state,
      adoptedJobPhotoId: fixture.asset.adoptedJobPhotoId,
    });
  JobPhotoUploadAsset.findOneAndUpdate = (_filter, update) => {
    fixture.asset = {
      ...fixture.asset,
      ...update.$set,
    };
    return chain({ ...fixture.asset, state: "adopted" });
  };

  return () => {
    for (const [model, key, value] of original) model[key] = value;
  };
};

test("finalizes a verified before photo and preserves a missing Job revision", async () => {
  const fixture = createFixture();
  const restore = installMocks(fixture);
  try {
    const result = await finalizeUploadIntent({
      jobId,
      uploadIntentId: intentId,
      userId: ownerId,
      userType: "employee",
      transactionRunner: async (operation) => operation({}),
    });

    assert.equal(result.intent.state, "finalized");
    assert.equal(result.jobPhoto.photoType, "before");
    assert.equal(fixture.job.beforePhotos.length, 1);
    assert.equal(fixture.job.photoFinalizationRevision, 1);
    assert.equal(fixture.intent.uploadedAt, uploadedAt);
    assert.equal(fixture.asset.state, "adopted");
  } finally {
    restore();
  }
});

test("repeated finalization returns the existing JobPhoto", async () => {
  const fixture = createFixture();
  const restore = installMocks(fixture);
  try {
    const first = await finalizeUploadIntent({
      jobId,
      uploadIntentId: intentId,
      userId: ownerId,
      userType: "employee",
      transactionRunner: async (operation) => operation({}),
    });
    const result = await finalizeUploadIntent({
      jobId,
      uploadIntentId: intentId,
      userId: ownerId,
      userType: "employee",
      transactionRunner: async (operation) => operation({}),
    });
    assert.equal(first.jobPhoto._id.toString(), result.jobPhoto._id.toString());
    assert.equal(result.intent.state, "finalized");
  } finally {
    restore();
  }
});

test("requires uploadedAt before recovering a completed Job", async () => {
  const fixture = createFixture({
    status: "COMPLETED",
    uploaded: new Date("2026-11-03T12:00:00.000Z"),
    completed: completedAt,
  });
  const restore = installMocks(fixture);
  try {
    await assert.rejects(
      finalizeUploadIntent({
        jobId,
        uploadIntentId: intentId,
        userId: ownerId,
        userType: "employee",
        transactionRunner: async (operation) => operation({}),
      }),
      /did not complete before/,
    );
  } finally {
    restore();
  }
});

test("allows recovery when upload completed before the Job", async () => {
  const fixture = createFixture({
    status: "COMPLETED",
    uploaded: uploadedAt,
    completed: completedAt,
  });
  const restore = installMocks(fixture);
  try {
    const result = await finalizeUploadIntent({
      jobId,
      uploadIntentId: intentId,
      userId: ownerId,
      userType: "employee",
      transactionRunner: async (operation) => operation({}),
    });
    assert.equal(result.intent.state, "finalized");
  } finally {
    restore();
  }
});

for (const [label, uploaded, completed] of [
  ["equal timestamps", completedAt, completedAt],
  ["missing uploadedAt", null, completedAt],
  ["invalid uploadedAt", new Date("invalid"), completedAt],
  ["missing completedAt", uploadedAt, null],
  ["invalid completedAt", uploadedAt, new Date("invalid")],
]) {
  test(`rejects completed recovery with ${label}`, async () => {
    const fixture = createFixture({
      status: "COMPLETED",
      uploaded,
      completed,
    });
    const restore = installMocks(fixture);
    try {
      await assert.rejects(
        finalizeUploadIntent({
          jobId,
          uploadIntentId: intentId,
          userId: ownerId,
          userType: "employee",
          transactionRunner: async (operation) => operation({}),
        }),
        /Completed Job recovery|did not complete before|no valid uploadedAt/,
      );
    } finally {
      restore();
    }
  });
}

test("rejects finalization after VERIFIED", async () => {
  const fixture = createFixture({ status: "VERIFIED" });
  const restore = installMocks(fixture);
  try {
    await assert.rejects(
      finalizeUploadIntent({
        jobId,
        uploadIntentId: intentId,
        userId: ownerId,
        userType: "employee",
        transactionRunner: async (operation) => operation({}),
      }),
      /Cannot finalize/,
    );
  } finally {
    restore();
  }
});

for (const status of ["APPROVED", "CLOSED"]) {
  test(`rejects finalization after ${status}`, async () => {
    const fixture = createFixture({ status });
    const restore = installMocks(fixture);
    try {
      await assert.rejects(
        finalizeUploadIntent({
          jobId,
          uploadIntentId: intentId,
          userId: ownerId,
          userType: "employee",
          transactionRunner: async (operation) => operation({}),
        }),
        /Cannot finalize/,
      );
    } finally {
      restore();
    }
  });
}

test("rejects a non-owner employee", async () => {
  const fixture = createFixture();
  const restore = installMocks(fixture);
  try {
    await assert.rejects(
      finalizeUploadIntent({
        jobId,
        uploadIntentId: intentId,
        userId: new mongoose.Types.ObjectId(),
        userType: "employee",
        transactionRunner: async (operation) => operation({}),
      }),
      /not authorized/,
    );
  } finally {
    restore();
  }
});

test("rejects an employee who is no longer assigned", async () => {
  const fixture = createFixture();
  fixture.job.assignedEmployeeId = new mongoose.Types.ObjectId();
  const restore = installMocks(fixture);
  try {
    await assert.rejects(
      finalizeUploadIntent({
        jobId,
        uploadIntentId: intentId,
        userId: ownerId,
        userType: "employee",
        transactionRunner: async (operation) => operation({}),
      }),
      /not authorized/,
    );
  } finally {
    restore();
  }
});

test("rejects an employee who is no longer the current owner", async () => {
  const fixture = createFixture();
  fixture.intent.currentOwnerUserId = new mongoose.Types.ObjectId();
  const restore = installMocks(fixture);
  try {
    await assert.rejects(
      finalizeUploadIntent({
        jobId,
        uploadIntentId: intentId,
        userId: ownerId,
        userType: "employee",
        transactionRunner: async (operation) => operation({}),
      }),
      /not authorized/,
    );
  } finally {
    restore();
  }
});

test("rejects a cross-Job intent request", async () => {
  const fixture = createFixture();
  const restore = installMocks(fixture);
  try {
    await assert.rejects(
      finalizeUploadIntent({
        jobId: new mongoose.Types.ObjectId(),
        uploadIntentId: intentId,
        userId: ownerId,
        userType: "employee",
        transactionRunner: async (operation) => operation({}),
      }),
      /Upload intent not found/,
    );
  } finally {
    restore();
  }
});

for (const userType of ["admin", "superAdmin"]) {
  test(`${userType} can finalize an authorized Job photo`, async () => {
    const fixture = createFixture();
    fixture.job.assignedEmployeeId = new mongoose.Types.ObjectId();
    const restore = installMocks(fixture);
    try {
      const result = await finalizeUploadIntent({
        jobId,
        uploadIntentId: intentId,
        userId: new mongoose.Types.ObjectId(),
        userType,
        transactionRunner: async (operation) => operation({}),
      });
      assert.equal(result.intent.state, "finalized");
    } finally {
      restore();
    }
  });
}

test("retries an unknown commit outcome with the same intent", async () => {
  const fixture = createFixture();
  const restore = installMocks(fixture);
  let attempts = 0;
  const unknownCommit = Object.assign(new Error("unknown commit"), {
    hasErrorLabel: (label) => label === "UnknownTransactionCommitResult",
  });
  try {
    const result = await finalizeUploadIntent({
      jobId,
      uploadIntentId: intentId,
      userId: ownerId,
      userType: "employee",
      transactionRunner: async (operation) => {
        attempts += 1;
        if (attempts === 1) throw unknownCommit;
        return operation({});
      },
    });
    assert.equal(result.intent.state, "finalized");
    assert.equal(attempts, 2);
  } finally {
    restore();
  }
});

test("returns a retryable error after bounded unknown commit recovery", async () => {
  const fixture = createFixture();
  const restore = installMocks(fixture);
  const unknownCommit = Object.assign(new Error("unknown commit"), {
    hasErrorLabel: (label) => label === "UnknownTransactionCommitResult",
  });
  try {
    await assert.rejects(
      finalizeUploadIntent({
        jobId,
        uploadIntentId: intentId,
        userId: ownerId,
        userType: "employee",
        transactionRunner: async () => {
          throw unknownCommit;
        },
      }),
      (error) => error.statusCode === 503,
    );
  } finally {
    restore();
  }
});
