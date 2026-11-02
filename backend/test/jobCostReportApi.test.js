import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Job from "../src/modules/jobs/jobs.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import JobMaterialUsage from "../src/modules/jobs/jobMaterialUsage.model.js";
import JobCostReport from "../src/modules/jobCostReports/jobCostReport.model.js";
import jobCostReportRouter from "../src/modules/jobCostReports/jobCostReport.routes.js";
import {
  jobCostReportParamsSchema,
  refreshJobCostReportSchema,
  updateJobCostReportSchema,
} from "../src/modules/jobCostReports/jobCostReport.api.validation.js";
import {
  getKnownMaterialUsageRevision,
  getJobCostReport,
  initializeJobCostReport,
  isMaterialSnapshotFresh,
  mapMaterialUsageToSnapshot,
  refreshJobCostReportMaterials,
  updateJobCostReport,
} from "../src/modules/jobCostReports/jobCostReport.service.js";

const ids = {
  job: "64b000000000000000000001",
  user: "64b000000000000000000002",
  employee: "64b000000000000000000003",
};

const makeJob = (overrides = {}) => ({
  _id: ids.job,
  jobId: "JOB-001",
  jobNumber: "WO-001",
  title: "Job title",
  description: "Job description",
  status: "COMPLETED",
  workType: "repair",
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-03T00:00:00.000Z"),
  materialUsageRevision: 0,
  complaintId: null,
  atmId: {
    atmId: "ATM-001",
    locationName: "Main Branch",
    address: "1 Main Street",
    bankId: { bankName: "ATM Bank" },
  },
  customerId: { bankName: "Customer Bank" },
  assignedEmployeeId: {
    _id: ids.employee,
    firstName: "Test",
    lastName: "Employee",
  },
  toObject() {
    const { toObject, ...job } = this;
    return job;
  },
  ...overrides,
});

