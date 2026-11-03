import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import cloudinary from "../src/config/cloudinary.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import JobPhotoUploadIntent from "../src/modules/jobPhotos/jobPhotoUploadIntent.model.js";
import JobPhotoUploadAsset from "../src/modules/jobPhotos/jobPhotoUploadAsset.model.js";
import {
  createDeletePhotoHandler,
  createUploadPhotosHandler,
  getPendingUploadIntents,
} from "../src/modules/jobPhotos/jobPhotos.controller.js";

const jobId = "64b000000000000000000031";
const employeeUserId = "64b000000000000000000032";
const clientPhotoId = "7d6f1c1a-6c8e-4e51-9c2a-0b1c2d3e4f50";

const invoke = (handler, req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
      },
    };
    handler(req, res, (error) => resolve({ error }));
  });

test("upload-only success persists an asset without finalizing the Job", async () => {
  const events = [];
  let jobSaved = false;
  let jobPhotoCreated = false;
  const intentId = "64b000000000000000000034";
  const fileBuffer = Buffer.from([0xff, 0xd8, 0xff]);
  const fileHash = createHash("sha256").update(fileBuffer).digest("hex");
  const intent = {
    _id: intentId,
    jobId,
    clientPhotoId,
    ownerUserId: employeeUserId,
    currentOwnerUserId: employeeUserId,
    photoType: "before",
    contentSha256: fileHash,
    byteSize: fileBuffer.length,
    verifiedMimeType: "image/jpeg",
    originalName: "before.jpg",
    ownerTokenHash: "b".repeat(64),
    ownerVersion: 1,
    state: "reserved",
    leaseExpiresAt: new Date(Date.now() + 600000),
  };
  const asset = {
    _id: "64b000000000000000000035",
    intentId,
    ownerVersion: 1,
    state: "verified",
    publicId: `jobs/${jobId}/before/${intentId}/v1`,
    secureUrl: "https://cloudinary.invalid/photo.jpg",
    format: "jpg",
    verifiedSha256: fileHash,
  };
  const job = {
    _id: jobId,
    atmId: "64b000000000000000000033",
    assignedEmployeeId: employeeUserId,
    status: "IN_PROGRESS",
    beforePhotos: [],
    afterPhotos: [],
    async save() {
      jobSaved = true;
    },
  };
  const originals = [
    [Job, "findById", Job.findById],
    [JobPhoto, "countDocuments", JobPhoto.countDocuments],
    [JobPhoto, "create", JobPhoto.create],
    [JobPhotoUploadIntent, "findOne", JobPhotoUploadIntent.findOne],
    [JobPhotoUploadIntent, "create", JobPhotoUploadIntent.create],
    [JobPhotoUploadIntent, "findOneAndUpdate", JobPhotoUploadIntent.findOneAndUpdate],
    [JobPhotoUploadAsset, "findOne", JobPhotoUploadAsset.findOne],
    [JobPhotoUploadAsset, "findOneAndUpdate", JobPhotoUploadAsset.findOneAndUpdate],
    [mongoose, "startSession", mongoose.startSession],
    [cloudinary.api, "resource", cloudinary.api.resource],
    [cloudinary.uploader, "upload_stream", cloudinary.uploader.upload_stream],
  ];
  const originalFetch = globalThis.fetch;
  let intentReads = 0;
  let assetReads = 0;
  Job.findById = async () => job;
  JobPhoto.countDocuments = async () => 0;
  JobPhoto.create = async () => {
    jobPhotoCreated = true;
    return {};
  };
  JobPhotoUploadIntent.findOne = () => ({
    select: async () => {
      intentReads += 1;
      return intentReads === 1 ? null : intent;
    },
  });
  JobPhotoUploadIntent.create = async () => intent;
  JobPhotoUploadIntent.findOneAndUpdate = () => ({
    select: async () => intent,
  });
  JobPhotoUploadAsset.findOne = async () => {
    assetReads += 1;
    return assetReads === 1 ? null : asset;
  };
  JobPhotoUploadAsset.findOneAndUpdate = async () => asset;
  mongoose.startSession = async () => ({
    async withTransaction(operation) {
      return operation({});
    },
    async endSession() {},
  });
  cloudinary.api.resource = async () => {
    const error = new Error("not found");
    error.http_code = 404;
    throw error;
  };
  cloudinary.uploader.upload_stream = (_options, callback) => ({
    end() {
      callback(null, {
        public_id: asset.publicId,
        secure_url: asset.secureUrl,
        format: "jpg",
      });
    },
  });
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: (name) => (name === "content-type" ? "image/jpeg" : "3") },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(fileBuffer);
        controller.close();
      },
    }),
  });

  try {
    const result = await invoke(createUploadPhotosHandler((event) => {
      events.push(event);
    }), {
      params: { jobId },
      body: { photoType: "before", clientPhotoId },
      files: [{
        buffer: fileBuffer,
        originalname: "before.jpg",
        size: fileBuffer.length,
        mimetype: "image/jpeg",
      }],
      user: { _id: employeeUserId, userType: "employee" },
    });

    assert.ifError(result.error);
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.data.status, "uploaded");
    assert.equal(result.body.data.finalizationPending, true);
    assert.equal(jobPhotoCreated, false);
    assert.equal(jobSaved, false);
    assert.deepEqual(job.beforePhotos, []);
    assert.deepEqual(job.afterPhotos, []);
    assert.deepEqual(events, []);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [target, key, original] of originals) target[key] = original;
  }
});

