import test from "node:test";
import assert from "node:assert/strict";
import cloudinary from "../src/config/cloudinary.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import { uploadPhotos } from "../src/modules/jobPhotos/jobPhotos.controller.js";

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
    const result = await invoke(uploadPhotos, {
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
    assert.deepEqual(rollbackUpdates[0][1], {
      $pull: { beforePhotos: { $in: ["photo-1"] } },
    });
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
});