const query = (value) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  session() {
    return this;
  },
  lean() {
    return Promise.resolve(value);
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const withModelMocks = async (mocks, callback) => {
  const originals = [
    [Job, "findOne", Job.findOne],
    [Employee, "findOne", Employee.findOne],
    [JobCostReport, "findOne", JobCostReport.findOne],
    [JobCostReport, "findOneAndUpdate", JobCostReport.findOneAndUpdate],
  ];

  Job.findOne = mocks.jobFindOne;
  Employee.findOne = mocks.employeeFindOne ?? (() => query(null));
  JobCostReport.findOne = mocks.reportFindOne;
  JobCostReport.findOneAndUpdate = mocks.reportFindOneAndUpdate;

  try {
    return await callback();
  } finally {
    for (const [model, method, original] of originals) {
      model[method] = original;
    }
  }
};

const withRefreshMocks = async (
  {
    job = makeJob(),
    usageEntries = [],
    report = {
      _id: "report-1",
      jobId: ids.job,
      draftRevision: 2,
      materialSnapshotStatus: "REFRESHED",
      materialSnapshotRevision: { value: 4, isKnown: true },
    },
    reportUpdate = report,
    reportLookup = report,
  } = {},
  callback,
) => {
  const originals = [
    [mongoose, "startSession", mongoose.startSession],
    [Job, "findOne", Job.findOne],
    [Job, "updateOne", Job.updateOne],
    [JobMaterialUsage, "find", JobMaterialUsage.find],
    [JobCostReport, "findOne", JobCostReport.findOne],
    [JobCostReport, "findOneAndUpdate", JobCostReport.findOneAndUpdate],
  ];
  const calls = [];
  const session = {
    async withTransaction(operation) {
      return operation(this);
    },
    async endSession() {},
  };

  mongoose.startSession = async () => session;
  Job.findOne = () => query(job);
  Job.updateOne = async (filter, update, options) => {
    calls.push({ type: "jobUpdate", filter, update, options });
    return { matchedCount: 1 };
  };
  JobMaterialUsage.find = (filter) => {
    calls.push({ type: "usageFind", filter });
    return query(usageEntries);
  };
  JobCostReport.findOne = async () => reportLookup;
  JobCostReport.findOneAndUpdate = async (filter, update, options) => {
    calls.push({ type: "reportUpdate", filter, update, options });
    return reportUpdate;
  };

  try {
    return await callback({ calls, session });
  } finally {
    for (const [model, method, original] of originals.reverse()) {
      model[method] = original;
    }
  }
};

test("raw revision detection distinguishes missing, valid, and invalid values", () => {
  assert.deepEqual(getKnownMaterialUsageRevision({}), {
    value: null,
    isKnown: false,
  });
  assert.deepEqual(getKnownMaterialUsageRevision({ materialUsageRevision: 0 }), {
    value: 0,
    isKnown: true,
  });
  assert.deepEqual(getKnownMaterialUsageRevision({ materialUsageRevision: 4 }), {
    value: 4,
    isKnown: true,
  });

  for (const value of [null, -1, 1.5, "4"]) {
    assert.deepEqual(getKnownMaterialUsageRevision({ materialUsageRevision: value }), {
      value: null,
      isKnown: false,
    });
  }

  const schema = new mongoose.Schema({
    materialUsageRevision: { type: Number, default: 0, select: false },
  });
  const Model = mongoose.model(`LegacyRevisionTest_${process.pid}`, schema);
  const hydrated = Model.hydrate({});
  assert.equal(hydrated.materialUsageRevision, 0);
  assert.deepEqual(getKnownMaterialUsageRevision({}), {
    value: null,
    isKnown: false,
  });
});

test("material snapshots map immutable historical usage values and freshness is strict", () => {
  const usage = {
    _id: "usage-1",
    itemId: "item-1",
    itemNameSnapshot: "Historical filter",
    quantity: 2,
    unitSnapshot: "piece",
    unitCostSnapshot: 12.5,
    lineCostSnapshot: 25,
    createdAt: new Date("2026-10-02T00:00:00.000Z"),
  };
  assert.deepEqual(mapMaterialUsageToSnapshot([usage]), [
    {
      usageId: "usage-1",
      itemId: "item-1",
      itemNameSnapshot: "Historical filter",
      quantity: 2,
      unitSnapshot: "piece",
      unitCostSnapshot: "12.50",
      lineCostSnapshot: "25.00",
      capturedAt: usage.createdAt,
    },
  ]);

  const report = {
    materialSnapshotStatus: "REFRESHED",
    materialSnapshotRevision: { value: 4, isKnown: true },
  };
  assert.equal(
    isMaterialSnapshotFresh({
      report,
      job: { materialUsageRevision: 4 },
    }),
    true,
  );
  assert.equal(
    isMaterialSnapshotFresh({
      report: { ...report, materialSnapshotStatus: "NOT_REFRESHED" },
      job: { materialUsageRevision: 4 },
    }),
    false,
  );
  assert.equal(
    isMaterialSnapshotFresh({ report, job: {} }),
    false,
  );
  assert.equal(
    isMaterialSnapshotFresh({
      report,
      job: { materialUsageRevision: 5 },
    }),
    false,
  );
});

test("refresh captures zero or historical materials and preserves unrelated fields", async () => {
  const usageEntries = [
    {
      _id: "usage-1",
      itemId: "item-1",
      itemNameSnapshot: "Historical filter",
      quantity: 2,
      unitSnapshot: "piece",
      unitCostSnapshot: 12.5,
      lineCostSnapshot: 25,
      createdAt: new Date("2026-10-02T00:00:00.000Z"),
    },
  ];
  const originalReport = {
    _id: "report-1",
    jobId: ids.job,
    draftRevision: 1,
    reportFields: { gstRate: "18.00", purchaseOrderNumber: "PO-1" },
    serviceVisits: [{ sequence: 1 }],
  };

  await withRefreshMocks(
    {
      job: makeJob({ materialUsageRevision: 4 }),
      usageEntries,
      report: originalReport,
      reportUpdate: {
        ...originalReport,
        draftRevision: 2,
        materialSnapshotStatus: "REFRESHED",
        materialSnapshotRevision: { value: 4, isKnown: true },
      },
    },
    async ({ calls }) => {
      const refreshed = await refreshJobCostReportMaterials({
        jobId: ids.job,
        actor: { _id: ids.user },
        expectedDraftRevision: 1,
      });

      assert.equal(refreshed.draftRevision, 2);
      assert.equal(refreshed.materialSnapshotFresh, true);
      const coordination = calls.find(({ type }) => type === "jobUpdate");
      assert.deepEqual(coordination.filter.materialUsageRevision, 4);
      assert.deepEqual(coordination.update, {
        $inc: { materialUsageRefreshEpoch: 1 },
      });
      assert.equal(coordination.options.timestamps, false);

      const update = calls.find(({ type }) => type === "reportUpdate");
      assert.deepEqual(update.filter, {
        jobId: ids.job,
        draftRevision: 1,
      });
      assert.deepEqual(update.update.$set.materialSnapshot, [
        {
          usageId: "usage-1",
          itemId: "item-1",
          itemNameSnapshot: "Historical filter",
          quantity: 2,
          unitSnapshot: "piece",
          unitCostSnapshot: "12.50",
          lineCostSnapshot: "25.00",
          capturedAt: usageEntries[0].createdAt,
        },
      ]);
      assert.deepEqual(update.update.$set.materialSnapshotRevision, {
        value: 4,
        isKnown: true,
      });
      assert.equal(update.update.$set.materialSnapshotStatus, "REFRESHED");
      assert.equal(update.update.$inc.draftRevision, 1);
      assert.equal(update.update.$set.updatedBy, ids.user);
      assert.equal(update.options.new, true);
    },
  );
});

test("refresh rejects unknown source revisions before coordinating or updating", async () => {
  await withRefreshMocks(
    { job: makeJob({ materialUsageRevision: undefined }) },
    async ({ calls }) => {
      await assert.rejects(
        () =>
          refreshJobCostReportMaterials({
            jobId: ids.job,
            actor: { _id: ids.user },
            expectedDraftRevision: 1,
          }),
        (error) => error.statusCode === 409,
      );
      assert.equal(calls.length, 0);
    },
  );
});

test("refresh allows an empty historical material set", async () => {
  await withRefreshMocks(
    {
      job: makeJob({ materialUsageRevision: 0 }),
      usageEntries: [],
      report: { _id: "report-1", jobId: ids.job, draftRevision: 1 },
      reportUpdate: {
        _id: "report-1",
        jobId: ids.job,
        draftRevision: 2,
        materialSnapshot: [],
        materialSnapshotStatus: "REFRESHED",
        materialSnapshotRevision: { value: 0, isKnown: true },
      },
    },
    async ({ calls }) => {
      const result = await refreshJobCostReportMaterials({
        jobId: ids.job,
        actor: { _id: ids.user },
        expectedDraftRevision: 1,
      });

      assert.deepEqual(result.materialSnapshot, []);
      assert.equal(result.materialSnapshotStatus, "REFRESHED");
      assert.equal(calls.filter(({ type }) => type === "jobUpdate").length, 1);
    },
  );
});

test("refresh reports a stale draft revision without a report update", async () => {
  await withRefreshMocks(
    {
      job: makeJob({ materialUsageRevision: 2 }),
      report: { _id: "report-1", jobId: ids.job, draftRevision: 3 },
      reportUpdate: null,
      reportLookup: { _id: "report-1", jobId: ids.job, draftRevision: 3 },
    },
    async ({ calls }) => {
      await assert.rejects(
        () =>
          refreshJobCostReportMaterials({
            jobId: ids.job,
            actor: { _id: ids.user },
            expectedDraftRevision: 1,
          }),
        (error) => error.statusCode === 409,
      );
      assert.equal(
        calls.filter(({ type }) => type === "reportUpdate").length,
        1,
      );
    },
  );
});

test("API validation restricts params and editable update fields", () => {
  assert.equal(
    jobCostReportParamsSchema.parse({ jobId: ids.job }).jobId,
    ids.job,
  );
  const patch = updateJobCostReportSchema.parse({
    expectedDraftRevision: 1,
    serviceLaborCost: "25.00",
    overrides: {
      branch: { value: null, isOverridden: true },
    },
  });
  assert.equal(patch.serviceLaborCost, "25.00");
  assert.equal(patch.overrides.branch.isOverridden, true);
  assert.equal(
    refreshJobCostReportSchema.parse({ expectedDraftRevision: 1 })
      .expectedDraftRevision,
    1,
  );

  assert.throws(() =>
    updateJobCostReportSchema.parse({
      expectedDraftRevision: 1,
      materialSnapshot: [],
    }),
  );
  assert.throws(() =>
    updateJobCostReportSchema.parse({
      expectedDraftRevision: 1,
      calculations: { subtotal: "10.00" },
    }),
  );
  assert.throws(() =>
    updateJobCostReportSchema.parse({ expectedDraftRevision: 1 }),
  );
  assert.throws(() =>
    updateJobCostReportSchema.parse({
      expectedDraftRevision: 1,
      overrides: {},
    }),
  );
});

test("cost report routes require admin or superAdmin roles", () => {
  const routes = jobCostReportRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
    }));

  assert.deepEqual(routes, [
    { path: "/materials/refresh", methods: ["post"] },
    { path: "/", methods: ["post"] },
    { path: "/", methods: ["get"] },
    { path: "/export.xlsx", methods: ["get"] },
    { path: "/", methods: ["patch"] },
  ]);
  assert.equal(typeof jobCostReportRouter.stack[0].handle, "function");
  assert.equal(typeof jobCostReportRouter.stack[1].handle, "function");
});

