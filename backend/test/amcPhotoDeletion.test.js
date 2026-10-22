import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import cloudinary from "../src/config/cloudinary.js";
import AMC from "../src/modules/amc/amc.model.js";
import AMCPhoto from "../src/modules/amcPhotos/amcPhoto.model.js";
import { deleteAMCPhoto } from "../src/modules/amcPhotos/amcPhoto.controller.js";

const photoId = "64b000000000000000000071";
const amcId = "64b000000000000000000072";
const uploaderId = "64b000000000000000000073";

const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
        return this;
      },
    };
    handler(req, res, reject);
  });

const request = (userId = uploaderId) => ({
  params: { photoId },
  user: { _id: userId, userType: "employee" },
});

const withPhotoState = async (
  callback,
  { beforeTransaction = () => {}, failPhotoUpdate = false } = {},
) => {
  const photo = {
    _id: photoId,
    amcId,
    uploadedBy: uploaderId,
    publicId: "amc-photo-public-id",
    url: "https://example.invalid/photo.jpg",
    thumbnailUrl: "https://example.invalid/photo-thumb.jpg",
    isExpired: false,
    async save() {
      return this;
    },
  };
  const amc = {
    _id: amcId,
    status: "IN_PROGRESS",
    photos: [photoId, "64b000000000000000000074"],
    photoCount: 2,
    async save() {
      return this;
    },
  };
  const originals = [
    [mongoose, "startSession", mongoose.startSession],
    [AMCPhoto, "findById", AMCPhoto.findById],
    [AMCPhoto, "findOneAndUpdate", AMCPhoto.findOneAndUpdate],
    [AMC, "findById", AMC.findById],
    [AMC, "findOneAndUpdate", AMC.findOneAndUpdate],
    [cloudinary.uploader, "destroy", cloudinary.uploader.destroy],
  ];
  AMCPhoto.findById = async () => ({ ...photo });
  AMC.findById = async () => ({ ...amc });
  mongoose.startSession = async () => ({
    withTransaction: async (operation) => {
      beforeTransaction({ photo, amc });
      const previousAMC = {
        status: amc.status,
        photos: [...amc.photos],
        photoCount: amc.photoCount,
      };
      const previousPhoto = {
        isExpired: photo.isExpired,
        expiredAt: photo.expiredAt,
        url: photo.url,
        thumbnailUrl: photo.thumbnailUrl,
        publicId: photo.publicId,
      };
      try {
        await operation();
      } catch (error) {
        Object.assign(amc, previousAMC);
        Object.assign(photo, previousPhoto);
        throw error;
      }
    },
    endSession: async () => {},
  });
  AMC.findOneAndUpdate = async (filter, update) => {
    if (
      String(filter._id) !== String(amc._id) ||
      filter.isDeleted !== false ||
      !amc.photos.some((id) => id.toString() === filter.photos.toString()) ||
      amc.photoCount <= 0 ||
      (filter.status?.$ne === "COMPLETED" && amc.status === "COMPLETED")
    ) {
      return null;
    }
    amc.photos = amc.photos.filter(
      (id) => id.toString() !== update.$pull.photos.toString(),
    );
    amc.photoCount += update.$inc.photoCount;
    return amc;
  };
  AMCPhoto.findOneAndUpdate = async (filter, update) => {
    if (
      failPhotoUpdate ||
      String(filter._id) !== String(photo._id) ||
      String(filter.amcId) !== String(photo.amcId) ||
      filter.isExpired !== photo.isExpired
    ) {
      return null;
    }
    Object.assign(photo, update.$set);
    return photo;
  };

  try {
    await callback({ photo, amc, originals });
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
};

test("reports Cloudinary cleanup failure after metadata is detached", async () => {
  await withPhotoState(async ({ photo, amc }) => {
    const originalConsoleError = console.error;
    cloudinary.uploader.destroy = async () => {
      throw new Error("provider-private diagnostic");
    };
    console.error = () => {};

    try {
      await assert.rejects(
        invoke(deleteAMCPhoto, request()),
        (error) =>
          error.statusCode === 502 &&
          error.message ===
            "Photo was removed from the AMC, but storage cleanup failed. Contact support.",
      );
      assert.equal(photo.isExpired, true);
      assert.equal(photo.url, null);
      assert.equal(photo.thumbnailUrl, null);
      assert.deepEqual(amc.photos, ["64b000000000000000000074"]);
      assert.equal(amc.photoCount, 1);
    } finally {
      console.error = originalConsoleError;
    }
  });
});

test("does not delete the Cloudinary asset if completion wins before metadata update", async () => {
  await withPhotoState(
    async ({ photo, amc }) => {
      let destroyCalls = 0;
      cloudinary.uploader.destroy = async () => {
        destroyCalls += 1;
        return { result: "ok" };
      };

      await assert.rejects(
        invoke(deleteAMCPhoto, request()),
        (error) => error.statusCode === 409,
      );
      assert.equal(amc.status, "COMPLETED");
      assert.deepEqual(amc.photos, [photoId, "64b000000000000000000074"]);
      assert.equal(amc.photoCount, 2);
      assert.equal(photo.isExpired, false);
      assert.equal(destroyCalls, 0);
    },
    {
      beforeTransaction({ amc }) {
        amc.status = "COMPLETED";
      },
    },
  );
});

test("photo deletion preserves an upload appended after its initial AMC read", async () => {
  const uploadedPhotoId = "64b000000000000000000075";
  await withPhotoState(
    async ({ photo, amc }) => {
      cloudinary.uploader.destroy = async () => ({ result: "ok" });
      const result = await invoke(deleteAMCPhoto, request());

      assert.equal(result.statusCode, 200);
      assert.equal(photo.isExpired, true);
      assert.deepEqual(amc.photos, [
        "64b000000000000000000074",
        uploadedPhotoId,
      ]);
      assert.equal(amc.photoCount, 2);
    },
    {
      beforeTransaction({ amc }) {
        amc.photos.push(uploadedPhotoId);
        amc.photoCount += 1;
      },
    },
  );
});

test("metadata transaction abort prevents Cloudinary deletion when photo update misses", async () => {
  await withPhotoState(
    async ({ photo, amc }) => {
      let destroyCalls = 0;
      cloudinary.uploader.destroy = async () => {
        destroyCalls += 1;
        return { result: "ok" };
      };

      await assert.rejects(
        invoke(deleteAMCPhoto, request()),
        (error) => error.statusCode === 409,
      );
      assert.deepEqual(amc.photos, [photoId, "64b000000000000000000074"]);
      assert.equal(amc.photoCount, 2);
      assert.equal(photo.isExpired, false);
      assert.equal(photo.url, "https://example.invalid/photo.jpg");
      assert.equal(photo.thumbnailUrl, "https://example.invalid/photo-thumb.jpg");
      assert.equal(photo.publicId, "amc-photo-public-id");
      assert.equal(destroyCalls, 0);
    },
    { failPhotoUpdate: true },
  );
});

test("soft-deletes an AMC photo after Cloudinary confirms deletion", async () => {
  await withPhotoState(async ({ photo, amc }) => {
    let deletedPublicId;
    cloudinary.uploader.destroy = async (publicId) => {
      deletedPublicId = publicId;
      return { result: "ok" };
    };

    const result = await invoke(deleteAMCPhoto, request());

    assert.equal(result.statusCode, 200);
    assert.equal(deletedPublicId, "amc-photo-public-id");
    assert.equal(photo.isExpired, true);
    assert.equal(photo.url, null);
    assert.equal(photo.thumbnailUrl, null);
    assert.equal(photo.publicId, "amc-photo-public-id");
    assert.deepEqual(amc.photos, ["64b000000000000000000074"]);
    assert.equal(amc.photoCount, 1);
  });
});

test("photo expiration update passes Mongoose update validators with cleared URLs", async () => {
  const query = AMCPhoto.findOneAndUpdate(
    { _id: photoId, amcId, isExpired: false },
    {
      $set: {
        isExpired: true,
        expiredAt: new Date("2026-10-22T00:00:00.000Z"),
        url: null,
        thumbnailUrl: null,
      },
    },
    { new: true, runValidators: true },
  );
  const castedUpdate = query._castUpdate(query.getUpdate());

  await query.validate(castedUpdate, query.getOptions(), false);
});

test("active photo validation still requires both URLs", async () => {
  const activePhoto = new AMCPhoto({
    amcId,
    atmId: "64b000000000000000000077",
    uploadedBy: uploaderId,
    publicId: "active-photo-public-id",
  });

  await assert.rejects(activePhoto.validate(), (error) => {
    assert.equal(error.name, "ValidationError");
    assert.ok(error.errors.url);
    assert.ok(error.errors.thumbnailUrl);
    return true;
  });

  const query = AMCPhoto.findOneAndUpdate(
    { _id: photoId, isExpired: false },
    { $set: { url: null, thumbnailUrl: null } },
    { runValidators: true },
  );
  const castedUpdate = query._castUpdate(query.getUpdate());

  await assert.rejects(
    query.validate(castedUpdate, query.getOptions(), false),
    (error) => {
      assert.equal(error.name, "ValidationError");
      assert.ok(error.errors.url);
      assert.ok(error.errors.thumbnailUrl);
      return true;
    },
  );
});

test("preserves Admin ability to delete evidence from a completed AMC", async () => {
  await withPhotoState(
    async ({ photo, amc }) => {
      let deletedPublicId;
      cloudinary.uploader.destroy = async (publicId) => {
        deletedPublicId = publicId;
        return { result: "ok" };
      };

      const result = await invoke(deleteAMCPhoto, {
        ...request(),
        user: {
          _id: "64b000000000000000000076",
          userType: "admin",
        },
      });

      assert.equal(result.statusCode, 200);
      assert.equal(deletedPublicId, "amc-photo-public-id");
      assert.equal(amc.status, "COMPLETED");
      assert.equal(amc.photoCount, 1);
      assert.deepEqual(amc.photos, ["64b000000000000000000074"]);
      assert.equal(photo.isExpired, true);
    },
    {
      beforeTransaction({ amc }) {
        amc.status = "COMPLETED";
      },
    },
  );
});

test("does not attempt remote deletion for an unauthorized AMC photo request", async () => {
  await withPhotoState(async ({ photo, amc }) => {
    let destroyCalls = 0;
    cloudinary.uploader.destroy = async () => {
      destroyCalls += 1;
      return { result: "ok" };
    };

    await assert.rejects(
      invoke(deleteAMCPhoto, request("64b000000000000000000075")),
      (error) => error.statusCode === 403,
    );
    assert.equal(destroyCalls, 0);
    assert.equal(photo.isExpired, false);
    assert.equal(amc.photoCount, 2);
  });
});
