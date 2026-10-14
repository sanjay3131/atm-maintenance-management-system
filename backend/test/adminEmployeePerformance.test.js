import test from "node:test";
import assert from "node:assert/strict";
import Employee from "../src/modules/employees/employee.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import dashboardRouter from "../src/modules/dashboard/dashboard.routes.js";
import {
  getEmployeePerformance,
  getEmployeePerformanceDetails,
} from "../src/modules/dashboard/dashboard.controller.js";
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

async function withMocks({
  employee = null,
  status = [],
  average = [],
  events = [],
  weeklyActivity = [],
  eligibleJobs = [],
  lifetimeCompletedJobs = [],
}, callback) {
  const originals = [
    [Employee, "findById", Employee.findById],
    [Job, "aggregate", Job.aggregate],
    [JobHistory, "aggregate", JobHistory.aggregate],
  ];
  let employeeFilter;
  const jobPipelines = [];
  let jobAggregateCount = 0;
  const historyPipelines = [];

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
    jobAggregateCount += 1;
    if (jobAggregateCount === 1) return status;
    if (jobAggregateCount === 2) return average;
    if (jobAggregateCount === 3) return eligibleJobs;
    return lifetimeCompletedJobs;
  };
  JobHistory.aggregate = async (pipeline) => {
    historyPipelines.push(pipeline);
    return pipeline[0]?.$match?.action === "gps_validated"
      ? events
      : weeklyActivity;
  };

  try {
    await callback({
      jobPipelines,
      getEmployeeFilter: () => employeeFilter,
      getHistoryPipelines: () => historyPipelines,
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

test("Employee performance summary supports validated filtering by linked User ID", async () => {
  await withMocks({}, async ({ jobPipelines }) => {
    const result = await invoke(getEmployeePerformance, {
      query: { employeeId: employeeUserId, period: "month" },
      user: { _id: "64b000000000000000000029", userType: "admin" },
    });
    assert.equal(result.error, undefined);
    assert.equal(
      String(jobPipelines[0][0].$match.assignedEmployeeId),
      employeeUserId,
    );
  });

  await withMocks({}, async ({ jobPipelines }) => {
    const result = await invoke(getEmployeePerformance, {
      query: { employeeId: "not-an-object-id", period: "month" },
      user: { _id: "64b000000000000000000029", userType: "admin" },
    });
    assert.equal(result.error?.statusCode, 400);
    assert.equal(jobPipelines.length, 0);
  });

  await withMocks({}, async ({ jobPipelines }) => {
    const result = await invoke(getEmployeePerformance, {
      query: { period: "month" },
      user: { _id: "64b000000000000000000029", userType: "admin" },
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(jobPipelines[0][0].$match.assignedEmployeeId, {
      $exists: true,
      $ne: null,
    });
  });
});

test("Admin detail resolves Employee document ID to linked User ID for all metrics", async () => {
  const activityDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const activityDateUTC = new Date(`${activityDate}T00:00:00.000Z`);
  activityDateUTC.setUTCDate(activityDateUTC.getUTCDate() - 6);
  const expectedDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(activityDateUTC);
    date.setUTCDate(date.getUTCDate() + index);
    const dateKey = date.toISOString().slice(0, 10);
    return {
      date: dateKey,
      assigned: 0,
      completed: dateKey === activityDate ? 2 : 0,
    };
  });
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
      eligibleJobs: [{ eligibleAssignedJobCount: 4 }],
      lifetimeCompletedJobs: [{ completedJobCount: 3 }],
      weeklyActivity: [
        {
          _id: { date: activityDate, activity: "completed" },
          count: 2,
        },
      ],
    },
    async ({ jobPipelines, getEmployeeFilter, getHistoryPipelines }) => {
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
      const historyPipelines = getHistoryPipelines();
      assert.equal(historyPipelines.length, 2);
      const completionPipeline = historyPipelines.find(
        (pipeline) => pipeline[0].$match.action === "gps_validated",
      );
      assert.ok(completionPipeline);
      assert.equal(completionPipeline[0].$match.performedBy, employeeUserId);
      assert.notEqual(
        completionPipeline[0].$match.performedBy,
        otherEmployeeUserId,
      );
      assert.deepEqual(completionPipeline.at(-1), { $count: "eventCount" });
      const weeklyActivityPipeline = historyPipelines.find(
        (pipeline) => pipeline[0].$match.$or,
      );
      assert.ok(weeklyActivityPipeline);
      assert.deepEqual(weeklyActivityPipeline.at(-1), {
        $group: {
          _id: { date: "$_id.date", activity: "$_id.activity" },
          count: { $sum: 1 },
        },
      });
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
        eligibleAssignedJobCount: 4,
        completedJobCount: 3,
        lastSevenDays: {
          fromDate: expectedDays[0].date,
          toDate: expectedDays[6].date,
          timezone: "Asia/Kolkata",
          days: expectedDays,
        },
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
    async ({ jobPipelines, getHistoryPipelines }) => {
      const result = await invoke(
        getEmployeePerformanceDetails,
        adminRequest({ period: "month" }),
      );
      assert.equal(result.error, undefined);
      const historyPipelines = getHistoryPipelines();
      const completionPipeline = historyPipelines.find(
        (pipeline) => pipeline[0].$match.action === "gps_validated",
      );
      assert.ok(completionPipeline);
      const weeklyActivityPipeline = historyPipelines.find(
        (pipeline) => pipeline[0].$match.$or,
      );
      assert.ok(weeklyActivityPipeline);
      const range = completionPipeline[0].$match.performedAt;
      assert.equal(
        range.$gte.getUTCHours() === 18 && range.$gte.getUTCMinutes() === 30,
        true,
      );
      assert.deepEqual(completionPipeline[3].$match, {
        "job.isDeleted": false,
        "job.status": { $ne: JOB_STATUS.CANCELLED },
      });
      assert.ok(
        weeklyActivityPipeline.some(
          (stage) =>
            stage.$match?.activityAt?.$gte instanceof Date &&
            stage.$match.activityAt.$gte.getUTCHours() === 18 &&
            stage.$match.activityAt.$gte.getUTCMinutes() === 30,
        ),
      );
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