test("initialization creates an enriched draft with known material revision", async () => {
  const calls = [];
  const job = makeJob();
  const createdReport = { _id: "report-1", jobId: ids.job };

  await withModelMocks(
    {
      jobFindOne: () => query(job),
      employeeFindOne: () => {
        calls.push("employee");
        return query({ employeeCode: "EMP-001" });
      },
      reportFindOne: async () => null,
      reportFindOneAndUpdate: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return createdReport;
      },
    },
    async () => {
      const result = await initializeJobCostReport({
        jobId: ids.job,
        actor: { _id: ids.user },
      });

      assert.equal(result.created, true);
      assert.equal(result.report, createdReport);
      assert.equal(calls[0], "employee");
      assert.equal(calls[1].filter.jobId, ids.job);
      assert.equal(calls[1].update.$setOnInsert.sourceRevisions.materialUsageRevision.value, 0);
      assert.equal(
        calls[1].update.$setOnInsert.sourceRevisions.materialUsageRevision.isKnown,
        true,
      );
      assert.equal(calls[1].update.$setOnInsert.serviceVisits.length, 0);
      assert.equal(
        calls[1].update.$setOnInsert.materialSnapshotStatus,
        "NOT_REFRESHED",
      );
      assert.deepEqual(
        calls[1].update.$setOnInsert.materialSnapshotRevision,
        { value: null, isKnown: false },
      );
      assert.equal(calls[1].options.upsert, true);
    },
  );
});

