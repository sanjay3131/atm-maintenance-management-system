import test from "node:test";
import assert from "node:assert/strict";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import {
  getEmployeePerformance,
} from "../src/modules/dashboard/dashboard.controller.js";
import jobsRouter from "../src/modules/jobs/jobs.routes.js";
import { getMyJobPerformance } from "../src/modules/jobs/jobs.controller.js";
import { myJobPerformanceQuerySchema } from "../src/modules/jobs/jobs.validation.js";
import { JOB_STATUS } from "../src/utils/jobStatus.js";

const employeeUserId = "64b000000000000000000001";
const employeeDocumentId = "64b000000000000000000002";
const otherEmployeeUserId = "64b000000000000000000003";

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

async function withAggregates({ status = [], average = [], events = [] }, callback) {
  const originalJobAggregate = Job.aggregate;
  const originalHistoryAggregate = JobHistory.aggregate;
  const jobPipelines = [];
  let historyPipeline;
  Job.aggregate = async (pipeline) => {
    jobPipelines.push(pipeline);
    return jobPipelines.length === 1 ? status : average;
  };
  JobHistory.aggregate = async (pipeline) => {
    historyPipeline = pipeline;
    return events;
  };

  try {
    await callback({ jobPipelines, getHistoryPipeline: () => historyPipeline });
  } finally {
    Job.aggregate = originalJobAggregate;
    JobHistory.aggregate = originalHistoryAggregate;
  }
}

const employeeRequest = (query = {}) => ({
  query,
  user: { _id: employeeUserId, userType: "employee" },
});

test("employee receives only their own performance summary using User ID", async () => {
  await withAggregates(
    {
      status: [
        { _id: JOB_STATUS.ASSIGNED, count: 2 },
        { _id: JOB_STATUS.CANCELLED, count: 1 },
      ],
      average: [{ averageCompletionTimeMs: 7_200_000, jobCount: 1 }],
      events: [{ eventCount: 4 }],
    },
    async ({ jobPipelines, getHistoryPipeline }) => {
      const result = await invoke(getMyJobPerformance, employeeRequest());

      assert.equal(result.error, undefined);
      assert.deepEqual(result.body.data, {
        currentAssignedJobs: {
          total: 3,
          byStatus: {
            PENDING: 0,
            ASSIGNED: 2,
            ACCEPTED: 0,
            IN_PROGRESS: 0,
            ON_HOLD: 0,
            COMPLETED: 0,
            VERIFIED: 0,
            APPROVED: 0,
            CLOSED: 0,
            REJECTED: 0,
            CANCELLED: 1,
          },
        },
        completion: {
          completedEventCount: 4,
          range: {
            fromDate: result.body.data.completion.range.fromDate,
            toDate: result.body.data.completion.range.toDate,
            timezone: "Asia/Kolkata",
          },
        },
        averageCurrentAttemptCompletionHours: 2,
        averageCurrentAttemptJobCount: 1,
      });

      assert.equal(
        jobPipelines[0][0].$match.assignedEmployeeId,
        employeeUserId,
      );
      assert.notEqual(
        jobPipelines[0][0].$match.assignedEmployeeId,
        employeeDocumentId,
      );
      assert.equal(
        jobPipelines[1][0].$match.assignedEmployeeId,
        employeeUserId,
      );
      const historyMatch = getHistoryPipeline()[0].$match;
      assert.equal(historyMatch.performedBy, employeeUserId);
      assert.notEqual(historyMatch.performedBy, employeeDocumentId);
    },
  );
});

test("self-service endpoint rejects non-employee roles without querying jobs", async () => {
  await withAggregates({}, async ({ jobPipelines }) => {
    const result = await invoke(getMyJobPerformance, {
      query: {},
      user: { _id: employeeUserId, userType: "admin" },
    });

    assert.equal(result.error?.statusCode, 403);
    assert.equal(jobPipelines.length, 0);
  });
});

test("endpoint rejects another employee ID and invalid periods or date ranges", async () => {
  const invalidQueries = [
    { employeeId: otherEmployeeUserId },
    { period: "all" },
    { fromDate: "2026-02-30", toDate: "2026-03-01" },
    { fromDate: "2026-02-01" },
    { fromDate: "2026-03-02", toDate: "2026-03-01" },
    { period: "week", fromDate: "2026-03-01", toDate: "2026-03-02" },
  ];

  for (const query of invalidQueries) {
    const parsed = myJobPerformanceQuerySchema.safeParse(query);
    assert.equal(parsed.success, false, JSON.stringify(query));
  }

  await withAggregates({}, async ({ jobPipelines }) => {
    const result = await invoke(
      getMyJobPerformance,
      employeeRequest({ employeeId: otherEmployeeUserId }),
    );
    assert.equal(result.error?.statusCode, 400);
    assert.equal(jobPipelines.length, 0);
  });
});

