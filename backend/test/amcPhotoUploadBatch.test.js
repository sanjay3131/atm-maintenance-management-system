import test from "node:test";
import assert from "node:assert/strict";
import AMC from "../src/modules/amc/amc.model.js";
import AMCPhoto from "../src/modules/amcPhotos/amcPhoto.model.js";
import cloudinary from "../src/config/cloudinary.js";
import { uploadAMCPhotos } from "../src/modules/amcPhotos/amcPhoto.controller.js";

const amcId = "64b000000000000000000201";
const employeeId = "64b000000000000000000202";
const photoFile = (index) => ({
  buffer: Buffer.from(`photo-${index}`),
  originalname: `photo-${index}.jpg`,
  size: 10,
  mimetype: "image/jpeg",
});

const invoke = (files, userId = employeeId) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
    };
    uploadAMCPhotos(
      {
        params: { amcId },
        body: {},
        files,
        user: { _id: userId, userType: "employee" },
      },
      res,
      (error) => resolve({ error }),
    );
  });

const withUploadHarness = async (
  callback,
  {
    failUploadAt,
    failCreateAt,
    failDestroy = false,
    failPhotoDelete = false,
    failAttach = false,
    failAfterAttach = false,
    amcUpdates = {},
  } = {},
) => {
  const amc = {
    _id: amcId,
    atmId: "64b000000000000000000203",
    employeeId,
    isDeleted: false,
    status: "IN_PROGRESS",
    visitDate: new Date("2026-10-21T08:00:00.000Z"),
    photoCount: 0,
    photos: [],
    ...amcUpdates,
  };
  const records = [];
  const deletedCloudinaryIds = [];
  let sequence = 0;
  let uploadSequence = 0;
  let createSequence = 0;
  const originals = [
    [AMC, "findById", AMC.findById],
    [AMC, "findOneAndUpdate", AMC.findOneAndUpdate],
    [AMCPhoto, "create", AMCPhoto.create],
    [AMCPhoto, "deleteMany", AMCPhoto.deleteMany],
    [cloudinary.uploader, "upload_stream", cloudinary.uploader.upload_stream],
    [cloudinary.uploader, "destroy", cloudinary.uploader.destroy],
    [cloudinary, "url", cloudinary.url],
  ];

  AMC.findById = async () => amc;
  AMC.findOneAndUpdate = async (filter, update) => {
    if (failAttach) return null;
    if (
      String(filter._id) !== String(amc._id) ||
      String(filter.employeeId) !== String(amc.employeeId) ||
      filter.isDeleted !== false ||
      amc.status === "COMPLETED" ||
      amc.photoCount > filter.photoCount.$lte
    ) {
      return null;
    }
    amc.photos.push(...update.$push.photos.$each);
    amc.photoCount += update.$inc.photoCount;
    if (failAfterAttach) {
      throw new Error("AMC update response was lost after write");
    }
    return amc;
  };
  AMCPhoto.create = async (data) => {
    createSequence += 1;
    const photo = { _id: `photo-${++sequence}`, ...data };
    records.push(photo);
    if (createSequence === failCreateAt) {
      throw new Error("Photo record write outcome is unknown");
    }
    return photo;
  };
  AMCPhoto.deleteMany = async ({ _id }) => {
    if (failPhotoDelete) throw new Error("Photo record cleanup failed");
    const ids = new Set(_id.$in);
    const previousLength = records.length;
    for (let index = records.length - 1; index >= 0; index--) {
      if (ids.has(records[index]._id)) records.splice(index, 1);
    }
    return { deletedCount: previousLength - records.length };
  };
  cloudinary.uploader.upload_stream = (_options, done) => ({
    end() {
      uploadSequence += 1;
      if (uploadSequence === failUploadAt) {
        done(new Error("Cloudinary upload failed"));
        return;
      }
      done(null, {
        public_id: `asset-${uploadSequence}`,
        secure_url: `https://example.invalid/asset-${uploadSequence}.jpg`,
        bytes: 10,
      });
    },
  });
  cloudinary.uploader.destroy = async (publicId) => {
    deletedCloudinaryIds.push(publicId);
    return { result: failDestroy ? "error" : "ok" };
  };
  cloudinary.url = (publicId) => `https://example.invalid/${publicId}-thumb.jpg`;

  try {
    await callback({
      amc,
      records,
      deletedCloudinaryIds,
      getUploadCount: () => uploadSequence,
    });
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
};

test("mid-batch Cloudinary failure cleans earlier assets and attaches no photos", async () => {
  await withUploadHarness(async ({ amc, records, deletedCloudinaryIds }) => {
    const result = await invoke([photoFile(1), photoFile(2)]);
    assert.match(result.error.message, /Cloudinary upload failed/);
    assert.deepEqual(deletedCloudinaryIds, ["asset-1"]);
    assert.equal(records.length, 0);
    assert.equal(amc.photoCount, 0);
    assert.deepEqual(amc.photos, []);
  }, { failUploadAt: 2 });
});

test("photo record write with an uncertain outcome retains provider assets for reconciliation", async () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    await withUploadHarness(
      async ({ amc, records, deletedCloudinaryIds, getUploadCount }) => {
        const result = await invoke([photoFile(1)]);
        assert.equal(result.error.statusCode, 503);
        assert.match(result.error.message, /Some photo data may have been saved/i);
        assert.equal(getUploadCount(), 1);
        assert.equal(records.length, 1);
        assert.equal(amc.photoCount, 0);
        assert.deepEqual(deletedCloudinaryIds, []);
        assert.equal(logged.length, 1);
        assert.match(logged[0], /outcome is unknown/);
      },
      { failCreateAt: 1 },
    );
  } finally {
    console.error = originalError;
  }
});