test("repeated initialization returns the existing draft without resetting it", async () => {
  const existingReport = {
    _id: "report-1",
    jobId: ids.job,
    draftRevision: 4,
    reportFields: { serviceLaborCost: "99.00" },
  };
  let upsertCalled = false;

  await withModelMocks(
    {
      jobFindOne: () => query(makeJob()),
      reportFindOne: async () => existingReport,
      reportFindOneAndUpdate: async () => {
        upsertCalled = true;
        return null;
      },
    },
    async () => {
      const result = await initializeJobCostReport({
        jobId: ids.job,
        actor: { _id: ids.user },
      });

      assert.equal(result.created, false);
      assert.equal(result.report, existingReport);
      assert.equal(upsertCalled, false);
    },
  );
});

test("retrieval returns an existing draft and rejects a missing draft", async () => {
  const existingReport = { _id: "report-1", jobId: ids.job };
  let report = existingReport;

  await withModelMocks(
    {
      jobFindOne: () => query(makeJob()),
      reportFindOne: async () => report,
      reportFindOneAndUpdate: async () => null,
    },
    async () => {
      assert.equal(
        (await getJobCostReport({ jobId: ids.job }))._id,
        existingReport._id,
      );
      assert.equal(
        (await getJobCostReport({ jobId: ids.job })).materialSnapshotFresh,
        false,
      );

      report = null;
      await assert.rejects(
        () => getJobCostReport({ jobId: ids.job }),
        (error) => error.statusCode === 404,
      );
    },
  );
});

