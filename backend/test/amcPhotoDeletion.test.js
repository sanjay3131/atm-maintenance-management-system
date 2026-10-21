import test from "node:test";
import assert from "node:assert/strict";
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

const withPhotoState = async (callback) => {
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
    [AMCPhoto, "findById", AMCPhoto.findById],
    [AMC, "findById", AMC.findById],
    [cloudinary.uploader, "destroy", cloudinary.uploader.destroy],
  ];
  AMCPhoto.findById = async () => photo;
  AMC.findById = async () => amc;

  try {
    await callback({ photo, amc, originals });
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
};

test("does not soft-delete an AMC photo when Cloudinary deletion fails", async () => {
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
          error.message === "Photo could not be deleted. Please try again.",
      );
      assert.equal(photo.isExpired, false);
      assert.equal(photo.url, "https://example.invalid/photo.jpg");
      assert.equal(
        photo.thumbnailUrl,
        "https://example.invalid/photo-thumb.jpg",
      );
      assert.deepEqual(amc.photos, [photoId, "64b000000000000000000074"]);
      assert.equal(amc.photoCount, 2);
    } finally {
      console.error = originalConsoleError;
    }
  });
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
    assert.deepEqual(amc.photos, ["64b000000000000000000074"]);
    assert.equal(amc.photoCount, 1);
  });
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
