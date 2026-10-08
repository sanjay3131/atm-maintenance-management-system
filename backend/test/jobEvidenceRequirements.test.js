import test from "node:test";
import assert from "node:assert/strict";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import ATM from "../src/modules/atms/atm.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import { completeJob, verifyJob } from "../src/modules/jobs/jobs.controller.js";

const jobId = "64b000000000000000000001";
const atmId = "64b000000000000000000002";
const employeeUserId = "64b000000000000000000003";

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

const makeQuery = (job) => ({
  populate() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(job).then(resolve, reject);
  },
});

async function withJobMocks(
  { beforeCount, afterCount, status = "IN_PROGRESS" },
  callback,
) {
  const job = {
    _id: jobId,
    atmId,
    assignedEmployeeId: employeeUserId,
    status,
    beforePhotos: Array.from(
      { length: beforeCount },
      (_, index) => `before-${index}`,
    ),
    afterPhotos: Array.from(
      { length: afterCount },
      (_, index) => `after-${index}`,
    ),
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
  };
  const atm = {
    locationConfigured: true,
    location: { coordinates: [0, 0] },
  };
  const historyEntries = [];
  const countQueries = [];
  const originals = [
    [Job, "findById", Job.findById],
    [JobHistory, "create", JobHistory.create],
    [JobPhoto, "countDocuments", JobPhoto.countDocuments],
    [ATM, "findById", ATM.findById],
    [Employee, "findOne", Employee.findOne],
  ];

  let findByIdCalls = 0;
  Job.findById = () => {
    findByIdCalls += 1;
    return findByIdCalls === 1 ? Promise.resolve(job) : makeQuery(job);
  };
  JobHistory.create = async (entry) => {
    historyEntries.push(entry);
    return entry;
  };
  JobPhoto.countDocuments = async (filter) => {
    countQueries.push(filter);
    return filter.photoType === "before" ? beforeCount : afterCount;
  };
  ATM.findById = async () => atm;
  Employee.findOne = () => ({
    populate: async () => ({
      status: "active",
      userId: { status: "active", userType: "employee" },
    }),
  });

  try {
    await callback({ job, historyEntries, countQueries });
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

const completionRequest = () => ({
  params: { id: jobId },
  body: { gps: { latitude: 0, longitude: 0, accuracy: 5 } },
  user: { _id: employeeUserId, userType: "employee" },
  headers: {},
});

test("requires three valid before and after photo records to complete a Job", async (t) => {
  const incompleteEvidence = [
    { beforeCount: 0, afterCount: 0 },
    { beforeCount: 3, afterCount: 0 },
    { beforeCount: 0, afterCount: 3 },
    { beforeCount: 2, afterCount: 3 },
    { beforeCount: 3, afterCount: 2 },
  ];

  for (const counts of incompleteEvidence) {
    await t.test(
      `${counts.beforeCount} before and ${counts.afterCount} after`,
      async () => {
        await withJobMocks(
          counts,
          async ({ job, historyEntries, countQueries }) => {
            const result = await invoke(completeJob, completionRequest());

            assert.equal(result.error.statusCode, 400);
            if (counts.beforeCount < 3) {
              assert.match(
                result.error.message,
                /At least 3 before photos are required/,
              );
            }
            if (counts.afterCount < 3) {
              assert.match(
                result.error.message,
                /At least 3 after photos are required/,
              );
            }
            assert.equal(job.status, "IN_PROGRESS");
            assert.equal(job.saveCalls, 0);
            assert.equal(job.completedAt, undefined);
            assert.equal(job.employeeGpsAtCompletion, undefined);
            assert.equal(job.gpsDistance, undefined);
            assert.equal(job.gpsValidated, undefined);
            assert.equal(historyEntries.length, 0);
            assert.deepEqual(
              countQueries.map(
                ({ _id, jobId: queryJobId, photoType, isExpired, url }) => ({
                  referenceIds: _id.$in,
                  jobId: queryJobId,
                  photoType,
                  isExpired,
                  url,
                }),
              ),
              [
                {
                  referenceIds: job.beforePhotos,
                  jobId,
                  photoType: "before",
                  isExpired: false,
                  url: { $type: "string", $ne: "" },
                },
                {
                  referenceIds: job.afterPhotos,
                  jobId,
                  photoType: "after",
                  isExpired: false,
                  url: { $type: "string", $ne: "" },
                },
              ],
            );
          },
        );
      },
    );
  }
});

test("completes a Job when it has at least three valid photos of each type", async () => {
  await withJobMocks(
    { beforeCount: 3, afterCount: 3 },
    async ({ job, historyEntries }) => {
      const result = await invoke(completeJob, completionRequest());

      assert.equal(result.error, undefined);
      assert.equal(result.statusCode, 200);
      assert.equal(job.status, "COMPLETED");
      assert.ok(job.completedAt instanceof Date);
      assert.equal(job.employeeGpsAtCompletion.latitude, 0);
      assert.equal(job.employeeGpsAtCompletion.longitude, 0);
      assert.equal(job.employeeGpsAtCompletion.accuracy, 5);
      assert.ok(job.employeeGpsAtCompletion.timestamp instanceof Date);
      assert.equal(job.gpsValidated, true);
      assert.equal(historyEntries.length, 1);
    },
  );
});

test("rejection returns eligible work for rework without checking old evidence", async () => {
  await withJobMocks(
    { beforeCount: 0, afterCount: 0, status: "COMPLETED" },
    async ({ job, historyEntries, countQueries }) => {
      const result = await invoke(verifyJob, {
        params: { id: jobId },
        body: { action: "reject", remarks: "Evidence is incomplete" },
        user: { _id: "admin-id", userType: "admin" },
        headers: {},
      });

      assert.equal(result.error, undefined);
      assert.equal(result.statusCode, 200);
      assert.equal(job.status, "ASSIGNED");
      assert.equal(job.rejectionReason, "Evidence is incomplete");
      assert.equal(countQueries.length, 0);
      assert.equal(historyEntries.length, 2);
      assert.equal(historyEntries[0].action, "rejected");
      assert.equal(historyEntries[1].toStatus, "ASSIGNED");
    },
  );
});

test("verification rejects incomplete evidence without changing Job state", async () => {
  await withJobMocks(
    { beforeCount: 3, afterCount: 2, status: "COMPLETED" },
    async ({ job, historyEntries }) => {
      const result = await invoke(verifyJob, {
        params: { id: jobId },
        body: { action: "verify" },
        user: { _id: "admin-id", userType: "admin" },
        headers: {},
      });

      assert.equal(result.error.statusCode, 400);
      assert.match(result.error.message, /At least 3 after photos are required/);
      assert.equal(job.status, "COMPLETED");
      assert.equal(job.verifiedAt, undefined);
      assert.equal(job.saveCalls, 0);
      assert.equal(historyEntries.length, 0);
    },
  );
});

test("verification succeeds when evidence is complete", async () => {
  await withJobMocks(
    { beforeCount: 3, afterCount: 3, status: "COMPLETED" },
    async ({ job, historyEntries }) => {
      const result = await invoke(verifyJob, {
        params: { id: jobId },
        body: { action: "verify" },
        user: { _id: "admin-id", userType: "admin" },
        headers: {},
      });

      assert.equal(result.error, undefined);
      assert.equal(result.statusCode, 200);
      assert.equal(job.status, "VERIFIED");
      assert.ok(job.verifiedAt instanceof Date);
      assert.equal(job.saveCalls, 1);
      assert.equal(historyEntries.length, 1);
    },
  );
});