test("duplicate initialization race retrieves the created draft", async () => {
  const existingReport = { _id: "report-1", jobId: ids.job };
  let reportLookupCount = 0;

  await withModelMocks(
    {
      jobFindOne: () => query(makeJob()),
      reportFindOne: async () => {
        reportLookupCount += 1;
        return reportLookupCount === 1 ? null : existingReport;
      },
      reportFindOneAndUpdate: async () => {
        const error = new Error("duplicate");
        error.code = 11000;
        throw error;
      },
    },
    async () => {
      const result = await initializeJobCostReport({
        jobId: ids.job,
        actor: { _id: ids.user },
      });

      assert.equal(result.created, false);
      assert.equal(result.report, existingReport);
    },
  );
});

test("soft-deleted or missing Jobs are not available to report operations", async () => {
  await withModelMocks(
    {
      jobFindOne: () => query(null),
      reportFindOne: async () => {
        throw new Error("should not query report");
      },
      reportFindOneAndUpdate: async () => {
        throw new Error("should not update report");
      },
    },
    async () => {
      await assert.rejects(
        () => initializeJobCostReport({ jobId: ids.job, actor: { _id: ids.user } }),
        (error) => error.statusCode === 404,
      );
      await assert.rejects(
        () => getJobCostReport({ jobId: ids.job }),
        (error) => error.statusCode === 404,
      );
    },
  );
});

test("active Jobs with false or missing isDeleted remain available across report operations", async () => {
  const activeJob = makeJob({ isDeleted: false });
  const legacyJob = makeJob();
  const existingReport = { _id: "report-1", jobId: ids.job, draftRevision: 1 };
  const calls = [];
  let reportLookupCount = 0;

  await withModelMocks(
    {
      jobFindOne: (filter) => {
        calls.push(filter);
        return query(calls.length === 1 ? activeJob : legacyJob);
      },
      employeeFindOne: () => query({ employeeCode: "EMP-001" }),
      reportFindOne: async () => {
        reportLookupCount += 1;
        return reportLookupCount === 1 ? null : existingReport;
      },
      reportFindOneAndUpdate: async () => existingReport,
    },
    async () => {
      const initialized = await initializeJobCostReport({
        jobId: ids.job,
        actor: { _id: ids.user },
      });
      assert.equal(initialized.created, true);

      assert.equal(
        (await getJobCostReport({ jobId: ids.job }))._id,
        existingReport._id,
      );

      assert.equal(
        (
          await updateJobCostReport({
            jobId: ids.job,
            actor: { _id: ids.user },
            expectedDraftRevision: 1,
            patch: { serviceLaborCost: "50.00" },
          })
        )._id,
        existingReport._id,
      );
    },
  );

  assert.deepEqual(calls, [
    { _id: ids.job, isDeleted: { $ne: true } },
    { _id: ids.job, isDeleted: { $ne: true } },
    { _id: ids.job, isDeleted: { $ne: true } },
  ]);
  assert.equal(Object.hasOwn(legacyJob, "isDeleted"), false);
});