test("completion-event date range uses inclusive Asia/Kolkata business dates", async () => {
  await withAggregates({}, async ({ getHistoryPipeline }) => {
    const result = await invoke(
      getMyJobPerformance,
      employeeRequest({ fromDate: "2026-01-03", toDate: "2026-01-04" }),
    );

    assert.equal(result.error, undefined);
    assert.deepEqual(result.body.data.completion.range, {
      fromDate: "2026-01-03",
      toDate: "2026-01-04",
      timezone: "Asia/Kolkata",
    });
    assert.deepEqual(getHistoryPipeline()[0].$match.performedAt, {
      $type: "date",
      $gte: new Date("2026-01-02T18:30:00.000Z"),
      $lt: new Date("2026-01-04T18:30:00.000Z"),
    });
  });
});

test("cancelled Jobs are excluded from completed events and invalid timestamps from the average", async () => {
  await withAggregates({}, async ({ jobPipelines, getHistoryPipeline }) => {
    const result = await invoke(getMyJobPerformance, employeeRequest());

    assert.equal(result.error, undefined);
    assert.equal(result.body.data.completion.completedEventCount, 0);
    assert.equal(result.body.data.averageCurrentAttemptCompletionHours, null);
    assert.equal(result.body.data.averageCurrentAttemptJobCount, 0);

    const averageMatch = jobPipelines[1][0].$match;
    assert.deepEqual(averageMatch.status.$in, [
      JOB_STATUS.COMPLETED,
      JOB_STATUS.VERIFIED,
      JOB_STATUS.APPROVED,
      JOB_STATUS.CLOSED,
    ]);
    assert.deepEqual(averageMatch.startedAt, { $type: "date" });
    assert.deepEqual(averageMatch.completedAt, { $type: "date" });
    assert.deepEqual(jobPipelines[1][1].$match.$expr, {
      $gte: ["$completedAt", "$startedAt"],
    });
    assert.deepEqual(getHistoryPipeline()[3].$match, {
      "job.isDeleted": false,
      "job.status": { $ne: JOB_STATUS.CANCELLED },
    });
  });
});

test("completion events remain attributed to the performing employee across reassignment and rework", async () => {
  await withAggregates({ events: [{ eventCount: 2 }] }, async ({ getHistoryPipeline }) => {
    const result = await invoke(
      getMyJobPerformance,
      employeeRequest({
        fromDate: "2026-05-01",
        toDate: "2026-05-31",
      }),
    );
    const historyPipeline = getHistoryPipeline();

    assert.equal(result.error, undefined);
    assert.equal(result.body.data.completion.completedEventCount, 2);
    assert.equal(historyPipeline[0].$match.performedBy, employeeUserId);
    assert.equal(
      Object.hasOwn(historyPipeline[0].$match, "assignedEmployeeId"),
      false,
    );
    assert.equal(
      Object.hasOwn(historyPipeline[0].$match, "reassignmentHistory"),
      false,
    );
  });
});

test("employee performance route is authenticated and employee-role-only", () => {
  const routeLayer = jobsRouter.stack.find(
    (layer) => layer.route?.path === "/my-performance",
  );
  assert.ok(routeLayer);
  assert.equal(routeLayer.route.methods.get, true);
  assert.equal(routeLayer.route.stack.length, 3);

  const authorizeEmployee = routeLayer.route.stack[1].handle;
  let passed = false;
  authorizeEmployee(
    { user: { userType: "employee" } },
    {},
    () => {
      passed = true;
    },
  );
  assert.equal(passed, true);
  assert.throws(
    () => authorizeEmployee({ user: { userType: "admin" } }, {}, () => {}),
    { statusCode: 403 },
  );
});

test("existing admin employee-performance endpoint remains global and unchanged", async () => {
  const originalAggregate = Job.aggregate;
  let pipeline;
  Job.aggregate = async (value) => {
    pipeline = value;
    return [{ employeeId: employeeUserId, totalJobs: 3, completedJobs: 1 }];
  };

  try {
    const result = await invoke(getEmployeePerformance, {
      query: { period: "month" },
      user: { _id: "64b000000000000000000009", userType: "admin" },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.body.data.performance[0].employeeId, employeeUserId);
    assert.ok(pipeline[0].$match.createdAt.$gte instanceof Date);
    assert.equal(pipeline[0].$match.assignedEmployeeId.$exists, true);
  } finally {
    Job.aggregate = originalAggregate;
  }
});
