import assert from "node:assert/strict";
import test from "node:test";
import CleaningRecord from "../src/modules/cleaningRecords/cleaningRecord.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import RecurringMaintenancePlan from "../src/modules/jobs/recurringMaintenancePlan.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import User from "../src/modules/users/user.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import {
  getRecurringCleaningPlanHistory,
} from "../src/modules/cleaningRecords/cleaningHistory.service.js";
import jobsRouter from "../src/modules/jobs/jobs.routes.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";
import { authorizeRoles } from "../src/middlewares/role.middleware.js";

const PLAN_ID = "64b000000000000000000101";
const ATM_ID = "64b000000000000000000102";
const EMPLOYEE_ID = "64b000000000000000000103";
const JOB_ID = "64b000000000000000000104";
const USER_ID = "64b000000000000000000105";
const NOW = new Date("2026-11-26T06:00:00.000Z");

const makePlan = (updates = {}) => ({
  _id: PLAN_ID,
  isActive: true,
  atmId: {
    _id: ATM_ID,
    atmId: "ATM-001",
    clientAtmId: "CLIENT-001",
    locationName: "Central",
    bankId: {
      _id: "64b000000000000000000106",
      bankName: "Example Bank",
      bankCode: "EX",
    },
    regionId: {
      _id: "64b000000000000000000107",
      name: "North",
    },
    districtId: {
      _id: "64b000000000000000000108",
      districtName: "Central District",
    },
  },
  geographySnapshot: {},
  assignedEmployeeId: {
    _id: EMPLOYEE_ID,
    employeeCode: "EMP-001",
    userId: { firstName: "Asha", lastName: "Kumar" },
  },
  maintenanceType: "DAILY_CLEANING",
  monitoringActivatedAt: new Date("2026-11-20T00:00:00.000Z"),
  ...updates,
});

const makeJobEntry = (record = null, updates = {}) => ({
  historyDate: "2026-11-25",
  activityAt: new Date("2026-11-25T05:00:00.000Z"),
  stableId: JOB_ID,
  job: {
    _id: JOB_ID,
    status: "COMPLETED",
    scheduledDate: new Date("2026-11-24T18:30:00.000Z"),
    beforePhotoIds: [],
    afterPhotoIds: [],
  },
  record,
  historyTruncated: {
    submissionHistory: false,
    correctionHistory: false,
  },
  ...updates,
});

const chain = (result) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  lean: async () => result,
});