test("uncertain AMC association write does not delete assets that may be referenced", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    await withUploadHarness(
      async ({ amc, records, deletedCloudinaryIds }) => {
        const result = await invoke([photoFile(1)]);
        assert.equal(result.error.statusCode, 503);
        assert.match(result.error.message, /Refresh the AMC details/);
        assert.equal(amc.photoCount, 1);
        assert.equal(amc.photos.length, 1);
        assert.equal(records.length, 1);
        assert.deepEqual(deletedCloudinaryIds, []);
      },
      { failAfterAttach: true },
    );
  } finally {
    console.error = originalError;
  }
});

test("provider assets are retained if photo-record rollback cannot be confirmed", async () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    await withUploadHarness(
      async ({ records, deletedCloudinaryIds }) => {
        const result = await invoke([photoFile(1)]);
        assert.equal(result.error.statusCode, 502);
        assert.match(result.error.message, /could not be removed/i);
        assert.equal(records.length, 1);
        assert.deepEqual(deletedCloudinaryIds, []);
        assert.equal(logged.length, 1);
        assert.match(logged[0], /cleanup failures/);
      },
      { failAttach: true, failPhotoDelete: true },
    );
  } finally {
    console.error = originalError;
  }
});

test("photo upload requires a started visit and performs no upload before start", async () => {
  await withUploadHarness(
    async ({ amc, getUploadCount, records }) => {
      const result = await invoke([photoFile(1)]);
      assert.equal(result.error.statusCode, 400);
      assert.equal(result.error.message, "AMC visit has not been started");
      assert.equal(getUploadCount(), 0);
      assert.equal(records.length, 0);
      assert.equal(amc.photoCount, 0);
    },
    { amcUpdates: { visitDate: null } },
  );
});

test("photo upload succeeds after visit start", async () => {
  await withUploadHarness(async ({ amc }) => {
    const result = await invoke([photoFile(1)]);
    assert.equal(result.status, 201);
    assert.equal(result.body.data.uploaded, 1);
    assert.equal(amc.photoCount, 1);
  });
});

test("completed and unauthorized AMCs reject photo uploads before external upload", async () => {
  await withUploadHarness(
    async ({ getUploadCount }) => {
      const result = await invoke([photoFile(1)]);
      assert.equal(result.error.statusCode, 400);
      assert.equal(result.error.message, "Cannot upload photos for completed AMC");
      assert.equal(getUploadCount(), 0);
    },
    {
      amcUpdates: {
        status: "COMPLETED",
        visitDate: new Date("2026-10-21T08:00:00.000Z"),
      },
    },
  );

  await withUploadHarness(async ({ getUploadCount }) => {
    const result = await invoke([photoFile(1)], "64b000000000000000000299");
    assert.equal(result.error.statusCode, 403);
    assert.equal(
      result.error.message,
      "You can only upload photos for your assigned AMC",
    );
    assert.equal(getUploadCount(), 0);
  });
});

test("reports and logs failed external cleanup after an upload error", async () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    await withUploadHarness(
      async () => {
        const result = await invoke([photoFile(1), photoFile(2)]);
        assert.equal(result.error.statusCode, 502);
        assert.match(result.error.message, /could not be removed/i);
        assert.equal(logged.length, 1);
        assert.match(logged[0], /cleanup failures/);
      },
      { failUploadAt: 2, failDestroy: true },
    );
  } finally {
    console.error = originalError;
  }
});

test("concurrent photo batches cannot exceed the six-photo cap", async () => {
  await withUploadHarness(async ({ amc, records, deletedCloudinaryIds }) => {
    const results = await Promise.all([
      invoke([photoFile(1), photoFile(2), photoFile(3), photoFile(4)]),
      invoke([photoFile(5), photoFile(6), photoFile(7), photoFile(8)]),
    ]);
    assert.equal(results.filter((result) => result.status === 201).length, 1);
    const rejected = results.find((result) => result.error);
    assert.equal(rejected.error.statusCode, 409);
    assert.equal(amc.photoCount, 4);
    assert.equal(amc.photos.length, 4);
    assert.equal(records.length, 4);
    assert.equal(deletedCloudinaryIds.length, 4);
  });
});

test("concurrent uploads at the six-photo boundary attach only available slots", async () => {
  await withUploadHarness(
    async ({ amc, records, deletedCloudinaryIds }) => {
      const results = await Promise.all([
        invoke([photoFile(1), photoFile(2)]),
        invoke([photoFile(3), photoFile(4)]),
      ]);
      assert.equal(results.filter((result) => result.status === 201).length, 1);
      const rejected = results.find((result) => result.error);
      assert.equal(rejected.error.statusCode, 409);
      assert.equal(amc.photoCount, 6);
      assert.equal(amc.photos.length, 6);
      assert.equal(records.length, 2);
      assert.equal(deletedCloudinaryIds.length, 2);
    },
    {
      amcUpdates: {
        photoCount: 4,
        photos: ["existing-1", "existing-2", "existing-3", "existing-4"],
      },
    },
  );
});
