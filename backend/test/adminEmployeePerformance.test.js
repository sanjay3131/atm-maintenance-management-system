import test from "node:test";
import assert from "node:assert/strict";
import Employee from "../src/modules/employees/employee.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import dashboardRouter from "../src/modules/dashboard/dashboard.routes.js";
import { getEmployeePerformanceDetails } from "../src/modules/dashboard/dashboard.controller.js";
import { JOB_STATUS } from "../src/utils/jobStatus.js";

const employeeDocumentId = "64b000000000000000000021";
const employeeUserId = "64b000000000000000000022";
const otherEmployeeUserId = "64b000000000000000000023";

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

async function withMocks({ employee = null, status = [], average = [], events = [] }, callback) {
  const originals = [
    [Employee, "findById", Employee.findById],
    [Job, "aggregate", Job.aggregate],
    [JobHistory, "aggregate", JobHistory.aggregate],
  ];
  let employeeFilter;
  const jobPipelines = [];
  let historyPipeline;

  Employee.findById = (id) => {
    employeeFilter = id;
    return {
      select() {
        return this;
      },
      populate: async () => employee,
    };
  };
  Job.aggregate = async (pipeline) => {
    jobPipelines.push(pipeline);
    return jobPipelines.length === 1 ? status : average;
  };
  JobHistory.aggregate = async (pipeline) => {
    historyPipeline = pipeline;
    return events;
  };

  try {
    await callback({
      jobPipelines,
      getEmployeeFilter: () => employeeFilter,
      getHistoryPipeline: () => historyPipeline,
    });
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

const adminRequest = ({
  id = employeeDocumentId,
  period = "month",
  userType = "admin",
} = {}) => ({
  params: { employeeId: id },
  query: { period },
  user: { _id: "64b000000000000000000029", userType },
});

test("Admin detail resolves Employee document ID to linked User ID for all metrics", async () => {
  await withMocks(
    {
      employee: {
        _id: employeeDocumentId,
        userId: {
          _id: employeeUserId,
          firstName: "Asha",
          lastName: "Rao",
          password: "not returned",
        },
        employeeCode: "EMP-021",
        salary: 999999,
      },
      status: [{ _id: JOB_STATUS.IN_PROGRESS, count: 3 }],
      average: [{ averageCompletionTimeMs: 3_600_000, jobCount: 1 }],
      events: [{ eventCount: 2 }],
    },
    async ({ jobPipelines, getEmployeeFilter, getHistoryPipeline }) => {
      const result = await invoke(
        getEmployeePerformanceDetails,
        adminRequest({ period: "week" }),
      );

      assert.equal(result.error, undefined);
      assert.equal(getEmployeeFilter(), employeeDocumentId);
      assert.equal(jobPipelines[0][0].$match.assignedEmployeeId, employeeUserId);
      assert.notEqual(
        jobPipelines[0][0].$match.assignedEmployeeId,
        employeeDocumentId,
      );
      assert.equal(jobPipelines[1][0].$match.assignedEmployeeId, employeeUserId);
      assert.equal(
        getHistoryPipeline()[0].$match.performedBy,
        employeeUserId,
      );
      assert.equal(getHistoryPipeline()[0].$match.action, "gps_validated");
      assert.notEqual(
        getHistoryPipeline()[0].$match.performedBy,
        otherEmployeeUserId,
      );
      assert.deepEqual(getHistoryPipeline().at(-1), { $count: "eventCount" });
      assert.deepEqual(result.body.data, {
        employee: { name: "Asha Rao", employeeCode: "EMP-021" },
        currentAssignedJobs: {
          total: 3,
          byStatus: Object.fromEntries(
            Object.values(JOB_STATUS).map((status) => [
              status,
              status === JOB_STATUS.IN_PROGRESS ? 3 : 0,
            ]),
          ),
        },
        completion: {
          completedEventCount: 2,
          range: {
            fromDate: result.body.data.completion.range.fromDate,
            toDate: result.body.data.completion.range.toDate,
            timezone: "Asia/Kolkata",
          },
        },
        averageCurrentAttemptCompletionHours: 1,
        averageCurrentAttemptJobCount: 1,
      });
      assert.equal("salary" in result.body.data, false);
      assert.equal("password" in result.body.data.employee, false);
      assert.equal("userId" in result.body.data.employee, false);
    },
  );
});

test("Admin detail validates Employee document IDs and periods before querying", async () => {
  await withMocks({}, async ({ jobPipelines, getEmployeeFilter }) => {
    const invalidId = await invoke(
      getEmployeePerformanceDetails,
      adminRequest({ id: "user-id-not-employee-id" }),
    );
    assert.equal(invalidId.error?.statusCode, 400);
    assert.equal(getEmployeeFilter(), undefined);

    const invalidPeriod = await invoke(
      getEmployeePerformanceDetails,
      {
        ...adminRequest({ period: "all-time" }),
        query: { period: "all-time" },
      },
    );
    assert.equal(invalidPeriod.error?.statusCode, 400);
    assert.equal(jobPipelines.length, 0);
  });
});

test("Admin detail returns not found when Employee has no linked User", async () => {
  await withMocks(
    { employee: { _id: employeeDocumentId, userId: null } },
    async ({ jobPipelines }) => {
      const result = await invoke(
        getEmployeePerformanceDetails,
        adminRequest(),
      );
      assert.equal(result.error?.statusCode, 404);
      assert.equal(jobPipelines.length, 0);
    },
  );
});

test("Admin detail rejects non-admin roles", async () => {
  await withMocks({}, async ({ jobPipelines, getEmployeeFilter }) => {
    const result = await invoke(
      getEmployeePerformanceDetails,
      adminRequest({ userType: "employee" }),
    );
    assert.equal(result.error?.statusCode, 403);
    assert.equal(getEmployeeFilter(), undefined);
    assert.equal(jobPipelines.length, 0);
  });
});

test("Admin detail route requires authentication and admin roles", () => {
  const route = dashboardRouter.stack.find(
    (layer) =>
      layer.route?.path === "/employee-performance/:employeeId/details",
  )?.route;
  assert.ok(route);
  assert.equal(route.methods.get, true);
  assert.equal(route.stack.length, 3);

  const authorize = route.stack[1].handle;
  for (const userType of ["admin", "superAdmin"]) {
    let passed = false;
    authorize({ user: { userType } }, {}, () => {
      passed = true;
    });
    assert.equal(passed, true);
  }
  assert.throws(
    () => authorize({ user: { userType: "employee" } }, {}, () => {}),
    { statusCode: 403 },
  );
});

test("Admin detail retains Asia/Kolkata boundaries and current-state cancellation rules", async () => {
  await withMocks(
    { employee: { _id: employeeDocumentId, userId: { _id: employeeUserId } } },
    async ({ jobPipelines, getHistoryPipeline }) => {
      const result = await invoke(
        getEmployeePerformanceDetails,
        adminRequest({ period: "month" }),
      );
      assert.equal(result.error, undefined);
      const range = getHistoryPipeline()[0].$match.performedAt;
      assert.equal(
        range.$gte.getUTCHours() === 18 && range.$gte.getUTCMinutes() === 30,
        true,
      );
      assert.deepEqual(getHistoryPipeline()[3].$match, {
        "job.isDeleted": false,
        "job.status": { $ne: JOB_STATUS.CANCELLED },
      });
      assert.deepEqual(jobPipelines[1][1].$match.$expr, {
        $gte: ["$completedAt", "$startedAt"],
      });
      assert.equal(
        result.body.data.averageCurrentAttemptCompletionHours,
        null,
      );
      assert.equal(result.body.data.averageCurrentAttemptJobCount, 0);
    },
  );
});