async function withMocks(
  {
    plan = makePlan(),
    historyResult = [{ entries: [], count: [] }],
    monitoringRecords = [],
    inactiveLatest = [],
  },
  callback,
) {
  const originals = [
    [RecurringMaintenancePlan, "findById", RecurringMaintenancePlan.findById],
    [RecurringMaintenancePlan, "find", RecurringMaintenancePlan.find],
    [Job, "aggregate", Job.aggregate],
    [CleaningRecord, "aggregate", CleaningRecord.aggregate],
    [Employee, "find", Employee.find],
    [User, "find", User.find],
    [JobPhoto, "find", JobPhoto.find],
  ];
  let historyPipeline;
  let monitoringQueryCount = 0;
  let inactiveQueryCount = 0;

  RecurringMaintenancePlan.findById = (id) => {
    assert.equal(String(id), PLAN_ID);
    return chain(plan);
  };
  RecurringMaintenancePlan.find = (filter) => {
    assert.deepEqual(filter, {
      isActive: true,
      maintenanceType: { $in: ["DAILY_CLEANING", "WEEKLY_MOPPING"] },
    });
    monitoringQueryCount += 1;
    return chain([plan]);
  };
  Job.aggregate = async (pipeline) => {
    historyPipeline = pipeline;
    return historyResult;
  };
  CleaningRecord.aggregate = async (pipeline) => {
    if (plan.isActive) {
      const match = pipeline[0]?.$match ?? {};
      assert.deepEqual(match.recurringPlanId.$in.map(String), [PLAN_ID]);
      assert.equal(match.validityStatus, "VALID");
      monitoringQueryCount += 1;
      return monitoringRecords;
    }
    inactiveQueryCount += 1;
    return inactiveLatest;
  };
  Employee.find = () => chain([]);
  User.find = () => chain([]);
  JobPhoto.find = () => chain([]);

  try {
    await callback({
      getHistoryPipeline: () => historyPipeline,
      getMonitoringQueryCount: () => monitoringQueryCount,
      getInactiveQueryCount: () => inactiveQueryCount,
    });
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
}

test("history endpoint is protected for admin and superAdmin only", () => {
  const route = jobsRouter.stack.find(
    (layer) =>
      layer.route?.path === "/recurring/plans/:planId/cleaning-history" &&
      layer.route.methods.get,
  )?.route;

  assert.ok(route);
  assert.equal(route.stack[0].handle, verifyAccessToken);

  const roleGate = route.stack[1].handle;
  for (const role of ["admin", "superAdmin"]) {
    let authorized = false;
    roleGate({ user: { userType: role } }, {}, () => {
      authorized = true;
    });
    assert.equal(authorized, true);
  }
  assert.throws(
    () => roleGate({ user: { userType: "employee" } }, {}, () => {}),
    { statusCode: 403 },
  );
  assert.throws(() => roleGate({}, {}, () => {}), { statusCode: 401 });
});

test("history query validates plan ID, date filters, and bounded pagination", async () => {
  const route = jobsRouter.stack.find(
    (layer) =>
      layer.route?.path === "/recurring/plans/:planId/cleaning-history",
  ).route;
  const validateParams = route.stack[2].handle;
  const validateQuery = route.stack[3].handle;
  const runValidation = (middleware, request) =>
    new Promise((resolve) => {
      middleware(request, {}, (error) => resolve(error ?? null));
    });

  const invalidParams = await runValidation(validateParams, {
    params: { planId: "not-an-id" },
  });
  assert.equal(invalidParams.statusCode, 400);

  const invalidDate = await runValidation(validateQuery, {
    query: { fromDate: "2026-02-30" },
  });
  assert.equal(invalidDate.statusCode, 400);

  const reversedRange = await runValidation(validateQuery, {
    query: { fromDate: "2026-11-27", toDate: "2026-11-26" },
  });
  assert.equal(reversedRange.statusCode, 400);

  const tooDeep = await runValidation(validateQuery, {
    query: { page: "102", limit: "100" },
  });
  assert.equal(tooDeep.statusCode, 400);
});

test("valid plan history combines scheduled and actual dates with overview data", async () => {
  const record = {
    _id: "64b000000000000000000109",
    actualCleanerType: "OUTSOURCED",
    outsourcedCleanerName: "Ravi",
    cleaningDate: "2026-11-25",
    responsibleEmployeeId: EMPLOYEE_ID,
    submittedBy: USER_ID,
    reportingMethod: "EMPLOYEE",
    submittedAt: new Date("2026-11-25T05:00:00.000Z"),
    remarks: "Cleaned",
    evidencePhotoIds: [],
    validityStatus: "VALID",
    submissionHistory: [],
    correctionHistory: [],
  };

  await withMocks(
    {
      historyResult: [
        {
          entries: [makeJobEntry(record)],
          count: [{ total: 1 }],
        },
      ],
      monitoringRecords: [
        {
          _id: PLAN_ID,
          cleaningDate: "2026-11-25",
        },
      ],
    },
    async () => {
      const result = await getRecurringCleaningPlanHistory({
        planId: PLAN_ID,
        now: NOW,
      });

      assert.equal(result.plan.planId, PLAN_ID);
      assert.equal(result.plan.isActive, true);
      assert.equal(result.plan.atm.atmId, "ATM-001");
      assert.equal(result.plan.atm.bank.name, "Example Bank");
      assert.equal(result.plan.atm.region.name, "North");
      assert.equal(result.plan.atm.district.name, "Central District");
      assert.equal(result.plan.assignedEmployee.name, "Asha Kumar");
      assert.equal(result.plan.currentMonitoringStatus, "RED");
      assert.equal(result.plan.lastValidCleaningDate, "2026-11-25");
      assert.equal(result.history.entries[0].scheduledJob.status, "COMPLETED");
      assert.equal(
        result.history.entries[0].scheduledJob.scheduledDate,
        "2026-11-24T18:30:00.000Z",
      );
      assert.equal(
        result.history.entries[0].cleaningRecord.actualCleaningDate,
        "2026-11-25",
      );
      assert.equal(
        result.history.entries[0].cleaningRecord.outsourcedCleanerName,
        "Ravi",
      );
      assert.equal(result.history.entries[0].cleaningRecord.validityStatus, "VALID");
      assert.equal(result.history.pagination.total, 1);
    },
  );
});

test("pagination and date filters use scheduled date in Asia/Kolkata", async () => {
  await withMocks({}, async ({ getHistoryPipeline }) => {
    await getRecurringCleaningPlanHistory({
      planId: PLAN_ID,
      page: 2,
      limit: 10,
      fromDate: "2026-11-01",
      toDate: "2026-11-26",
      now: NOW,
    });

    const pipeline = getHistoryPipeline();
    const dateFilter = pipeline.find(
      (stage) => stage.$match?.historyDate,
    );
    assert.deepEqual(dateFilter.$match.historyDate, {
      $gte: "2026-11-01",
      $lte: "2026-11-26",
    });
    assert.equal(pipeline[0].$match["recurringMaintenance.planId"].toString(), PLAN_ID);
    assert.equal(
      pipeline[1].$lookup.from,
      CleaningRecord.collection.name,
    );
    assert.deepEqual(
      pipeline.at(-1).$facet.entries.slice(-2),
      [{ $skip: 10 }, { $limit: 10 }],
    );
    assert.deepEqual(
      pipeline.at(-1).$facet.entries[0].$sort,
      { historyDate: -1, activityAt: -1, stableId: -1 },
    );
  });
});

test("CleaningRecord remains visible when its Job is unavailable", async () => {
  const orphanRecord = {
    _id: "64b000000000000000000110",
    cleaningDate: "2026-11-25",
    actualCleanerType: "INTERNAL",
    submittedAt: new Date("2026-11-25T05:00:00.000Z"),
    validityStatus: "VALID",
    evidencePhotoIds: [],
    submissionHistory: [],
    correctionHistory: [],
  };

  await withMocks(
    {
      historyResult: [
        {
          entries: [
            makeJobEntry(orphanRecord, {
              job: null,
              historyDate: "2026-11-25",
            }),
          ],
          count: [{ total: 1 }],
        },
      ],
    },
    async ({ getHistoryPipeline }) => {
      const result = await getRecurringCleaningPlanHistory({
        planId: PLAN_ID,
        now: NOW,
      });
      const orphanBranch = getHistoryPipeline().find(
        (stage) => stage.$unionWith,
      ).$unionWith.pipeline;

      assert.equal(result.history.entries[0].scheduledJob, null);
      assert.equal(
        result.history.entries[0].cleaningRecord.actualCleaningDate,
        "2026-11-25",
      );
      assert.ok(orphanBranch.some((stage) => stage.$match?.$expr));
    },
  );
});

test("VOID records remain visible but do not change monitoring status", async () => {
  const voidRecord = {
    _id: "64b000000000000000000111",
    cleaningDate: "2026-11-25",
    actualCleanerType: "INTERNAL",
    submittedAt: new Date("2026-11-25T05:00:00.000Z"),
    validityStatus: "VOID",
    evidencePhotoIds: [],
    submissionHistory: [],
    correctionHistory: [],
  };

  await withMocks(
    {
      historyResult: [
        {
          entries: [makeJobEntry(voidRecord)],
          count: [{ total: 1 }],
        },
      ],
      monitoringRecords: [],
      plan: makePlan({
        monitoringActivatedAt: new Date("2026-11-25T06:00:00.000Z"),
      }),
    },
    async ({ getHistoryPipeline }) => {
      const result = await getRecurringCleaningPlanHistory({
        planId: PLAN_ID,
        now: NOW,
      });
      const historyMatch = getHistoryPipeline()[0].$match;

      assert.equal(result.history.entries[0].cleaningRecord.validityStatus, "VOID");
      assert.equal(result.plan.currentMonitoringStatus, "GRACE_PERIOD");
      assert.equal(historyMatch["recurringMaintenance.planId"].toString(), PLAN_ID);
    },
  );
});

test("inactive plans show PLAN INACTIVE and remain outside monitoring", async () => {
  await withMocks(
    {
      plan: makePlan({ isActive: false }),
      inactiveLatest: [{ _id: PLAN_ID, cleaningDate: "2026-11-24" }],
    },
    async ({ getMonitoringQueryCount, getInactiveQueryCount }) => {
      const result = await getRecurringCleaningPlanHistory({
        planId: PLAN_ID,
        now: NOW,
      });

      assert.equal(result.plan.currentMonitoringStatus, "PLAN INACTIVE");
      assert.equal(result.plan.lastValidCleaningDate, "2026-11-24");
      assert.equal(result.plan.daysSinceLastValidCleaning, 2);
      assert.equal(getMonitoringQueryCount(), 0);
      assert.equal(getInactiveQueryCount(), 1);
    },
  );
});

test("Jobs without CleaningRecords and empty history are returned without fabrication", async () => {
  await withMocks(
    {
      historyResult: [
        {
          entries: [makeJobEntry(null)],
          count: [{ total: 1 }],
        },
      ],
      monitoringRecords: [
        {
          planId: PLAN_ID,
          latestCleaningDate: null,
          ageInCalendarDays: null,
          status: "GRACE_PERIOD",
        },
      ],
    },
    async () => {
      const result = await getRecurringCleaningPlanHistory({
        planId: PLAN_ID,
        now: NOW,
      });
      assert.equal(result.history.entries.length, 1);
      assert.equal(result.history.entries[0].scheduledJob.status, "COMPLETED");
      assert.equal(result.history.entries[0].cleaningRecord, null);
    },
  );

  await withMocks({}, async () => {
    const result = await getRecurringCleaningPlanHistory({
      planId: PLAN_ID,
      now: NOW,
    });
    assert.deepEqual(result.history.entries, []);
    assert.equal(result.history.pagination.total, 0);
    assert.equal(result.history.pagination.totalPages, 0);
  });
});
