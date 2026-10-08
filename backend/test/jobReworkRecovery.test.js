import test from "node:test";
import assert from "node:assert/strict";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import ATM from "../src/modules/atms/atm.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import {
  acceptJob,
  approveJob,
  completeJob,
  reassignJob,
  startJob,
  verifyJob,
} from "../src/modules/jobs/jobs.controller.js";

const jobId = "64b000000000000000000041";
const employeeUserId = "64b000000000000000000042";
const employeeId = "64b000000000000000000046";
const otherEmployeeUserId = "64b000000000000000000043";
const adminUserId = "64b000000000000000000044";
const atmId = "64b000000000000000000045";

const makeQuery = (job) => ({
  populate() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(job).then(resolve, reject);
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

async function withMocks({ status = "COMPLETED", eligible = true }, callback) {
  const job = {
    _id: jobId,
    atmId,
    assignedEmployeeId: employeeUserId,
    assignedBy: adminUserId,
    status,
    isDeleted: false,
    beforePhotos: ["old-before-1", "old-before-2", "old-before-3"],
    afterPhotos: ["old-after-1", "old-after-2", "old-after-3"],
    reassignmentHistory: [],
    acceptedAt: new Date("2025-01-01T00:00:00Z"),
    startedAt: new Date("2025-01-01T01:00:00Z"),
    completedAt: new Date("2025-01-01T02:00:00Z"),
    verifiedAt:
      status === "VERIFIED" ? new Date("2025-01-01T03:00:00Z") : undefined,
    approvedAt: undefined,
    employeeGpsAtCompletion: {
      latitude: 1,
      longitude: 2,
      accuracy: 5,
      timestamp: new Date("2025-01-01T02:00:00Z"),
    },
    gpsDistance: 4,
    gpsValidated: true,
    employeeRemarks: "Previous work",
    adminRemarks: "Previous review",
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
  };
  const historyEntries = [];
  const atm = {
    assignedEmployeeId: [employeeId],
    locationConfigured: true,
    location: { coordinates: [0, 0] },
  };
  const employee = eligible
    ? {
        _id: employeeId,
        status: "active",
        userId: { status: "active", userType: "employee" },
      }
    : null;
  const originals = [
    [Job, "findById", Job.findById],
    [JobHistory, "create", JobHistory.create],
    [JobPhoto, "countDocuments", JobPhoto.countDocuments],
    [ATM, "findById", ATM.findById],
    [Employee, "findOne", Employee.findOne],
  ];

  JobHistory.create = async (entry) => {
    historyEntries.push(entry);
    return entry;
  };
  JobPhoto.countDocuments = async (filter) =>
    filter.photoType === "before"
      ? job.beforePhotos.length
      : job.afterPhotos.length;
  ATM.findById = async () => atm;
  Employee.findOne = () => ({
    populate: async () => employee,
  });

  const call = async (handler, req) => {
    let lookupCount = 0;
    Job.findById = () => {
      lookupCount += 1;
      return lookupCount % 2 === 1 ? job : makeQuery(job);
    };
    return invoke(handler, req);
  };

  try {
    await callback({ job, historyEntries, call });
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

const adminRejectRequest = (status) => ({
  params: { id: jobId },
  body: { action: "reject", remarks: "Please redo the cleaning" },
  user: { _id: adminUserId, userType: "admin" },
  headers: {},
  status,
});

test("Admin rejection returns an eligible employee to ASSIGNED and archives the prior attempt", async () => {
  await withMocks({}, async ({ job, historyEntries, call }) => {
    const result = await call(verifyJob, adminRejectRequest("COMPLETED"));

    assert.equal(result.error, undefined);
    assert.equal(job.status, "ASSIGNED");
    assert.equal(job.assignedEmployeeId, employeeUserId);
    assert.equal(job.rejectionReason, "Please redo the cleaning");
    assert.ok(job.rejectedAt instanceof Date);
    assert.equal(job.acceptedAt, undefined);
    assert.equal(job.startedAt, undefined);
    assert.equal(job.completedAt, undefined);
    assert.equal(job.verifiedAt, undefined);
    assert.equal(job.approvedAt, undefined);
    assert.equal(job.employeeGpsAtCompletion, undefined);
    assert.equal(job.gpsDistance, undefined);
    assert.equal(job.gpsValidated, false);
    assert.deepEqual(job.beforePhotos, []);
    assert.deepEqual(job.afterPhotos, []);
    assert.equal(job.saveCalls, 1);
    assert.equal(historyEntries.length, 2);
    assert.equal(historyEntries[0].action, "rejected");
    assert.equal(historyEntries[0].fromStatus, "COMPLETED");
    assert.equal(historyEntries[0].toStatus, "REJECTED");
    assert.deepEqual(historyEntries[0].details.previousAttempt.beforePhotoIds, [
      "old-before-1",
      "old-before-2",
      "old-before-3",
    ]);
    assert.equal(
      historyEntries[0].details.previousAttempt.employeeRemarks,
      "Previous work",
    );
    assert.equal(historyEntries[1].action, "status_changed");
    assert.equal(historyEntries[1].fromStatus, "REJECTED");
    assert.equal(historyEntries[1].toStatus, "ASSIGNED");
    assert.match(historyEntries[1].details.reason, /rework/);
  });
});

test("Admin rejection at approval returns eligible work for rework too", async () => {
  await withMocks({ status: "VERIFIED" }, async ({ job, historyEntries, call }) => {
    const result = await call(approveJob, adminRejectRequest("VERIFIED"));

    assert.equal(result.error, undefined);
    assert.equal(job.status, "ASSIGNED");
    assert.equal(job.rejectionReason, "Please redo the cleaning");
    assert.equal(historyEntries[0].fromStatus, "VERIFIED");
    assert.equal(historyEntries[0].toStatus, "REJECTED");
    assert.equal(historyEntries[0].details.previousAttempt.verifiedAt.toISOString(),
      "2025-01-01T03:00:00.000Z");
    assert.equal(historyEntries[1].toStatus, "ASSIGNED");
  });
});

test("ineligible assigned employees remain REJECTED for Admin reassignment", async () => {
  await withMocks({ eligible: false }, async ({ job, historyEntries, call }) => {
    const result = await call(verifyJob, adminRejectRequest("COMPLETED"));

    assert.equal(result.error, undefined);
    assert.equal(job.status, "REJECTED");
    assert.equal(job.assignedEmployeeId, employeeUserId);
    assert.equal(job.rejectionReason, "Please redo the cleaning");
    assert.deepEqual(job.beforePhotos, []);
    assert.deepEqual(job.afterPhotos, []);
    assert.equal(job.completedAt, undefined);
    assert.equal(job.gpsValidated, false);
    assert.equal(historyEntries.length, 1);
    assert.equal(historyEntries[0].toStatus, "REJECTED");
  });
});

test("Admin reassignment of a legacy rejected Job archives and clears its old attempt", async () => {
  await withMocks({ status: "REJECTED" }, async ({ job, historyEntries, call }) => {
    const result = await call(reassignJob, {
      params: { id: jobId },
      body: {
        employeeId: employeeUserId,
        reason: "Employee eligibility restored",
      },
      user: { _id: adminUserId, userType: "admin" },
      headers: {},
    });

    assert.equal(result.error, undefined);
    assert.equal(job.status, "ASSIGNED");
    assert.deepEqual(job.beforePhotos, []);
    assert.deepEqual(job.afterPhotos, []);
    assert.equal(job.completedAt, undefined);
    assert.equal(job.gpsValidated, false);
    assert.equal(job.reassignmentHistory.length, 1);
    assert.deepEqual(
      historyEntries[0].details.previousAttempt.afterPhotoIds,
      ["old-after-1", "old-after-2", "old-after-3"],
    );
  });
});

test("the recovered employee can accept and start, but must submit fresh evidence and GPS", async () => {
  await withMocks({}, async ({ job, historyEntries, call }) => {
    await call(verifyJob, adminRejectRequest("COMPLETED"));

    const employeeRequest = {
      params: { id: jobId },
      user: { _id: employeeUserId, userType: "employee" },
      headers: {},
      body: {},
    };
    assert.equal((await call(acceptJob, employeeRequest)).error, undefined);
    assert.equal(job.status, "ACCEPTED");
    assert.equal((await call(startJob, employeeRequest)).error, undefined);
    assert.equal(job.status, "IN_PROGRESS");

    let result = await call(completeJob, {
      ...employeeRequest,
      body: { gps: { latitude: 0, longitude: 0, accuracy: 5 } },
    });
    assert.equal(result.error.statusCode, 400);
    assert.match(result.error.message, /At least 3 before photos are required/);
    assert.equal(job.status, "IN_PROGRESS");

    job.beforePhotos = ["new-before-1", "new-before-2", "new-before-3"];
    job.afterPhotos = ["new-after-1", "new-after-2", "new-after-3"];
    result = await call(completeJob, {
      ...employeeRequest,
      body: { gps: { latitude: 0.01, longitude: 0, accuracy: 5 } },
    });
    assert.equal(result.error.statusCode, 403);
    assert.equal(job.status, "IN_PROGRESS");

    result = await call(completeJob, {
      ...employeeRequest,
      body: { gps: { latitude: 0, longitude: 0, accuracy: 5 } },
    });
    assert.equal(result.error, undefined);
    assert.equal(job.status, "COMPLETED");
    assert.equal(job.gpsValidated, true);
    assert.equal(job.employeeGpsAtCompletion.latitude, 0);

    result = await call(verifyJob, {
      ...adminRejectRequest("COMPLETED"),
      body: { action: "verify", remarks: "Rework verified" },
    });
    assert.equal(result.error, undefined);
    assert.equal(job.status, "VERIFIED");
    result = await call(approveJob, {
      ...adminRejectRequest("VERIFIED"),
      body: { action: "approve", remarks: "Rework approved" },
    });
    assert.equal(result.error, undefined);
    assert.equal(job.status, "APPROVED");
    assert.equal(
      historyEntries.filter((entry) => entry.toStatus === "COMPLETED").length,
      1,
    );
    assert.ok(historyEntries.some((entry) => entry.toStatus === "APPROVED"));
  });
});

test("a different employee cannot accept or start the recovered assignment", async () => {
  await withMocks({}, async ({ job, call }) => {
    await call(verifyJob, adminRejectRequest("COMPLETED"));
    const wrongEmployeeRequest = {
      params: { id: jobId },
      user: { _id: otherEmployeeUserId, userType: "employee" },
      headers: {},
      body: {},
    };

    let result = await call(acceptJob, wrongEmployeeRequest);
    assert.equal(result.error.statusCode, 403);
    assert.equal(job.status, "ASSIGNED");

    job.status = "ACCEPTED";
    result = await call(startJob, wrongEmployeeRequest);
    assert.equal(result.error.statusCode, 403);
    assert.equal(job.status, "ACCEPTED");
  });
});

test("an employee cannot accept a Job that remains REJECTED", async () => {
  await withMocks({ eligible: false }, async ({ job, call }) => {
    await call(verifyJob, adminRejectRequest("COMPLETED"));
    const result = await call(acceptJob, {
      params: { id: jobId },
      user: { _id: employeeUserId, userType: "employee" },
      headers: {},
    });

    assert.equal(result.error.statusCode, 400);
    assert.equal(job.status, "REJECTED");
  });
});
