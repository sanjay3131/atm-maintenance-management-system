import test from "node:test";
import assert from "node:assert/strict";
import cloudinary from "../src/config/cloudinary.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import {
  createDeletePhotoHandler,
  createUploadPhotosHandler,
} from "../src/modules/jobPhotos/jobPhotos.controller.js";

const jobId = "64b000000000000000000031";
const employeeUserId = "64b000000000000000000032";

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

test("rolls back earlier file writes when a photo batch upload fails", async () => {
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

    assert.match(result.error.message, /Cloudinary upload failed/);
    assert.equal(jobPhotoRecords.length, 0);
    assert.deepEqual(job.beforePhotos, []);
    assert.deepEqual(cloudinaryDeletions, ["job-photo-public-id"]);
    assert.equal(rollbackUpdates.length, 1);
    assert.deepEqual(events, []);
    assert.deepEqual(rollbackUpdates[0][1], {
      $pull: { beforePhotos: { $in: ["photo-1"] } },
    });
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
});

test("photo upload publishes safe job metadata after persistence", async () => {
  const events = [];
  let persisted = false;
  let nextPhotoId = 0;
  const job = {
    _id: jobId,
    atmId: "64b000000000000000000033",
    createdBy: employeeUserId,
    assignedEmployeeId: employeeUserId,
    status: "IN_PROGRESS",
    beforePhotos: [],
    afterPhotos: [],
    async save() {
      persisted = true;
      return this;
    },
  };
  const originals = [
    [Job, "findById", Job.findById],
    [JobPhoto, "countDocuments", JobPhoto.countDocuments],
    [JobPhoto, "create", JobPhoto.create],
    [cloudinary.uploader, "upload_stream", cloudinary.uploader.upload_stream],
    [cloudinary, "url", cloudinary.url],
  ];

  Job.findById = async () => job;
  JobPhoto.countDocuments = async () => 1;
  JobPhoto.create = async (data) => ({
    _id: `photo-${++nextPhotoId}`,
    url: "https://private.invalid/photo.jpg",
    thumbnailUrl: "https://private.invalid/thumb.jpg",
    uploadedAt: new Date(),
    ...data,
  });
  cloudinary.uploader.upload_stream = (_options, callback) => ({
    end() {
      callback(null, {
        public_id: "job-photo-public-id",
        secure_url: "https://private.invalid/photo.jpg",
        bytes: 10,
      });
    },
  });
  cloudinary.url = () => "https://private.invalid/thumb.jpg";

  try {
    const result = await invoke(
      createUploadPhotosHandler(async (event) => {
        assert.equal(persisted, true);
        events.push(event);
      }),
      {
        params: { jobId },
        body: { photoType: "before", gpsData: '{"latitude":12.5}' },
        files: [
          {
            buffer: Buffer.from("photo"),
            originalname: "before.jpg",
            size: 10,
            mimetype: "image/jpeg",
          },
        ],
        user: { _id: employeeUserId, userType: "employee" },
      },
    );

    assert.ifError(result.error);
    assert.equal(result.statusCode, 201);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "domain:job:updated");
    assert.equal(String(events[0].entityId), jobId);
    assert.equal(events[0].action, "photos-uploaded");
    assert.equal("data" in events[0], false);
    assert.doesNotMatch(JSON.stringify(events[0]), /private\\.invalid|latitude|gps/i);
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
