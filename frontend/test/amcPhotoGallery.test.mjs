import test from "node:test";
import assert from "node:assert/strict";
import { updateAMCPhotoGalleryState } from "../src/features/amc/amcPhotoGallery.utils.ts";

test("AMC photo gallery opens the selected photo and navigates Previous and Next", () => {
  const photoCount = 3;
  const opened = updateAMCPhotoGalleryState(null, { type: "open", index: 1 }, photoCount);
  assert.equal(opened, 1);
  assert.equal(
    updateAMCPhotoGalleryState(opened, { type: "previous" }, photoCount),
    0,
  );
  assert.equal(
    updateAMCPhotoGalleryState(opened, { type: "next" }, photoCount),
    2,
  );
});

test("AMC photo gallery closes and ignores invalid open indices", () => {
  assert.equal(
    updateAMCPhotoGalleryState(1, { type: "close" }, 3),
    null,
  );
  assert.equal(
    updateAMCPhotoGalleryState(null, { type: "open", index: 3 }, 3),
    null,
  );
});

test("empty and single-photo galleries keep navigation within available photos", () => {
  assert.equal(
    updateAMCPhotoGalleryState(null, { type: "open", index: 0 }, 0),
    null,
  );
  assert.equal(
    updateAMCPhotoGalleryState(0, { type: "previous" }, 1),
    0,
  );
  assert.equal(updateAMCPhotoGalleryState(0, { type: "next" }, 1), 0);
});
