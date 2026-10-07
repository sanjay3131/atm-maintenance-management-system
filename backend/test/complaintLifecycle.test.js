import test from "node:test";
import assert from "node:assert/strict";
import Complaint from "../src/modules/complaints/complaints.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import { updateComplaint } from "../src/modules/complaints/complaints.controller.js";

const complaintId = "64b000000000000000000011";
const jobId = "64b000000000000000000021";
const atmId = "64b000000000000000000001";

async function withOverrides(overrides, callback) {
  const originals = overrides.map(([target, key]) => [
    target,
    key,
    target[key],
  ]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    await callback();
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

const invoke = (handler, req) =>
  new Promise((resolve) => {
    const res = {
      status() {
        return this;
      },
      json(body) {
        resolve({ body });
      },
    };
    handler(req, res, (error) => resolve({ error }));
  });

const makeComplaint = (overrides = {}) => ({
  _id: complaintId,
  atmId,
  isDeleted: false,
  status: "RESOLVED",
  async save() {
    return this;
  },
  ...overrides,
});

const makeJob = (overrides = {}) => ({
  _id: jobId,
  atmId,
  complaintId,
  isDeleted: false,
  ...overrides,
});

const request = (body) => ({
  params: { id: complaintId },
  body,
  user: { _id: "admin-user", userType: "admin" },
});

test("rejects manual Complaint closure while its linked Job is active", async () => {
  const currentComplaint = makeComplaint({ jobId });
  await withOverrides(
    [
      [Complaint, "findById", async () => currentComplaint],
      [Job, "findById", async () => makeJob({ status: "APPROVED" })],
    ],
    async () => {
      const result = await invoke(updateComplaint, request({ status: "CLOSED" }));
      assert.equal(result.error.statusCode, 400);
      assert.equal(currentComplaint.status, "RESOLVED");
    },
  );
});

test("rejects manual Complaint closure without a linked Job", async () => {
  const currentComplaint = makeComplaint();
  await withOverrides(
    [[Complaint, "findById", async () => currentComplaint]],
    async () => {
      const result = await invoke(updateComplaint, request({ status: "CLOSED" }));
      assert.equal(result.error.statusCode, 400);
      assert.equal(currentComplaint.status, "RESOLVED");
    },
  );
});

test("rejects manual ASSIGNED status without a linked Job", async () => {
  const currentComplaint = makeComplaint({ status: "OPEN" });
  await withOverrides(
    [[Complaint, "findById", async () => currentComplaint]],
    async () => {
      const result = await invoke(
        updateComplaint,
        request({ status: "ASSIGNED" }),
      );
      assert.equal(result.error.statusCode, 400);
      assert.equal(currentComplaint.status, "OPEN");
    },
  );
});

test("rejects manual Complaint closure when the linked Job is not CLOSED", async () => {
  const currentComplaint = makeComplaint({ jobId });
  await withOverrides(
    [
      [Complaint, "findById", async () => currentComplaint],
      [Job, "findById", async () => makeJob({ status: "IN_PROGRESS" })],
    ],
    async () => {
      const result = await invoke(updateComplaint, request({ status: "CLOSED" }));
      assert.equal(result.error.statusCode, 400);
      assert.equal(currentComplaint.status, "RESOLVED");
    },
  );
});

test("rejects RESOLVED while the linked Job is still in progress", async () => {
  const currentComplaint = makeComplaint({
    status: "IN_PROGRESS",
    jobId,
  });
  await withOverrides(
    [
      [Complaint, "findById", async () => currentComplaint],
      [Job, "findById", async () => makeJob({ status: "IN_PROGRESS" })],
    ],
    async () => {
      const result = await invoke(
        updateComplaint,
        request({ status: "RESOLVED" }),
      );
      assert.equal(result.error.statusCode, 400);
      assert.equal(currentComplaint.status, "IN_PROGRESS");
    },
  );
});

test("does not allow a CLOSED Complaint to be reopened", async () => {
  const currentComplaint = makeComplaint({
    status: "CLOSED",
    jobId,
  });
  await withOverrides(
    [[Complaint, "findById", async () => currentComplaint]],
    async () => {
      const result = await invoke(updateComplaint, request({ status: "OPEN" }));
      assert.equal(result.error.statusCode, 400);
      assert.equal(currentComplaint.status, "CLOSED");
    },
  );
});
