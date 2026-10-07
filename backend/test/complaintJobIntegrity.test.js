import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Complaint from "../src/modules/complaints/complaints.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import {
  createJobWithComplaint,
  closeJobAndComplaint,
  linkComplaintAndJob,
  softDeleteComplaintAndUnlinkJob,
  softDeleteJobAndUnlinkComplaint,
  unlinkComplaintAndJob,
} from "../src/modules/complaints/complaintJobIntegrity.service.js";

const atmA = "64b000000000000000000001";
const atmB = "64b000000000000000000002";
const complaintA = "64b000000000000000000011";
const complaintB = "64b000000000000000000012";
const jobA = "64b000000000000000000021";
const jobB = "64b000000000000000000022";
const createdJobId = "64b000000000000000000031";

const cloneDocument = (document) =>
  Object.fromEntries(
    Object.entries(document).filter(([, value]) => typeof value !== "function"),
  );

const attachSave = (document, type, state) => {
  document.save = async () => {
    if (state.failSave === type) throw new Error(`${type} write failed`);
    return document;
  };
  return document;
};

const query = (value) => ({
  session: async () => value,
});

async function withHarness(seed, callback, { failSave } = {}) {
  const state = {
    complaints: new Map(),
    jobs: new Map(),
    failSave,
  };

  for (const complaint of seed.complaints ?? []) {
    const document = { isDeleted: false, status: "OPEN", ...complaint };
    state.complaints.set(String(document._id), attachSave(document, "complaint", state));
  }
  for (const job of seed.jobs ?? []) {
    const document = { isDeleted: false, ...job };
    state.jobs.set(String(document._id), attachSave(document, "job", state));
  }

  const session = {
    async withTransaction(operation) {
      const complaintsBefore = [...state.complaints].map(([id, item]) => [
        id,
        cloneDocument(item),
      ]);
      const jobsBefore = [...state.jobs].map(([id, item]) => [
        id,
        cloneDocument(item),
      ]);
      try {
        return await operation(this);
      } catch (error) {
        state.complaints = new Map(
          complaintsBefore.map(([id, item]) => [
            id,
            attachSave(item, "complaint", state),
          ]),
        );
        state.jobs = new Map(
          jobsBefore.map(([id, item]) => [id, attachSave(item, "job", state)]),
        );
        throw error;
      }
    },
    async endSession() {},
  };

  const overrides = [
    [mongoose, "startSession", async () => session],
    [
      Complaint,
      "findById",
      (id) => query(state.complaints.get(String(id)) ?? null),
    ],
    [
      Complaint,
      "findOne",
      (filter) =>
        query(
          [...state.complaints.values()].find(
            (item) =>
              String(item.jobId) === String(filter.jobId) &&
              item.isDeleted === filter.isDeleted,
          ) ?? null,
        ),
    ],
    [Job, "findById", (id) => query(state.jobs.get(String(id)) ?? null)],
    [
      Job,
      "create",
      async ([data]) => {
        const created = attachSave(
          { _id: createdJobId, ...data },
          "job",
          state,
        );
        state.jobs.set(String(created._id), created);
        return [created];
      },
    ],
  ];

  const originals = overrides.map(([target, key]) => [
    target,
    key,
    target[key],
  ]);
  for (const [target, key, value] of overrides) target[key] = value;

  try {
    await callback(state);
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

const complaint = (id, overrides = {}) => ({
  _id: id,
  atmId: atmA,
  ...overrides,
});

const job = (id, overrides = {}) => ({
  _id: id,
  atmId: atmA,
  ...overrides,
});

test("links both sides and safely repeats the same link", async () => {
  await withHarness(
    { complaints: [complaint(complaintA)], jobs: [job(jobA)] },
    async (state) => {
      await linkComplaintAndJob({
        complaintId: complaintA,
        jobId: jobA,
        updatedBy: "admin",
      });
      await linkComplaintAndJob({
        complaintId: complaintA,
        jobId: jobA,
        updatedBy: "admin",
      });

      assert.equal(state.complaints.get(complaintA).jobId, jobA);
      assert.equal(state.jobs.get(jobA).complaintId, complaintA);
      assert.equal(state.complaints.get(complaintA).status, "ASSIGNED");
    },
  );
});

test("repeating an existing link does not regress its Complaint status", async () => {
  await withHarness(
    {
      complaints: [complaint(complaintA, { jobId: jobA, status: "IN_PROGRESS" })],
      jobs: [job(jobA, { complaintId: complaintA, status: "IN_PROGRESS" })],
    },
    async (state) => {
      await linkComplaintAndJob({
        complaintId: complaintA,
        jobId: jobA,
        updatedBy: "admin",
      });
      assert.equal(state.complaints.get(complaintA).status, "IN_PROGRESS");
      assert.equal(state.complaints.get(complaintA).jobId, jobA);
      assert.equal(state.jobs.get(jobA).complaintId, complaintA);
    },
  );
});

test("rejects a Complaint linked to a different active Job without changing either relationship", async () => {
  await withHarness(
    {
      complaints: [complaint(complaintA, { jobId: jobA })],
      jobs: [job(jobA, { complaintId: complaintA }), job(jobB)],
    },
    async (state) => {
      await assert.rejects(
        linkComplaintAndJob({
          complaintId: complaintA,
          jobId: jobB,
          updatedBy: "admin",
        }),
        { statusCode: 409 },
      );
      assert.equal(state.complaints.get(complaintA).jobId, jobA);
      assert.equal(state.jobs.get(jobA).complaintId, complaintA);
      assert.equal(state.jobs.get(jobB).complaintId, undefined);
    },
  );
});

test("rejects a Job linked to a different active Complaint without changing either relationship", async () => {
  await withHarness(
    {
      complaints: [complaint(complaintA), complaint(complaintB, { jobId: jobB })],
      jobs: [job(jobB, { complaintId: complaintB }), job(jobA, { complaintId: complaintA })],
    },
    async (state) => {
      await assert.rejects(
        linkComplaintAndJob({
          complaintId: complaintA,
          jobId: jobB,
          updatedBy: "admin",
        }),
        { statusCode: 409 },
      );
      assert.equal(state.complaints.get(complaintA).jobId, undefined);
      assert.equal(state.jobs.get(jobB).complaintId, complaintB);
      assert.equal(state.complaints.get(complaintB).jobId, jobB);
    },
  );
});

test("rejects ATM mismatch without modifying either side", async () => {
  await withHarness(
    {
      complaints: [complaint(complaintA)],
      jobs: [job(jobA, { atmId: atmB })],
    },
    async (state) => {
      await assert.rejects(
        linkComplaintAndJob({
          complaintId: complaintA,
          jobId: jobA,
          updatedBy: "admin",
        }),
        { statusCode: 400 },
      );
      assert.equal(state.complaints.get(complaintA).jobId, undefined);
      assert.equal(state.jobs.get(jobA).complaintId, undefined);
    },
  );
});

test("rejects missing and soft-deleted Complaints and Jobs", async () => {
  await withHarness(
    {
      complaints: [
        complaint(complaintA),
        complaint(complaintB, { isDeleted: true }),
      ],
      jobs: [job(jobA), job(jobB, { isDeleted: true })],
    },
    async () => {
      await assert.rejects(
        linkComplaintAndJob({
          complaintId: "64b000000000000000000099",
          jobId: jobA,
          updatedBy: "admin",
        }),
        { statusCode: 404 },
      );
      await assert.rejects(
        linkComplaintAndJob({
          complaintId: complaintB,
          jobId: jobA,
          updatedBy: "admin",
        }),
        { statusCode: 404 },
      );
      await assert.rejects(
        linkComplaintAndJob({
          complaintId: complaintA,
          jobId: "64b000000000000000000098",
          updatedBy: "admin",
        }),
        { statusCode: 404 },
      );
      await assert.rejects(
        linkComplaintAndJob({
          complaintId: complaintA,
          jobId: jobB,
          updatedBy: "admin",
        }),
        { statusCode: 404 },
      );
    },
  );
});

test("creates a Job with an active same-ATM Complaint and synchronizes both sides", async () => {
  await withHarness(
    { complaints: [complaint(complaintA)] },
    async (state) => {
      const created = await createJobWithComplaint({
        jobData: { title: "Repair", atmId: atmA, complaintId: complaintA },
        updatedBy: "admin",
      });
      assert.equal(created._id, createdJobId);
      assert.equal(state.complaints.get(complaintA).jobId, createdJobId);
      assert.equal(state.jobs.get(createdJobId).complaintId, complaintA);
    },
  );
});

test("does not create a Job for a missing, deleted, mismatched, or already linked Complaint", async () => {
  await withHarness(
    {
      complaints: [
        complaint(complaintA),
        complaint(complaintB, { isDeleted: true }),
        complaint("64b000000000000000000013", { jobId: jobA }),
      ],
      jobs: [job(jobA, { complaintId: "64b000000000000000000013" })],
    },
    async (state) => {
      const create = (complaintId, atmId = atmA) =>
        createJobWithComplaint({
          jobData: { title: "Repair", atmId, complaintId },
          updatedBy: "admin",
        });

      await assert.rejects(create("64b000000000000000000099"), {
        statusCode: 404,
      });
      await assert.rejects(create(complaintB), { statusCode: 404 });
      await assert.rejects(create(complaintA, atmB), { statusCode: 400 });
      await assert.rejects(
        create("64b000000000000000000013"),
        { statusCode: 409 },
      );
      assert.equal(state.jobs.has(createdJobId), false);
      assert.equal(state.complaints.get(complaintA).jobId, undefined);
    },
  );
});

test("unlinks both sides and cleans a dangling Complaint reference", async () => {
  await withHarness(
    {
      complaints: [
        complaint(complaintA, { jobId: jobA, status: "ASSIGNED" }),
        complaint(complaintB, {
          jobId: "64b000000000000000000099",
          status: "ASSIGNED",
        }),
      ],
      jobs: [job(jobA, { complaintId: complaintA })],
    },
    async (state) => {
      await unlinkComplaintAndJob({
        complaintId: complaintA,
        updatedBy: "admin",
      });
      await unlinkComplaintAndJob({
        complaintId: complaintB,
        updatedBy: "admin",
      });
      assert.equal(state.complaints.get(complaintA).jobId, null);
      assert.equal(state.jobs.get(jobA).complaintId, null);
      assert.equal(state.complaints.get(complaintB).jobId, null);
      assert.equal(state.complaints.get(complaintB).status, "OPEN");
    },
  );
});

test("unlinking a mismatched Complaint does not clear another Complaint's Job relationship", async () => {
  await withHarness(
    {
      complaints: [
        complaint(complaintA, { jobId: jobA, status: "OPEN" }),
        complaint(complaintB, { jobId: jobA, status: "ASSIGNED" }),
      ],
      jobs: [job(jobA, { complaintId: complaintA })],
    },
    async (state) => {
      await unlinkComplaintAndJob({
        complaintId: complaintB,
        updatedBy: "admin",
      });
      assert.equal(state.complaints.get(complaintB).jobId, null);
      assert.equal(state.jobs.get(jobA).complaintId, complaintA);
      assert.equal(state.complaints.get(complaintA).jobId, jobA);
    },
  );
});

test("does not reopen a CLOSED Complaint through unlink", async () => {
  await withHarness(
    {
      complaints: [complaint(complaintA, { jobId: jobA, status: "CLOSED" })],
      jobs: [job(jobA, { complaintId: complaintA })],
    },
    async (state) => {
      await assert.rejects(
        unlinkComplaintAndJob({
          complaintId: complaintA,
          updatedBy: "admin",
        }),
        { statusCode: 400 },
      );
      assert.equal(state.complaints.get(complaintA).status, "CLOSED");
      assert.equal(state.complaints.get(complaintA).jobId, jobA);
      assert.equal(state.jobs.get(jobA).complaintId, complaintA);
    },
  );
});

test("soft-deleting a Job clears both active relationship references", async () => {
  await withHarness(
    {
      complaints: [complaint(complaintA, { jobId: jobA })],
      jobs: [job(jobA, { complaintId: complaintA })],
    },
    async (state) => {
      await softDeleteJobAndUnlinkComplaint({
        jobId: jobA,
        deletedBy: "admin",
      });
      assert.equal(state.jobs.get(jobA).isDeleted, true);
      assert.equal(state.jobs.get(jobA).complaintId, null);
      assert.equal(state.complaints.get(complaintA).jobId, null);
    },
  );
});

test("soft-deleting a Complaint clears both active relationship references", async () => {
  await withHarness(
    {
      complaints: [complaint(complaintA, { jobId: jobA })],
      jobs: [job(jobA, { complaintId: complaintA })],
    },
    async (state) => {
      await softDeleteComplaintAndUnlinkJob({
        complaintId: complaintA,
        deletedBy: "admin",
      });
      assert.equal(state.complaints.get(complaintA).isDeleted, true);
      assert.equal(state.complaints.get(complaintA).jobId, null);
      assert.equal(state.jobs.get(jobA).complaintId, null);
    },
  );
});

test("failed reciprocal write rolls back both relationship documents", async () => {
  await withHarness(
    {
      complaints: [complaint(complaintA)],
      jobs: [job(jobA)],
    },
    async (state) => {
      state.failSave = "job";
      await assert.rejects(
        linkComplaintAndJob({
          complaintId: complaintA,
          jobId: jobA,
          updatedBy: "admin",
        }),
        /job write failed/,
      );
      assert.equal(state.complaints.get(complaintA).jobId, undefined);
      assert.equal(state.jobs.get(jobA).complaintId, undefined);
    },
  );
});

test("failed Complaint write rolls back Job creation and its relationship", async () => {
  await withHarness(
    { complaints: [complaint(complaintA)] },
    async (state) => {
      state.failSave = "complaint";
      await assert.rejects(
        createJobWithComplaint({
          jobData: { title: "Repair", atmId: atmA, complaintId: complaintA },
          updatedBy: "admin",
        }),
        /complaint write failed/,
      );
      assert.equal(state.jobs.has(createdJobId), false);
      assert.equal(state.complaints.get(complaintA).jobId, undefined);
    },
  );
});

test("closing an approved Job closes its linked Complaint and preserves both references", async () => {
  await withHarness(
    {
      complaints: [complaint(complaintA, { jobId: jobA, status: "IN_PROGRESS" })],
      jobs: [
        job(jobA, {
          complaintId: complaintA,
          status: "APPROVED",
        }),
      ],
    },
    async (state) => {
      const closedBy = "admin-user";
      const result = await closeJobAndComplaint({ jobId: jobA, closedBy });
      const closedComplaint = state.complaints.get(complaintA);
      assert.equal(result.status, "CLOSED");
      assert.equal(closedComplaint.status, "CLOSED");
      assert.ok(closedComplaint.closedAt instanceof Date);
      assert.equal(closedComplaint.closedBy, closedBy);
      assert.equal(closedComplaint.updatedBy, closedBy);
      assert.equal(state.jobs.get(jobA).complaintId, complaintA);
      assert.equal(closedComplaint.jobId, jobA);
    },
  );
});

test("failed Complaint closure rolls back the Job close", async () => {
  await withHarness(
    {
      complaints: [complaint(complaintA, { jobId: jobA, status: "IN_PROGRESS" })],
      jobs: [job(jobA, { complaintId: complaintA, status: "APPROVED" })],
    },
    async (state) => {
      state.failSave = "complaint";
      await assert.rejects(
        closeJobAndComplaint({ jobId: jobA, closedBy: "admin-user" }),
        /complaint write failed/,
      );
      assert.equal(state.jobs.get(jobA).status, "APPROVED");
      assert.equal(state.complaints.get(complaintA).status, "IN_PROGRESS");
    },
  );
});

test("closing the linked Job does not reopen or overwrite an already-closed Complaint", async () => {
  const originalClosedAt = new Date("2026-10-01T00:00:00.000Z");
  await withHarness(
    {
      complaints: [
        complaint(complaintA, {
          jobId: jobA,
          status: "CLOSED",
          closedAt: originalClosedAt,
          closedBy: "original-admin",
        }),
      ],
      jobs: [job(jobA, { complaintId: complaintA, status: "APPROVED" })],
    },
    async (state) => {
      await closeJobAndComplaint({ jobId: jobA, closedBy: "closing-admin" });
      const closedComplaint = state.complaints.get(complaintA);
      assert.equal(state.jobs.get(jobA).status, "CLOSED");
      assert.equal(closedComplaint.status, "CLOSED");
      assert.equal(closedComplaint.closedAt, originalClosedAt);
      assert.equal(closedComplaint.closedBy, "original-admin");
      assert.equal(closedComplaint.jobId, jobA);
      assert.equal(state.jobs.get(jobA).complaintId, complaintA);
    },
  );
});

test("closes an ordinary Job without a Complaint", async () => {
  await withHarness(
    { jobs: [job(jobA, { status: "APPROVED" })] },
    async (state) => {
      await closeJobAndComplaint({ jobId: jobA, closedBy: "admin-user" });
      assert.equal(state.jobs.get(jobA).status, "CLOSED");
    },
  );
});

test("does not close a Job with a soft-deleted linked Complaint", async () => {
  await withHarness(
    {
      complaints: [complaint(complaintA, { jobId: jobA, isDeleted: true })],
      jobs: [job(jobA, { complaintId: complaintA, status: "APPROVED" })],
    },
    async (state) => {
      await assert.rejects(
        closeJobAndComplaint({ jobId: jobA, closedBy: "admin-user" }),
        { statusCode: 404 },
      );
      assert.equal(state.jobs.get(jobA).status, "APPROVED");
      assert.equal(state.complaints.get(complaintA).status, "OPEN");
    },
  );
});

test("does not close a Job whose Complaint relationship is not reciprocal", async () => {
  await withHarness(
    {
      complaints: [complaint(complaintA, { jobId: jobB })],
      jobs: [job(jobA, { complaintId: complaintA, status: "APPROVED" })],
    },
    async (state) => {
      await assert.rejects(
        closeJobAndComplaint({ jobId: jobA, closedBy: "admin-user" }),
        { statusCode: 409 },
      );
      assert.equal(state.jobs.get(jobA).status, "APPROVED");
      assert.equal(state.complaints.get(complaintA).status, "OPEN");
    },
  );
});
