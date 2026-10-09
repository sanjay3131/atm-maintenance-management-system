import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Complaint from "../src/modules/complaints/complaints.model.js";
import {
  cancelJobAndPreserveComplaintHistory,
  createJobWithComplaint,
} from "../src/modules/complaints/complaintJobIntegrity.service.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import {
  acceptJob,
  approveJob,
  assignJob,
  cancelJob,
  closeJob,
  completeJob,
  holdJob,
  reassignJob,
  startJob,
  verifyJob,
} from "../src/modules/jobs/jobs.controller.js";
import { cancelJobSchema } from "../src/modules/jobs/jobs.validation.js";
import { JOB_STATUS, VALID_STATUS_TRANSITIONS } from "../src/utils/jobStatus.js";

const jobId = "64b000000000000000000081";
const complaintId = "64b000000000000000000082";
const replacementJobId = "64b000000000000000000083";
const adminId = "64b000000000000000000084";
const employeeId = "64b000000000000000000085";

const query = (value) => ({
  session() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const invoke = (handler, req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
      },
    };
    handler(req, res, (error) => resolve({ error }));
  });

async function withMocks(
  { status = JOB_STATUS.PENDING, complaint, usageRecords = [] } = {},
  callback,
) {
  const job = {
    _id: jobId,
    jobId: "JOB-20261009-001",
    atmId: "64b000000000000000000086",
    status,
    isDeleted: false,
    assignedEmployeeId: employeeId,
    complaintId: complaint ? complaintId : undefined,
    materialUsageRecords: usageRecords,
    async save() {
      return this;
    },
  };
  const complaintDoc = complaint
    ? {
        _id: complaintId,
        atmId: job.atmId,
        jobId,
        status: "RESOLVED",
        jobLinkHistory: [],
        async save() {
          return this;
        },
        ...complaint,
      }
    : null;
  const historyEntries = [];
  const createdJobs = [];
  const session = {
    async withTransaction(operation) {
      return operation(this);
    },
    async endSession() {},
  };
  const originals = [
    [mongoose, "startSession", mongoose.startSession],
    [Job, "findById", Job.findById],
    [Job, "create", Job.create],
    [Complaint, "findById", Complaint.findById],
    [Complaint, "findOne", Complaint.findOne],
    [JobHistory, "create", JobHistory.create],
  ];
  mongoose.startSession = async () => session;
  Job.findById = () => query(job);
  Job.create = async ([data]) => {
    const created = {
      _id: replacementJobId,
      ...data,
      async save() {
        return this;
      },
    };
    createdJobs.push(created);
    return [created];
  };
  Complaint.findById = () => query(complaintDoc);
  Complaint.findOne = () => query(null);
  JobHistory.create = async (entries) => {
    historyEntries.push(...entries);
    return entries;
  };

  try {
    await callback({ job, complaint: complaintDoc, historyEntries, createdJobs });
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

test("cancellation reason is required, trimmed, and bounded", () => {
  assert.equal(cancelJobSchema.safeParse({ reason: " \t " }).success, false);
  assert.equal(cancelJobSchema.safeParse({ reason: "x".repeat(1001) }).success, false);
  assert.equal(cancelJobSchema.parse({ reason: "  Duplicate request  " }).reason, "Duplicate request");
});

test("cancellation is allowed only from the explicitly eligible statuses", async () => {
  for (const status of [
    JOB_STATUS.PENDING,
    JOB_STATUS.ASSIGNED,
    JOB_STATUS.ACCEPTED,
    JOB_STATUS.ON_HOLD,
    JOB_STATUS.REJECTED,
  ]) {
    await withMocks({ status }, async ({ job, historyEntries }) => {
      await cancelJobAndPreserveComplaintHistory({
        jobId,
        cancelledBy: adminId,
        reason: "No longer required",
      });
      assert.equal(job.status, JOB_STATUS.CANCELLED);
      assert.equal(historyEntries[0].fromStatus, status);
    });
  }

  for (const status of [
    JOB_STATUS.IN_PROGRESS,
    JOB_STATUS.COMPLETED,
    JOB_STATUS.VERIFIED,
    JOB_STATUS.APPROVED,
    JOB_STATUS.CLOSED,
    JOB_STATUS.CANCELLED,
  ]) {
    await withMocks({ status }, async ({ job, historyEntries }) => {
      await assert.rejects(
        cancelJobAndPreserveComplaintHistory({
          jobId,
          cancelledBy: adminId,
          reason: "No longer required",
        }),
        { statusCode: 400 },
      );
      assert.equal(job.status, status);
      assert.equal(historyEntries.length, 0);
    });
  }
});

test("cancellation retains material snapshots, records audit fields, and releases an active complaint to history", async () => {
  const usageRecords = [
    {
      itemNameSnapshot: "Replacement part",
      quantity: 2,
      unitCostSnapshot: 12.5,
      lineCostSnapshot: 25,
    },
  ];

  await withMocks(
    {
      status: JOB_STATUS.REJECTED,
      complaint: { status: "RESOLVED" },
      usageRecords,
    },
    async ({ job, complaint, historyEntries }) => {
      const result = await cancelJobAndPreserveComplaintHistory({
        jobId,
        cancelledBy: adminId,
        reason: "  Work no longer required  ",
        req: { ip: "127.0.0.1", headers: {} },
      });

      assert.equal(result, job);
      assert.equal(job.status, JOB_STATUS.CANCELLED);
      assert.ok(job.cancelledAt instanceof Date);
      assert.equal(job.cancelledBy, adminId);
      assert.equal(job.cancellationReason, "Work no longer required");
      assert.equal(job.complaintId, complaintId);
      assert.deepEqual(job.materialUsageRecords, usageRecords);
      assert.equal(complaint.status, "OPEN");
      assert.equal(complaint.jobId, null);
      assert.equal(complaint.jobLinkHistory.length, 1);
      assert.equal(String(complaint.jobLinkHistory[0].jobId), jobId);
      assert.equal(
        complaint.jobLinkHistory[0].endReason,
        "Work no longer required",
      );
      assert.equal(historyEntries.length, 1);
      assert.equal(historyEntries[0].action, "cancelled");
      assert.equal(historyEntries[0].toStatus, JOB_STATUS.CANCELLED);
      assert.equal(
        historyEntries[0].details.previousComplaintStatus,
        "RESOLVED",
      );
    },
  );
});

test("a replacement complaint job preserves the cancelled job link history", async () => {
  await withMocks(
    {
      complaint: { status: "ASSIGNED" },
    },
    async ({ job, complaint, createdJobs }) => {
      await cancelJobAndPreserveComplaintHistory({
        jobId,
        cancelledBy: adminId,
        reason: "Assigning a replacement",
      });

      const replacement = await createJobWithComplaint({
        jobData: {
          jobId: "JOB-20261009-002",
          title: "Replacement repair",
          atmId: job.atmId,
          complaintId,
          createdBy: adminId,
        },
        updatedBy: adminId,
      });

      assert.equal(replacement._id, replacementJobId);
      assert.equal(createdJobs.length, 1);
      assert.equal(complaint.status, "ASSIGNED");
      assert.equal(String(complaint.jobId), replacementJobId);
      assert.equal(complaint.jobLinkHistory.length, 1);
      assert.equal(String(complaint.jobLinkHistory[0].jobId), jobId);
      assert.equal(job.complaintId, complaintId);
    },
  );
});

test("only Admin and SuperAdmin can invoke job cancellation", async () => {
  for (const userType of ["admin", "superAdmin"]) {
    await withMocks({}, async () => {
      const result = await invoke(cancelJob, {
        params: { id: jobId },
        body: { reason: "No longer required" },
        user: { _id: adminId, userType },
        headers: {},
      });
      assert.equal(result.error, undefined);
      assert.equal(result.statusCode, 200);
    });
  }

  await withMocks({}, async () => {
    const result = await invoke(cancelJob, {
      params: { id: jobId },
      body: { reason: "No longer required" },
      user: { _id: employeeId, userType: "employee" },
      headers: {},
    });
    assert.equal(result.error.statusCode, 403);
  });
});

test("cancelled jobs reject normal lifecycle actions", async () => {
  await withMocks({ status: JOB_STATUS.CANCELLED }, async () => {
    const cases = [
      [
        assignJob,
        { user: { _id: adminId, userType: "admin" }, body: { employeeId } },
      ],
      [acceptJob, { user: { _id: employeeId, userType: "employee" } }],
      [startJob, { user: { _id: employeeId, userType: "employee" } }],
      [completeJob, { user: { _id: employeeId, userType: "employee" } }],
      [
        verifyJob,
        { user: { _id: adminId, userType: "admin" }, body: { action: "verify" } },
      ],
      [
        approveJob,
        { user: { _id: adminId, userType: "admin" }, body: { action: "approve" } },
      ],
      [closeJob, { user: { _id: adminId, userType: "admin" } }],
      [
        reassignJob,
        {
          user: { _id: adminId, userType: "admin" },
          body: { employeeId, reason: "Not suitable" },
        },
      ],
      [holdJob, { user: { _id: adminId, userType: "admin" }, body: {} }],
    ];

    for (const [handler, overrides] of cases) {
      const result = await invoke(handler, {
        params: { id: jobId },
        body: {},
        headers: {},
        ...overrides,
      });
      assert.equal(result.error?.statusCode, 400);
    }
  });
});

test("job transition table adds cancellation only to allowed states", () => {
  for (const status of [
    JOB_STATUS.PENDING,
    JOB_STATUS.ASSIGNED,
    JOB_STATUS.ACCEPTED,
    JOB_STATUS.ON_HOLD,
    JOB_STATUS.REJECTED,
  ]) {
    assert.ok(VALID_STATUS_TRANSITIONS[status].includes(JOB_STATUS.CANCELLED));
  }
  for (const status of [
    JOB_STATUS.IN_PROGRESS,
    JOB_STATUS.COMPLETED,
    JOB_STATUS.VERIFIED,
    JOB_STATUS.APPROVED,
    JOB_STATUS.CLOSED,
    JOB_STATUS.CANCELLED,
  ]) {
    assert.ok(!VALID_STATUS_TRANSITIONS[status].includes(JOB_STATUS.CANCELLED));
  }
});
