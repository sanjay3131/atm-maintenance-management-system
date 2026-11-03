import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  getEligiblePhotoUploads,
  processPhotoUploadQueue,
  withPhotoUploadLock,
} from "../src/features/jobs/utils/photoUploadQueue.ts";

const panelPath = new URL(
  "../src/features/jobs/components/EmployeeFieldWorkPanel.tsx",
  import.meta.url,
);
const panel = await readFile(panelPath, "utf8");

const photo = (id) => ({ id, clientPhotoId: `client-${id}` });

test("a single selected photo is processed exactly once", async () => {
  const selected = [photo("one")];
  const processed = [];
  const statuses = {};
  const processQueue = () =>
    processPhotoUploadQueue({
      photos: getEligiblePhotoUploads(selected, statuses),
      requiredCount: 3,
      getSavedCount: () => 0,
      processPhoto: async (item) => {
        processed.push(item.clientPhotoId);
        statuses[item.id] = "uploaded";
        return "uploaded";
      },
    });

  const result = await processQueue();
  await processQueue();

  assert.deepEqual(processed, ["client-one"]);
  assert.equal(result.uploadedCount, 1);
  assert.equal(result.failure, null);
});

test("three selected photos are processed sequentially and the queue terminates", async () => {
  const selected = [photo("one"), photo("two"), photo("three")];
  const processed = [];
  let active = 0;
  let maxActive = 0;
  let savedCount = 0;

  const result = await processPhotoUploadQueue({
    photos: selected,
    requiredCount: 3,
    getSavedCount: () => savedCount,
    processPhoto: async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      processed.push(item.id);
      await Promise.resolve();
      active -= 1;
      savedCount += 1;
      return "uploaded";
    },
  });

  assert.deepEqual(processed, ["one", "two", "three"]);
  assert.equal(maxActive, 1);
  assert.equal(savedCount, 3);
  assert.equal(result.uploadedCount, 3);
  assert.equal(result.failure, null);
});

test("uploaded, active, verifying, and finalization-pending photos are not eligible", () => {
  const photos = ["uploaded", "uploading", "verification", "pending", "idle"]
    .map(photo);
  const eligible = getEligiblePhotoUploads(photos, {
    uploaded: "uploaded",
    uploading: "uploading",
    verification: "verification",
    pending: "finalization-pending",
  });

  assert.deepEqual(eligible.map(({ id }) => id), ["idle"]);
});

test("the component emits at most one upload success toast per queue attempt", () => {
  const start = panel.indexOf("const uploadSelectedPhotos = async");
  const end = panel.indexOf("const completeJob =", start);
  const uploadHandler = panel.slice(start, end);

  assert.equal([...uploadHandler.matchAll(/toast\.success\(/g)].length, 1);
  assert.ok(uploadHandler.indexOf("processPhotoUploadQueue") <
    uploadHandler.indexOf("toast.success("));
});

test("upload lock and loading state reset after success and failure", async () => {
  for (const fail of [false, true]) {
    const lock = { current: false };
    const loading = [];
    const operation = fail
      ? async () => {
          throw new Error("upload failed");
        }
      : async () => "done";

    if (fail) {
      await assert.rejects(
        withPhotoUploadLock(lock, (value) => loading.push(value), operation),
        /upload failed/,
      );
    } else {
      assert.equal(
        await withPhotoUploadLock(lock, (value) => loading.push(value), operation),
        "done",
      );
    }

    assert.deepEqual(loading, [true, false]);
    assert.equal(lock.current, false);
  }
});

test("a finalization-pending photo remains out of the upload queue for recovery", async () => {
  const selected = [photo("pending")];
  let uploadCalls = 0;
  let finalizeCalls = 0;
  const statuses = {};
  const candidates = getEligiblePhotoUploads(selected, statuses);
  const result = await processPhotoUploadQueue({
    photos: candidates,
    requiredCount: 3,
    getSavedCount: () => 0,
    processPhoto: async () => {
      uploadCalls += 1;
      finalizeCalls += 1;
      statuses.pending = "finalization-pending";
      return "finalization-pending";
    },
  });

  assert.equal(candidates.length, 1);
  assert.equal(uploadCalls, 1);
  assert.equal(finalizeCalls, 1);
  assert.equal(result.finalizationPendingCount, 1);
  assert.deepEqual(getEligiblePhotoUploads(selected, statuses), []);
  assert.match(panel, /finalizePendingIntent\(\s*response\.uploadIntentId/);
  assert.match(panel, /return finalized \? "uploaded" : "finalization-pending"/);
});

test("queue stops on the first failure and does not process later photos", async () => {
  const processed = [];
  const result = await processPhotoUploadQueue({
    photos: [photo("one"), photo("two")],
    requiredCount: 3,
    getSavedCount: () => 0,
    processPhoto: async (item) => {
      processed.push(item.id);
      throw new Error("upload failed");
    },
  });

  assert.deepEqual(processed, ["one"]);
  assert.equal(result.failure.photo.id, "one");
  assert.match(result.failure.error.message, /upload failed/);
});
