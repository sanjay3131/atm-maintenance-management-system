import test from "node:test";
import assert from "node:assert/strict";
import {
  chronologicalJobHistory,
  formatSupervisorJobLabel,
  isSupervisorJobDateRangeValid,
  isSupervisorJobId,
  SUPERVISOR_JOB_STATUSES,
  supervisorJobPhotoUrl,
} from "../src/features/supervisor/supervisorJobs.utils.ts";

test("supervisor job filters expose backend job statuses and readable labels", () => {
  assert.deepEqual(SUPERVISOR_JOB_STATUSES, [
    "PENDING",
    "ASSIGNED",
    "ACCEPTED",
    "IN_PROGRESS",
    "ON_HOLD",
    "COMPLETED",
    "VERIFIED",
    "APPROVED",
    "CLOSED",
    "REJECTED",
    "CANCELLED",
  ]);
  assert.equal(formatSupervisorJobLabel("IN_PROGRESS"), "In Progress");
});

test("supervisor job details validate ObjectIds and date range boundaries", () => {
  assert.equal(isSupervisorJobId("64b000000000000000000001"), true);
  assert.equal(isSupervisorJobId("not-an-object-id"), false);
  assert.equal(isSupervisorJobDateRangeValid("2026-10-20", "2026-10-20"), true);
  assert.equal(isSupervisorJobDateRangeValid("2026-10-21", "2026-10-20"), false);
  assert.equal(isSupervisorJobDateRangeValid("", "2026-10-20"), true);
});

test("job history is rendered chronologically without mutating API data", () => {
  const history = [
    { action: "completed", occurredAt: "2026-10-20T12:00:00.000Z" },
    { action: "assigned", occurredAt: "2026-10-19T12:00:00.000Z" },
  ];

  const ordered = chronologicalJobHistory(history);

  assert.deepEqual(
    ordered.map(({ action }) => action),
    ["assigned", "completed"],
  );
  assert.equal(history[0].action, "completed");
});

test("job photo URL selection falls back safely when a thumbnail is missing", () => {
  assert.equal(
    supervisorJobPhotoUrl({ thumbnailUrl: "thumb.jpg", url: "full.jpg" }),
    "thumb.jpg",
  );
  assert.equal(supervisorJobPhotoUrl({ url: "full.jpg" }), "full.jpg");
  assert.equal(supervisorJobPhotoUrl({}), undefined);
});
