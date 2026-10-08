import test from "node:test";
import assert from "node:assert/strict";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import ATM from "../src/modules/atms/atm.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import {
  assignJob,
  reassignJob,
} from "../src/modules/jobs/jobs.controller.js";

const jobId = "64b000000000000000000051";
const atmId = "64b000000000000000000052";
const employeeId = "64b000000000000000000053";
const employeeUserId = "64b000000000000000000054";
const adminUserId = "64b000000000000000000055";

const makeQuery = (value) => ({
  populate() {
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
  {
    status = "PENDING",
    employee = {
      _id: employeeId,
      status: "active",
      userId: {
        _id: employeeUserId,
        status: "active",
        userType: "employee",
      },
    },
    assignedEmployeeIds = [employeeId],
  } = {},
  callback,
) {
  const job = {
    _id: jobId,
    atmId,
    assignedEmployeeId: null,
    assignedBy: null,
    status,
    isDeleted: false,
    reassignmentHistory: [],
    beforePhotos: ["before-photo"],
    afterPhotos: ["after-photo"],
    completedAt: new Date("2025-01-01T02:00:00Z"),
    employeeGpsAtCompletion: { latitude: 1, longitude: 2 },
    gpsValidated: true,
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
  };
  const atm = {
    _id: atmId,
    isDeleted: false,
    assignedEmployeeId: assignedEmployeeIds,
  };
  const historyEntries = [];
  const originals = [
    [Job, "findById", Job.findById],
    [JobHistory, "create", JobHistory.create],
    [ATM, "findById", ATM.findById],
    [Employee, "findOne", Employee.findOne],
  ];

  JobHistory.create = async (entry) => {
    historyEntries.push(entry);
    return entry;
  };
  ATM.findById = async (id) => (id === atmId ? atm : null);
  Employee.findOne = (filter) => ({
    populate: async () => (filter.userId === employeeUserId ? employee : null),
  });

  const call = async (handler, requestStatus = status) => {
    let lookupCount = 0;
    Job.findById = () => {
      lookupCount += 1;
      return lookupCount % 2 === 1 ? job : makeQuery(job);
    };
    return invoke(handler, {
      params: { id: jobId },
      body: {
        employeeId: employeeUserId,
        reason: "Operational reassignment",
      },
      user: { _id: adminUserId, userType: "admin" },
      headers: {},
      status: requestStatus,
    });
  };

  try {
    await callback({ job, historyEntries, call });
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

test("initial assignment succeeds for an active employee assigned to the Job ATM", async () => {
  await withMocks({}, async ({ job, historyEntries, call }) => {
    const result = await call(assignJob);

    assert.equal(result.error, undefined);
    assert.equal(job.assignedEmployeeId, employeeUserId);
    assert.equal(job.status, "ASSIGNED");
    assert.equal(job.assignedBy, adminUserId);
    assert.ok(job.assignedAt instanceof Date);
    assert.equal(job.saveCalls, 1);
    assert.equal(historyEntries.length, 1);
    assert.equal(historyEntries[0].action, "assigned");
    assert.equal(historyEntries[0].details.assignedTo, employeeUserId);
  });
});

test("initial assignment rejects an active employee not assigned to the Job ATM", async () => {
  await withMocks(
    { assignedEmployeeIds: [] },
    async ({ job, historyEntries, call }) => {
      const result = await call(assignJob);

      assert.equal(result.error?.statusCode, 400);
      assert.match(result.error.message, /assigned to the Job's ATM/);
      assert.equal(job.saveCalls, 0);
      assert.equal(historyEntries.length, 0);
    },
  );
});

test("initial assignment rejects an employee assigned only to a different ATM", async () => {
  await withMocks(
    { assignedEmployeeIds: ["64b000000000000000000056"] },
    async ({ job, call }) => {
      const result = await call(assignJob);

      assert.equal(result.error?.statusCode, 400);
      assert.match(result.error.message, /assigned to the Job's ATM/);
      assert.equal(job.saveCalls, 0);
    },
  );
});

test("initial assignment rejects inactive Employee and invalid linked User records", async (t) => {
  const invalidEmployees = [
    {
      name: "inactive Employee",
      employee: {
        _id: employeeId,
        status: "inactive",
        userId: {
          _id: employeeUserId,
          status: "active",
          userType: "employee",
        },
      },
    },
    {
      name: "inactive linked User",
      employee: {
        _id: employeeId,
        status: "active",
        userId: {
          _id: employeeUserId,
          status: "inactive",
          userType: "employee",
        },
      },
    },
    {
      name: "missing linked User",
      employee: { _id: employeeId, status: "active", userId: null },
    },
    {
      name: "non-employee linked User",
      employee: {
        _id: employeeId,
        status: "active",
        userId: {
          _id: employeeUserId,
          status: "active",
          userType: "admin",
        },
      },
    },
  ];

  for (const { name, employee } of invalidEmployees) {
    await t.test(name, async () => {
      await withMocks({ employee }, async ({ job, historyEntries, call }) => {
        const result = await call(assignJob);

        assert.equal(result.error?.statusCode, 400);
        assert.equal(job.saveCalls, 0);
        assert.equal(historyEntries.length, 0);
      });
    });
  }
});

test("initial assignment rejects when the linked User has no Employee document", async () => {
  await withMocks({ employee: null }, async ({ job, historyEntries, call }) => {
    const result = await call(assignJob);

    assert.equal(result.error?.statusCode, 404);
    assert.equal(job.saveCalls, 0);
    assert.equal(historyEntries.length, 0);
  });
});

test("reassignment succeeds for an active employee assigned to the Job ATM and records history", async () => {
  await withMocks(
    { status: "IN_PROGRESS" },
    async ({ job, historyEntries, call }) => {
      job.assignedEmployeeId = "64b000000000000000000057";
      const result = await call(reassignJob, "IN_PROGRESS");

      assert.equal(result.error, undefined);
      assert.equal(job.assignedEmployeeId, employeeUserId);
      assert.equal(job.status, "ASSIGNED");
      assert.equal(job.saveCalls, 1);
      assert.equal(job.reassignmentHistory.length, 1);
      assert.equal(historyEntries.length, 1);
      assert.equal(historyEntries[0].action, "reassigned");
      assert.equal(
        historyEntries[0].details.fromEmployee,
        "64b000000000000000000057",
      );
      assert.equal(historyEntries[0].details.toEmployee, employeeUserId);
      assert.deepEqual(job.beforePhotos, ["before-photo"]);
      assert.deepEqual(job.afterPhotos, ["after-photo"]);
      assert.ok(job.completedAt instanceof Date);
      assert.deepEqual(job.employeeGpsAtCompletion, {
        latitude: 1,
        longitude: 2,
      });
      assert.equal(job.gpsValidated, true);
    },
  );
});

test("rejected Job can be explicitly reassigned to another eligible ATM employee", async () => {
  await withMocks(
    { status: "REJECTED", assignedEmployeeIds: [employeeId] },
    async ({ job, call, historyEntries }) => {
      const originalATM = job.atmId;
      job.assignedEmployeeId = "64b000000000000000000057";

      const result = await call(reassignJob, "REJECTED");

      assert.equal(result.error, undefined);
      assert.equal(job.assignedEmployeeId, employeeUserId);
      assert.equal(job.atmId, originalATM);
      assert.equal(job.status, "ASSIGNED");
      assert.equal(historyEntries[0].action, "reassigned");
    },
  );
});

test("reassignment rejects a closed Job", async () => {
  await withMocks(
    { status: "CLOSED" },
    async ({ job, call, historyEntries }) => {
      job.assignedEmployeeId = "64b000000000000000000057";
      const result = await call(reassignJob, "CLOSED");
      assert.equal(result.error?.statusCode, 400);
      assert.equal(job.assignedEmployeeId, "64b000000000000000000057");
      assert.equal(job.saveCalls, 0);
      assert.equal(historyEntries.length, 0);
    },
  );
});

test("reassignment is rejected after the Job enters review or approval", async (t) => {
  for (const status of ["COMPLETED", "VERIFIED", "APPROVED"]) {
    await t.test(status, async () => {
      await withMocks({ status }, async ({ job, call, historyEntries }) => {
        const originalAssignee = "64b000000000000000000057";
        job.assignedEmployeeId = originalAssignee;
        const result = await call(reassignJob, status);
        assert.equal(result.error?.statusCode, 400);
        assert.equal(job.assignedEmployeeId, originalAssignee);
        assert.equal(job.saveCalls, 0);
        assert.equal(historyEntries.length, 0);
      });
    });
  }
});

test("reassignment rejects an active employee unrelated to the Job ATM", async () => {
  await withMocks(
    { status: "IN_PROGRESS", assignedEmployeeIds: [] },
    async ({ job, historyEntries, call }) => {
      job.assignedEmployeeId = "64b000000000000000000057";
      const result = await call(reassignJob, "IN_PROGRESS");

      assert.equal(result.error?.statusCode, 400);
      assert.match(result.error.message, /assigned to the Job's ATM/);
      assert.equal(job.saveCalls, 0);
      assert.equal(job.assignedEmployeeId, "64b000000000000000000057");
      assert.equal(job.reassignmentHistory.length, 0);
      assert.equal(historyEntries.length, 0);
    },
  );
});