test("upload-only endpoint rejects multi-file requests before any persistence", async () => {
  const jobPhotoRecords = [];
  const cloudinaryDeletions = [];
  const rollbackUpdates = [];
  const events = [];
  let uploadCount = 0;
  let nextPhotoId = 0;
  const job = {
    _id: jobId,
    atmId: "64b000000000000000000033",
    assignedEmployeeId: employeeUserId,
    status: "IN_PROGRESS",
    beforePhotos: [],
    afterPhotos: [],
    async save() {
      return this;
    },
  };

  const originals = [
    [Job, "findById", Job.findById],
    [Job, "updateOne", Job.updateOne],
    [JobPhoto, "countDocuments", JobPhoto.countDocuments],
    [JobPhoto, "create", JobPhoto.create],
    [JobPhoto, "deleteMany", JobPhoto.deleteMany],
    [cloudinary.uploader, "upload_stream", cloudinary.uploader.upload_stream],
    [cloudinary.uploader, "destroy", cloudinary.uploader.destroy],
    [cloudinary, "url", cloudinary.url],
  ];

  Job.findById = async () => job;
  Job.updateOne = async (...args) => {
    rollbackUpdates.push(args);
    return { modifiedCount: 1 };
  };
  JobPhoto.countDocuments = async () => 0;
  JobPhoto.create = async (data) => {
    const record = { _id: `photo-${++nextPhotoId}`, ...data };
    jobPhotoRecords.push(record);
    return record;
  };
  JobPhoto.deleteMany = async (filter) => {
    const ids = new Set(filter._id.$in);
    for (let index = jobPhotoRecords.length - 1; index >= 0; index -= 1) {
      if (ids.has(jobPhotoRecords[index]._id)) jobPhotoRecords.splice(index, 1);
    }
    return { deletedCount: ids.size };
  };
  cloudinary.uploader.upload_stream = (_options, callback) => ({
    end() {
      uploadCount += 1;
      if (uploadCount === 1) {
        callback(null, {
          public_id: "job-photo-public-id",
          secure_url: "https://example.invalid/photo.jpg",
          bytes: 10,
        });
      } else {
        callback(new Error("Cloudinary upload failed"));
      }
    },
  });
  cloudinary.uploader.destroy = async (publicId) => {
    cloudinaryDeletions.push(publicId);
    return { result: "ok" };
  };
  cloudinary.url = () => "https://example.invalid/thumbnail.jpg";

  try {
    const result = await invoke(createUploadPhotosHandler(async (event) => {
      events.push(event);
    }), {
      params: { jobId },
      body: { photoType: "before" },
      files: [
        {
          buffer: Buffer.from("photo-one"),
          originalname: "before-one.jpg",
          size: 10,
          mimetype: "image/jpeg",
        },
        {
          buffer: Buffer.from("photo-two"),
          originalname: "before-two.jpg",
          size: 10,
          mimetype: "image/jpeg",
        },
      ],
      user: { _id: employeeUserId, userType: "employee" },
    });

    assert.match(result.error.message, /Exactly one photo/);
    assert.equal(jobPhotoRecords.length, 0);
    assert.deepEqual(job.beforePhotos, []);
    assert.deepEqual(cloudinaryDeletions, []);
    assert.equal(rollbackUpdates.length, 0);
    assert.deepEqual(events, []);
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
});

test("upload-only endpoint requires a client photo identity", async () => {
  const job = {
    _id: jobId,
    assignedEmployeeId: employeeUserId,
    status: "IN_PROGRESS",
    beforePhotos: [],
    afterPhotos: [],
  };
  const originals = [
    [Job, "findById", Job.findById],
    [JobPhoto, "countDocuments", JobPhoto.countDocuments],
  ];

  Job.findById = async () => job;
  JobPhoto.countDocuments = async () => 0;

  try {
    const result = await invoke(createUploadPhotosHandler(), {
      params: { jobId },
      body: { photoType: "before" },
      files: [{
        buffer: Buffer.from([0xff, 0xd8, 0xff]),
        originalname: "before.jpg",
        size: 3,
        mimetype: "image/jpeg",
      }],
      user: { _id: employeeUserId, userType: "employee" },
    });

    assert.match(result.error.message, /clientPhotoId is required/);
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
});

test("pending-intent retrieval is authorized and excludes security fields", async () => {
  const job = {
    _id: jobId,
    assignedEmployeeId: employeeUserId,
    isDeleted: false,
  };
  const intent = {
    _id: "64b000000000000000000036",
    clientPhotoId,
    ownerUserId: employeeUserId,
    currentOwnerUserId: employeeUserId,
    photoType: "before",
    ownerVersion: 1,
    state: "uploaded",
    leaseExpiresAt: new Date(),
    failureCode: null,
    failedAt: null,
  };
  const originals = [
    [Job, "findById", Job.findById],
    [JobPhotoUploadIntent, "find", JobPhotoUploadIntent.find],
  ];
  Job.findById = async () => job;
  JobPhotoUploadIntent.find = () => ({
    select: async () => [intent],
  });
  try {
    const result = await invoke(getPendingUploadIntents, {
      params: { jobId },
      user: { _id: employeeUserId, userType: "employee" },
    });
    assert.ifError(result.error);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.data[0].clientPhotoId, clientPhotoId);
    assert.equal("ownerTokenHash" in result.body.data[0], false);
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
});

test("photo deletion publishes only after both job and photo persistence", async () => {
  const events = [];
  let jobSaved = false;
  let photoSaved = false;
  const job = {
    _id: jobId,
    createdBy: employeeUserId,
    assignedEmployeeId: employeeUserId,
    status: "IN_PROGRESS",
    beforePhotos: ["photo-1"],
    afterPhotos: [],
    async save() {
      jobSaved = true;
    },
  };
  const photo = {
    _id: "photo-1",
    jobId,
    publicId: "private-photo-id",
    isExpired: false,
    async save() {
      photoSaved = true;
    },
  };
  const originals = [
    [Job, "findById", Job.findById],
    [JobPhoto, "findById", JobPhoto.findById],
    [cloudinary.uploader, "destroy", cloudinary.uploader.destroy],
  ];

  Job.findById = async () => job;
  JobPhoto.findById = async () => photo;
  cloudinary.uploader.destroy = async () => ({ result: "ok" });

  try {
    const result = await invoke(
      createDeletePhotoHandler(async (event) => {
        assert.equal(jobSaved, true);
        assert.equal(photoSaved, true);
        events.push(event);
      }),
      {
        params: { photoId: "photo-1" },
        user: { _id: employeeUserId, userType: "employee" },
      },
    );

    assert.equal(result.statusCode, 200);
    assert.equal(events.length, 1);
    assert.equal(events[0].entityType, "job");
    assert.equal(String(events[0].entityId), jobId);
    assert.equal(events[0].action, "photo-deleted");
    assert.doesNotMatch(JSON.stringify(events[0]), /private-photo-id|url|gps/i);
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
});

test("photo deletion persistence failure does not publish a success event", async () => {
  const events = [];
  let jobSaved = false;
  const job = {
    _id: jobId,
    assignedEmployeeId: employeeUserId,
    status: "IN_PROGRESS",
    beforePhotos: ["photo-1"],
    afterPhotos: [],
    async save() {
      jobSaved = true;
      return this;
    },
  };
  const photo = {
    _id: "photo-1",
    jobId,
    publicId: "private-photo-id",
    isExpired: false,
    async save() {
      throw new Error("database write failed");
    },
  };
  const originals = [
    [Job, "findById", Job.findById],
    [JobPhoto, "findById", JobPhoto.findById],
    [cloudinary.uploader, "destroy", cloudinary.uploader.destroy],
  ];
  Job.findById = async () => job;
  JobPhoto.findById = async () => photo;
  cloudinary.uploader.destroy = async () => ({ result: "ok" });

  try {
    const result = await invoke(
      createDeletePhotoHandler(async (event) => events.push(event)),
      {
        params: { photoId: "photo-1" },
        user: { _id: employeeUserId, userType: "employee" },
      },
    );
    assert.match(result.error.message, /database write failed/);
    assert.equal(jobSaved, true);
    assert.deepEqual(events, []);
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
});
