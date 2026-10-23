import assert from "node:assert/strict";
import test from "node:test";
import {
  canLoadEmployeeMaterialUsage,
  getEmployeeFieldworkProgress,
  getEmployeeJobDetailsScreen,
  getEmployeeMaterialUsageVisibility,
} from "../src/features/jobs/utils/employeeJobDetails.utils.ts";
import { employeeLanguageClasses } from "../src/features/employee-portal/employeeLanguage.utils.ts";
import {
  getEmployeeJobsPage,
  getEmployeeJobsStatusChange,
  getEmployeeJobsStatusHref,
  parseEmployeeJobStatusFilter,
} from "../src/features/jobs/utils/employeeJobs.utils.ts";

test("employee layout class helper selects Tamil-only layout classes", () => {
  assert.equal(
    employeeLanguageClasses("ta", "english-layout", "tamil-layout"),
    "tamil-layout",
  );
  assert.equal(
    employeeLanguageClasses("en", "english-layout", "tamil-layout"),
    "english-layout",
  );
});

test("employee dashboard status links target supported server-filtered statuses", () => {
  assert.equal(getEmployeeJobsStatusHref(), "/employee/jobs");
  assert.equal(getEmployeeJobsStatusHref("ASSIGNED"), "/employee/jobs?status=ASSIGNED");
  assert.equal(getEmployeeJobsStatusHref("IN_PROGRESS"), "/employee/jobs?status=IN_PROGRESS");
  assert.equal(getEmployeeJobsStatusHref("COMPLETED"), "/employee/jobs?status=COMPLETED");
});

test("employee jobs list reads valid status filters from the URL", () => {
  assert.deepEqual(parseEmployeeJobStatusFilter(null), { kind: "all" });
  assert.deepEqual(parseEmployeeJobStatusFilter(""), { kind: "all" });
  assert.deepEqual(parseEmployeeJobStatusFilter("IN_PROGRESS"), {
    kind: "valid",
    status: "IN_PROGRESS",
  });
  assert.deepEqual(parseEmployeeJobStatusFilter("INVALID"), {
    kind: "invalid",
  });
});

test("changing or clearing the employee job status filter resets pagination", () => {
  assert.deepEqual(getEmployeeJobsStatusChange("ASSIGNED", 4), {
    status: "ASSIGNED",
    page: 1,
  });
  assert.deepEqual(getEmployeeJobsStatusChange("ALL", 3), {
    status: "ALL",
    page: 1,
  });
  assert.deepEqual(getEmployeeJobsStatusChange("COMPLETED", 1), {
    status: "COMPLETED",
    page: 1,
  });
  assert.equal(getEmployeeJobsPage("ASSIGNED", "IN_PROGRESS", 4), 1);
  assert.equal(getEmployeeJobsPage("IN_PROGRESS", "IN_PROGRESS", 4), 4);
  assert.equal(getEmployeeJobsPage("IN_PROGRESS", null, 2), 1);
});

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