test("soft-deleted and nonexistent Jobs remain inaccessible with the compatibility filter", async () => {
  const queries = [];
  const softDeletedJob = makeJob({ isDeleted: true });
  const sourceDocuments = [softDeletedJob, null, softDeletedJob];

  await withModelMocks(
    {
      jobFindOne: (filter) => {
        queries.push(filter);
        const source = sourceDocuments.shift();
        const matches =
          source !== null && filter.isDeleted.$ne !== source.isDeleted;
        return query(matches ? source : null);
      },
      reportFindOne: async () => {
        throw new Error("should not query report");
      },
      reportFindOneAndUpdate: async () => {
        throw new Error("should not update report");
      },
    },
    async () => {
      await assert.rejects(
        () =>
          initializeJobCostReport({
            jobId: ids.job,
            actor: { _id: ids.user },
          }),
        (error) => error.statusCode === 404,
      );
      await assert.rejects(
        () => getJobCostReport({ jobId: ids.job }),
        (error) => error.statusCode === 404,
      );
      await assert.rejects(
        () =>
          updateJobCostReport({
            jobId: ids.job,
            actor: { _id: ids.user },
            expectedDraftRevision: 1,
            patch: { serviceLaborCost: "50.00" },
          }),
        (error) => error.statusCode === 404,
      );
    },
  );

  assert.deepEqual(queries, [
    { _id: ids.job, isDeleted: { $ne: true } },
    { _id: ids.job, isDeleted: { $ne: true } },
    { _id: ids.job, isDeleted: { $ne: true } },
  ]);
});

test("update uses the expected revision atomically and increments once", async () => {
  const calls = [];
  const updatedReport = { draftRevision: 2 };

  await withModelMocks(
    {
      jobFindOne: () => query(makeJob()),
      reportFindOne: async () => updatedReport,
      reportFindOneAndUpdate: async (filter, update, options) => {
        calls.push({ filter, update, options });
        return updatedReport;
      },
    },
    async () => {
      const result = await updateJobCostReport({
        jobId: ids.job,
        actor: { _id: ids.user },
        expectedDraftRevision: 1,
        patch: {
          serviceLaborCost: "50.00",
          overrides: {
            branch: { value: null, isOverridden: true },
          },
          serviceVisits: [{ sequence: 1, workPerformed: "Inspection" }],
        },
      });

      assert.equal(result, updatedReport);
      assert.equal(calls[0].filter.jobId, ids.job);
      assert.equal(calls[0].filter.draftRevision, 1);
      assert.equal(calls[0].update.$inc.draftRevision, 1);
      assert.equal(calls[0].update.$set.updatedBy, ids.user);
      assert.equal(calls[0].update.$set["reportFields.serviceLaborCost"], "50.00");
      assert.equal(
        calls[0].update.$set["reportFields.overrides.branch"].isOverridden,
        true,
      );
      assert.equal("materialSnapshot" in calls[0].update.$set, false);
      assert.equal("jobId" in calls[0].update.$set, false);
      assert.equal("status" in calls[0].update.$set, false);
      assert.equal(calls[0].options.runValidators, true);
    },
  );
});

test("stale draft revision returns a conflict", async () => {
  await withModelMocks(
    {
      jobFindOne: () => query(makeJob()),
      reportFindOne: async () => ({ draftRevision: 3 }),
      reportFindOneAndUpdate: async () => null,
    },
    async () => {
      await assert.rejects(
        () =>
          updateJobCostReport({
            jobId: ids.job,
            actor: { _id: ids.user },
            expectedDraftRevision: 2,
            patch: { serviceLaborCost: "50.00" },
          }),
        (error) => error.statusCode === 409,
      );
    },
  );
});
