import assert from "node:assert/strict";
import test from "node:test";
import {
  canLoadEmployeeMaterialUsage,
  getEmployeeFieldworkProgress,
  getEmployeeJobDetailsScreen,
  getEmployeeMaterialUsageVisibility,
} from "../src/features/jobs/utils/employeeJobDetails.utils.ts";

test("employee job detail screens follow authoritative job status", () => {
  assert.equal(getEmployeeJobDetailsScreen("ASSIGNED"), "assigned");
  assert.equal(getEmployeeJobDetailsScreen("ACCEPTED"), "accepted");
  assert.equal(getEmployeeJobDetailsScreen("ON_HOLD"), "accepted");
  assert.equal(getEmployeeJobDetailsScreen("IN_PROGRESS"), "in-progress");
  assert.equal(getEmployeeJobDetailsScreen("COMPLETED"), "completed");
  assert.equal(getEmployeeJobDetailsScreen("VERIFIED"), "completed");
  assert.equal(getEmployeeJobDetailsScreen("APPROVED"), "completed");
  assert.equal(getEmployeeJobDetailsScreen("CLOSED"), "completed");
  assert.equal(getEmployeeJobDetailsScreen("REJECTED"), "other");
});

test("does not load employee material history before job acceptance", () => {
  assert.equal(canLoadEmployeeMaterialUsage("PENDING"), false);
  assert.equal(canLoadEmployeeMaterialUsage("ASSIGNED"), false);
  assert.equal(canLoadEmployeeMaterialUsage("ACCEPTED"), true);
  assert.equal(canLoadEmployeeMaterialUsage("IN_PROGRESS"), true);
});

test("shows recorded materials only when actual usage exists", () => {
  assert.deepEqual(
    getEmployeeMaterialUsageVisibility("IN_PROGRESS", 0),
    { canRecord: true, showUsage: false },
  );
  assert.deepEqual(
    getEmployeeMaterialUsageVisibility("COMPLETED", 0),
    { canRecord: false, showUsage: false },
  );
  assert.deepEqual(
    getEmployeeMaterialUsageVisibility("IN_PROGRESS", 2),
    { canRecord: true, showUsage: true },
  );
  assert.deepEqual(
    getEmployeeMaterialUsageVisibility("COMPLETED", 1),
    { canRecord: false, showUsage: true },
  );
  assert.deepEqual(
    getEmployeeMaterialUsageVisibility("ACCEPTED", 0),
    { canRecord: false, showUsage: false },
  );
  assert.deepEqual(
    getEmployeeMaterialUsageVisibility("IN_PROGRESS", 1),
    { canRecord: true, showUsage: true },
  );
});

test("fieldwork progress counts only persisted photos with usable URLs", () => {
  assert.deepEqual(
    getEmployeeFieldworkProgress({
      beforePhotos: [
        { photoType: "before", url: "/before-1.jpg" },
        { photoType: "after", url: "/wrong-type.jpg" },
        { photoType: "before", url: null },
        null,
      ],
      afterPhotos: [
        { photoType: "after", url: "/after-1.jpg" },
        { photoType: "after", url: "/after-2.jpg" },
      ],
    }),
    { before: 1, after: 2, uploaded: 3, required: 6, percent: 50 },
  );
});

test("fieldwork progress caps photo counts at the existing requirement", () => {
  const photos = Array.from({ length: 5 }, (_, index) => ({
    photoType: "before",
    url: `/before-${index}.jpg`,
  }));

  assert.deepEqual(
    getEmployeeFieldworkProgress({
      beforePhotos: photos,
      afterPhotos: photos.map((photo) => ({
        ...photo,
        photoType: "after",
      })),
    }),
    { before: 3, after: 3, uploaded: 6, required: 6, percent: 100 },
  );
});
