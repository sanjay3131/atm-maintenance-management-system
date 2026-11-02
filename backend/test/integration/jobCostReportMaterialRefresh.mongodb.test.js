import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import test from "node:test";
import errorMiddleware from "../../src/middlewares/error.middleware.js";
import ATM from "../../src/modules/atms/atm.model.js";
import Bank from "../../src/modules/banks/bank.model.js";
import Complaint from "../../src/modules/complaints/complaints.model.js";
import Customer from "../../src/modules/customers/customer.model.js";
import Employee from "../../src/modules/employees/employee.model.js";
import Item from "../../src/modules/items/item.model.js";
import jobCostReportRouter from "../../src/modules/jobCostReports/jobCostReport.routes.js";
import JobCostReport from "../../src/modules/jobCostReports/jobCostReport.model.js";
import {
  refreshJobCostReportMaterials,
} from "../../src/modules/jobCostReports/jobCostReport.service.js";
import Job from "../../src/modules/jobs/jobs.model.js";
import JobMaterialUsage from "../../src/modules/jobs/jobMaterialUsage.model.js";
import {
  createJobMaterialUsage,
  deleteJobMaterialUsage,
} from "../../src/modules/jobs/jobMaterialUsage.controller.js";
import User from "../../src/modules/users/user.model.js";

const expectedDatabaseName = "atm_job_cost_refresh_integration_test";
const testMongoUri = process.env.TEST_MONGODB_URI;
const testAccessSecret = "job-cost-refresh-integration-secret";
const integrationTest = testMongoUri ? test : test.skip;

const registeredModels = [
  ATM,
  Bank,
  Complaint,
  Customer,
  Employee,
  Item,
  Job,
  JobCostReport,
  JobMaterialUsage,
  User,
];
const ownedIds = new Map(registeredModels.map((model) => [model, []]));

const remember = (model, document) => {
  ownedIds.get(model).push(document._id);
  return document;
};

const objectId = () => new mongoose.Types.ObjectId();

const validateTestUri = () => {
  assert.ok(testMongoUri, "TEST_MONGODB_URI is required");

  let parsedUri;
  assert.doesNotThrow(() => {
    parsedUri = new URL(testMongoUri);
  }, "TEST_MONGODB_URI must be a valid MongoDB URI");

  assert.equal(parsedUri.protocol, "mongodb:");
  assert.ok(
    ["localhost", "127.0.0.1"].includes(parsedUri.hostname),
    "TEST_MONGODB_URI must target localhost",
  );
  assert.equal(parsedUri.username, "");
  assert.equal(parsedUri.password, "");
  assert.equal(
    decodeURIComponent(parsedUri.pathname.slice(1)),
    expectedDatabaseName,
  );
  assert.deepEqual(parsedUri.searchParams.getAll("replicaSet"), ["rs0"]);
  assert.deepEqual([...new Set(parsedUri.searchParams.keys())], ["replicaSet"]);
};

const createUser = async (userType, suffix) =>
  remember(
    User,
    await User.create({
      firstName: `Refresh ${userType}`,
      lastName: "Integration",
      email: `${userType}-${suffix}@integration.invalid`,
      password: "test-only-password",
      phoneNumber: `refresh-${userType}-${suffix}`,
      userType,
      status: "active",
    }),
  );

const createFixture = async ({ admin, employee, report = true } = {}) => {
  const suffix = objectId().toString();
  const item = remember(
    Item,
    await Item.create({
      itemName: `Refresh item ${suffix}`,
      normalizedName: `refresh-item-${suffix}`,
      unit: "piece",
      currentUnitCost: 12.5,
      createdBy: admin._id,
      updatedBy: admin._id,
    }),
  );
  const job = remember(
    Job,
    await Job.create({
      jobId: `REFRESH-${suffix}`,
      title: "Refresh integration Job",
      description: "Dedicated material refresh integration fixture",
      atmId: objectId(),
      assignedEmployeeId: employee._id,
      status: "IN_PROGRESS",
      createdBy: admin._id,
      updatedBy: admin._id,
    }),
  );

  let costReport = null;
  if (report) {
    costReport = remember(
      JobCostReport,
      await JobCostReport.create({
        jobId: job._id,
        jobSnapshot: { jobId: job.jobId },
        sourceRevisions: {
          materialUsageRevision: { value: 0, isKnown: true },
        },
        createdBy: admin._id,
        updatedBy: admin._id,
      }),
    );
  }

  return { item, job, costReport };
};

const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        resolve(this);
        return this;
      },
    };
    handler(req, response, (error) => {
      if (error) reject(error);
      else resolve(response);
    });
  });

const rejectionDetails = (result) =>
  result.status === "rejected"
    ? result.reason?.stack ?? String(result.reason)
    : "no rejection";

const createUsageThroughController = ({ job, item, employee }) =>
  invoke(createJobMaterialUsage, {
    params: { id: String(job._id) },
    body: { itemId: String(item._id), quantity: 2 },
    user: employee,
  }).then((response) => {
    const usageId = response.body?.data?._id;
    if (usageId) ownedIds.get(JobMaterialUsage).push(usageId);
    return response;
  });

const deleteUsageThroughController = ({ job, usageId, employee }) =>
  invoke(deleteJobMaterialUsage, {
    params: { id: String(job._id), usageId: String(usageId) },
    body: {},
    user: employee,
  });

const readMaterialState = async (jobId) => {
  const [job, report, usageEntries] = await Promise.all([
    Job.findById(jobId)
      .select("+materialUsageRevision +materialUsageRefreshEpoch")
      .lean(),
    JobCostReport.findOne({ jobId }).lean(),
    JobMaterialUsage.find({ jobId }).sort({ createdAt: 1, _id: 1 }).lean(),
  ]);
  return { job, report, usageEntries };
};

const snapshotForUsage = (usage) => ({
  usageId: String(usage._id),
  itemId: String(usage.itemId),
  itemNameSnapshot: usage.itemNameSnapshot,
  quantity: usage.quantity,
  unitSnapshot: usage.unitSnapshot,
  unitCostSnapshot: Number(usage.unitCostSnapshot).toFixed(2),
  lineCostSnapshot: Number(usage.lineCostSnapshot).toFixed(2),
  capturedAt: new Date(usage.createdAt).toISOString(),
});

const assertPersistedSnapshotConsistency = async (
  jobId,
  { staleSnapshot = null } = {},
) => {
  const { job, report, usageEntries } = await readMaterialState(jobId);
  assert.ok(job);
  assert.ok(report);

  if (report.materialSnapshotStatus !== "REFRESHED") {
    return { job, report, usageEntries };
  }

  assert.equal(report.materialSnapshotRevision?.isKnown, true);
  const capturedRevision = report.materialSnapshotRevision.value;
  assert.ok(capturedRevision <= job.materialUsageRevision);

  const persistedSnapshot = report.materialSnapshot.map((entry) => ({
    usageId: String(entry.usageId),
    itemId: entry.itemId ? String(entry.itemId) : null,
    itemNameSnapshot: entry.itemNameSnapshot,
    quantity: entry.quantity,
    unitSnapshot: entry.unitSnapshot,
    unitCostSnapshot: entry.unitCostSnapshot,
    lineCostSnapshot: entry.lineCostSnapshot,
    capturedAt: new Date(entry.capturedAt).toISOString(),
  }));

  if (capturedRevision === job.materialUsageRevision) {
    assert.deepEqual(
      persistedSnapshot,
      usageEntries.map(snapshotForUsage),
    );
  } else {
    assert.ok(
      capturedRevision < job.materialUsageRevision,
      "a changed material revision must make the report stale",
    );
    if (staleSnapshot) {
      assert.deepEqual(persistedSnapshot, staleSnapshot);
    }
  }

  return { job, report, usageEntries };
};

const createStartBarrier = (participantCount, timeoutMs = 10000) => {
  if (!Number.isInteger(participantCount) || participantCount <= 0) {
    throw new TypeError("participantCount must be a positive integer");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive finite number");
  }

  const participants = new Set();
  let timeout;
  let settled = false;
  let resolveBarrier;
  let rejectBarrier;
  const released = new Promise((resolve, reject) => {
    resolveBarrier = resolve;
    rejectBarrier = reject;
  });

  const settle = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (error) rejectBarrier(error);
    else resolveBarrier();
  };

  return async (participantId) => {
    if (settled) return released;
    if (typeof participantId !== "string" || participantId.length === 0) {
      throw new TypeError("A unique barrier participant ID is required");
    }
    if (participants.has(participantId)) {
      settle(
        new Error(
          `Duplicate barrier participant: ${participantId}`,
        ),
      );
      return released;
    }

    participants.add(participantId);
    timeout ??= setTimeout(() => {
      settle(
        new Error(
          `Barrier timed out after ${timeoutMs}ms waiting for ${participantCount} participants`,
        ),
      );
    }, timeoutMs);
    if (participants.size === participantCount) {
      clearTimeout(timeout);
      settle();
    }
    return released;
  };
};

const createHttpServer = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/jobs/:jobId/cost-report", jobCostReportRouter);
  app.use(errorMiddleware);

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    async request(method, path, user, body) {
      const response = await fetch(
        `http://127.0.0.1:${address.port}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${jwt.sign(
              { id: user._id },
              testAccessSecret,
              { expiresIn: "5m" },
            )}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      return {
        status: response.status,
        body: await response.json(),
      };
    },
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
};

integrationTest(
  "Job Cost Report material refresh uses real MongoDB transactions",
  async (t) => {
    validateTestUri();
    const previousSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = testAccessSecret;

    await mongoose.connect(testMongoUri, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: false,
      autoCreate: false,
    });

    t.after(async () => {
      const cleanupErrors = [];
      const attemptCleanup = async (operation) => {
        try {
          await operation();
        } catch (error) {
          cleanupErrors.push(error);
        }
      };

      const fixtureJobIds = ownedIds.get(Job);
      if (fixtureJobIds.length) {
        await attemptCleanup(() =>
          JobMaterialUsage.deleteMany({
            jobId: { $in: fixtureJobIds },
          }),
        );
      }
      for (const model of registeredModels) {
        if (model === JobMaterialUsage) continue;
        const ids = ownedIds.get(model);
        if (ids.length) {
          await attemptCleanup(() => model.deleteMany({ _id: { $in: ids } }));
        }
      }
      await attemptCleanup(() => mongoose.disconnect());
      await attemptCleanup(async () => {
        if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
        else process.env.JWT_ACCESS_SECRET = previousSecret;
      });

      if (cleanupErrors.length) {
        throw new AggregateError(
          cleanupErrors,
          "Integration fixture cleanup failed",
        );
      }
    });

    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.equal(hello.setName, "rs0");
    assert.equal(hello.isWritablePrimary, true);
    assert.notEqual(hello.logicalSessionTimeoutMinutes, undefined);
    assert.equal(mongoose.connection.name, expectedDatabaseName);

    const existingCollections = await mongoose.connection.db
      .listCollections({}, { nameOnly: true })
      .toArray();
    const expectedCollections = new Set(
      registeredModels.map((model) => model.collection.collectionName),
    );
    assert.ok(
      existingCollections.every(({ name }) => expectedCollections.has(name)),
      "dedicated database contains an unexpected collection",
    );
    for (const { name } of existingCollections) {
      assert.equal(
        await mongoose.connection.db.collection(name).countDocuments(),
        0,
        "dedicated database must be empty before the suite",
      );
    }
    for (const model of registeredModels) await model.init();

    const suffix = objectId().toString();
    const admin = await createUser("admin", suffix);
    const superAdmin = await createUser("superAdmin", suffix);
    const employee = await createUser("employee", suffix);
    const supervisor = await createUser("supervisor", suffix);
    const customer = await createUser("customer", suffix);
    remember(
      Employee,
      await Employee.create({
        userId: employee._id,
        employeeCode: `REFRESH-${suffix}`,
        designation: "Integration technician",
        department: "Maintenance",
        joiningDate: new Date("2026-01-01T00:00:00.000Z"),
        employmentType: "full-time",
        status: "active",
        createdBy: admin._id,
      }),
    );

    await t.test("refresh versus material creation has a serializable outcome", async () => {
      const fixture = await createFixture({ admin, employee });
      const start = createStartBarrier(2);
      const [refreshResult, createResult] = await Promise.allSettled([
        (async () => {
          await start("refresh");
          return refreshJobCostReportMaterials({
            jobId: fixture.job._id,
            actor: admin,
            expectedDraftRevision: 1,
          });
        })(),
        (async () => {
          await start("create");
          return createUsageThroughController({
            job: fixture.job,
            item: fixture.item,
            employee,
          });
        })(),
      ]);

      assert.equal(
        refreshResult.status,
        "fulfilled",
        `refresh rejected:\n${rejectionDetails(refreshResult)}`,
      );
      assert.equal(
        createResult.status,
        "fulfilled",
        `create rejected:\n${rejectionDetails(createResult)}`,
      );
      const state = await assertPersistedSnapshotConsistency(fixture.job._id);
      assert.equal(state.job.materialUsageRevision, 1);
      assert.equal(state.usageEntries.length, 1);
      if (state.report.materialSnapshotRevision.value === 0) {
        assert.deepEqual(state.report.materialSnapshot, []);
      }
    });

    await t.test("refresh versus material deletion has a serializable outcome", async () => {
      const fixture = await createFixture({ admin, employee });
      await createUsageThroughController({
        job: fixture.job,
        item: fixture.item,
        employee,
      });
      const usage = await JobMaterialUsage.findOne({ jobId: fixture.job._id });
      assert.ok(usage);
      const deletedUsageSnapshot = snapshotForUsage(usage);
      const start = createStartBarrier(2);

      const [refreshResult, deleteResult] = await Promise.allSettled([
        (async () => {
          await start("refresh");
          return refreshJobCostReportMaterials({
            jobId: fixture.job._id,
            actor: admin,
            expectedDraftRevision: 1,
          });
        })(),
        (async () => {
          await start("delete");
          return deleteUsageThroughController({
            job: fixture.job,
            usageId: usage._id,
            employee,
          });
        })(),
      ]);

      assert.equal(
        refreshResult.status,
        "fulfilled",
        `refresh rejected:\n${rejectionDetails(refreshResult)}`,
      );
      assert.equal(
        deleteResult.status,
        "fulfilled",
        `delete rejected:\n${rejectionDetails(deleteResult)}`,
      );
      const state = await assertPersistedSnapshotConsistency(
        fixture.job._id,
        { staleSnapshot: [deletedUsageSnapshot] },
      );
      assert.equal(state.job.materialUsageRevision, 2);
      assert.equal(state.usageEntries.length, 0);
      assert.equal(
        state.report.materialSnapshotRevision.value === 1 ||
          state.report.materialSnapshotRevision.value === 2,
        true,
      );
    });

    await t.test("parallel refreshes allow one draft revision winner", async () => {
      const fixture = await createFixture({ admin, employee });
      const initialJob = await Job.findById(fixture.job._id)
        .select("+materialUsageRefreshEpoch")
        .lean();
      const start = createStartBarrier(2);
      const results = await Promise.allSettled([
        (async () => {
          await start("admin-refresh");
          return refreshJobCostReportMaterials({
            jobId: fixture.job._id,
            actor: admin,
            expectedDraftRevision: 1,
          });
        })(),
        (async () => {
          await start("super-admin-refresh");
          return refreshJobCostReportMaterials({
            jobId: fixture.job._id,
            actor: superAdmin,
            expectedDraftRevision: 1,
          });
        })(),
      ]);

      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
        results.map(rejectionDetails).join("\n\n"),
      );
      assert.equal(
        results.filter(
          (result) =>
            result.status === "rejected" && result.reason?.statusCode === 409,
        ).length,
        1,
        results.map(rejectionDetails).join("\n\n"),
      );

      const { job, report } = await readMaterialState(fixture.job._id);
      assert.equal(report.draftRevision, 2);
      assert.equal(
        job.materialUsageRefreshEpoch,
        initialJob.materialUsageRefreshEpoch + 1,
      );
      assert.equal(job.materialUsageRevision, 0);
    });

    await t.test("epoch coordination rolls back with a failed report update", async () => {
      const fixture = await createFixture({ admin, employee });
      const before = await readMaterialState(fixture.job._id);
      const originalUpdate = JobCostReport.findOneAndUpdate;
      JobCostReport.findOneAndUpdate = () => {
        throw new Error("controlled integration failure");
      };

      try {
        await assert.rejects(
          refreshJobCostReportMaterials({
            jobId: fixture.job._id,
            actor: admin,
            expectedDraftRevision: 1,
          }),
          /controlled integration failure/,
        );
      } finally {
        JobCostReport.findOneAndUpdate = originalUpdate;
      }

      const after = await readMaterialState(fixture.job._id);
      assert.equal(
        after.job.materialUsageRefreshEpoch,
        before.job.materialUsageRefreshEpoch,
      );
      assert.equal(
        after.job.materialUsageRevision,
        before.job.materialUsageRevision,
      );
      assert.equal(after.report.materialSnapshotStatus, "NOT_REFRESHED");
      assert.deepEqual(after.report.materialSnapshot, []);
    });

    await t.test("successful refresh preserves Job and report timestamps/fields", async () => {
      const fixture = await createFixture({ admin, employee });
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      const reportCreatedAt = new Date("2026-01-02T00:00:00.000Z");
      await Job.updateOne(
        { _id: fixture.job._id },
        { $set: { createdAt } },
        { timestamps: false },
      );
      await JobCostReport.updateOne(
        { _id: fixture.costReport._id },
        {
          $set: {
            jobSnapshot: {
              jobId: fixture.job.jobId,
              bankName: "Preserved bank",
            },
            reportFields: {
              serviceLaborCost: "123.45",
              gstRate: "12.00",
              bankPurchaseOrderNumber: "PO-123",
              taxInvoiceNumber: "INV-123",
              filingPeriod: "2026-01",
              officeBillingStatus: "READY",
              overrides: {
                branch: { value: "Preserved branch", isOverridden: true },
              },
            },
            serviceVisits: [
              {
                sequence: 1,
                workPerformed: "Preserved visit",
                status: "COMPLETED",
              },
            ],
            createdAt: reportCreatedAt,
          },
        },
        { timestamps: false },
      );
      const before = await JobCostReport.findById(fixture.costReport._id).lean();
      const jobBefore = await Job.findById(fixture.job._id).lean();

      await refreshJobCostReportMaterials({
        jobId: fixture.job._id,
        actor: admin,
        expectedDraftRevision: 1,
      });

      const after = await JobCostReport.findById(fixture.costReport._id).lean();
      const jobAfter = await Job.findById(fixture.job._id).lean();
      assert.deepEqual(after.jobSnapshot, before.jobSnapshot);
      assert.deepEqual(after.reportFields, before.reportFields);
      assert.deepEqual(after.serviceVisits, before.serviceVisits);
      assert.equal(after.createdBy.toString(), before.createdBy.toString());
      assert.equal(after.createdAt.toISOString(), before.createdAt.toISOString());
      assert.equal(after.status, before.status);
      assert.equal(jobAfter.updatedAt.toISOString(), jobBefore.updatedAt.toISOString());
      assert.equal(after.draftRevision, 2);
      assert.equal(after.materialSnapshotStatus, "REFRESHED");
      assert.equal(after.materialSnapshotRevision.value, 0);
      assert.equal(after.materialSnapshotRevision.isKnown, true);
    });

    await t.test("refresh rejects unknown, missing, deleted, missing-report, and stale drafts", async () => {
      const missingReportFixture = await createFixture({
        admin,
        employee,
        report: false,
      });
      await assert.rejects(
        refreshJobCostReportMaterials({
          jobId: missingReportFixture.job._id,
          actor: admin,
          expectedDraftRevision: 1,
        }),
        (error) => error.statusCode === 404,
      );

      const deletedFixture = await createFixture({ admin, employee });
      await Job.updateOne(
        { _id: deletedFixture.job._id },
        { $set: { isDeleted: true } },
        { timestamps: false },
      );
      await assert.rejects(
        refreshJobCostReportMaterials({
          jobId: deletedFixture.job._id,
          actor: admin,
          expectedDraftRevision: 1,
        }),
        (error) => error.statusCode === 404,
      );

      const staleFixture = await createFixture({ admin, employee });
      await assert.rejects(
        refreshJobCostReportMaterials({
          jobId: staleFixture.job._id,
          actor: admin,
          expectedDraftRevision: 2,
        }),
        (error) => error.statusCode === 409,
      );

      const legacyJobId = objectId();
      await Job.collection.insertOne({
        _id: legacyJobId,
        jobId: `LEGACY-${legacyJobId}`,
        title: "Legacy revision Job",
        atmId: objectId(),
        assignedEmployeeId: employee._id,
        status: "IN_PROGRESS",
        createdBy: admin._id,
        createdAt: new Date(),
        isDeleted: false,
      });
      ownedIds.get(Job).push(legacyJobId);
      await JobCostReport.create({
        jobId: legacyJobId,
        jobSnapshot: { jobId: `LEGACY-${legacyJobId}` },
        sourceRevisions: {
          materialUsageRevision: { value: null, isKnown: false },
        },
        createdBy: admin._id,
        updatedBy: admin._id,
      }).then((report) => remember(JobCostReport, report));

      await assert.rejects(
        refreshJobCostReportMaterials({
          jobId: legacyJobId,
          actor: admin,
          expectedDraftRevision: 1,
        }),
        (error) => error.statusCode === 409,
      );
    });

    await t.test("mounted route enforces roles and refreshes for Admin/Super Admin", async () => {
      const fixture = await createFixture({ admin, employee });
      const server = await createHttpServer();
      t.after(() => server.close());

      const path = `/api/v1/jobs/${fixture.job._id}/cost-report/materials/refresh`;
      const adminResponse = await server.request(
        "POST",
        path,
        admin,
        { expectedDraftRevision: 1 },
      );
      assert.equal(adminResponse.status, 200);

      const secondFixture = await createFixture({ admin, employee });
      const superAdminResponse = await server.request(
        "POST",
        `/api/v1/jobs/${secondFixture.job._id}/cost-report/materials/refresh`,
        superAdmin,
        { expectedDraftRevision: 1 },
      );
      assert.equal(superAdminResponse.status, 200);

      const deniedResponses = await Promise.all(
        [employee, supervisor, customer].map((user) =>
          server.request(
            "POST",
            `/api/v1/jobs/${secondFixture.job._id}/cost-report/materials/refresh`,
            user,
            { expectedDraftRevision: 2 },
          ),
        ),
      );
      assert.deepEqual(
        deniedResponses.map(({ status }) => status),
        [403, 403, 403],
      );

      const invalid = await server.request(
        "POST",
        `/api/v1/jobs/${secondFixture.job._id}/cost-report/materials/refresh`,
        superAdmin,
        { expectedDraftRevision: 0 },
      );
      assert.equal(invalid.status, 400);

      const missingJobResponse = await server.request(
        "POST",
        `/api/v1/jobs/${objectId()}/cost-report/materials/refresh`,
        admin,
        { expectedDraftRevision: 1 },
      );
      assert.equal(missingJobResponse.status, 404);

      const deletedFixture = await createFixture({ admin, employee });
      await Job.updateOne(
        { _id: deletedFixture.job._id },
        { $set: { isDeleted: true } },
        { timestamps: false },
      );
      const deletedJobResponse = await server.request(
        "POST",
        `/api/v1/jobs/${deletedFixture.job._id}/cost-report/materials/refresh`,
        admin,
        { expectedDraftRevision: 1 },
      );
      assert.equal(deletedJobResponse.status, 404);

      const missingReportFixture = await createFixture({
        admin,
        employee,
        report: false,
      });
      const missingReportResponse = await server.request(
        "POST",
        `/api/v1/jobs/${missingReportFixture.job._id}/cost-report/materials/refresh`,
        admin,
        { expectedDraftRevision: 1 },
      );
      assert.equal(missingReportResponse.status, 404);

      const unknownRevisionFixture = await createFixture({ admin, employee });
      await Job.collection.updateOne(
        { _id: unknownRevisionFixture.job._id },
        { $unset: { materialUsageRevision: 1 } },
      );
      const unknownRevisionResponse = await server.request(
        "POST",
        `/api/v1/jobs/${unknownRevisionFixture.job._id}/cost-report/materials/refresh`,
        admin,
        { expectedDraftRevision: 1 },
      );
      assert.equal(unknownRevisionResponse.status, 409);

      const staleFixture = await createFixture({ admin, employee });
      await JobCostReport.updateOne(
        { _id: staleFixture.costReport._id },
        { $set: { draftRevision: 2 } },
        { timestamps: false },
      );
      const staleRevisionResponse = await server.request(
        "POST",
        `/api/v1/jobs/${staleFixture.job._id}/cost-report/materials/refresh`,
        admin,
        { expectedDraftRevision: 1 },
      );
      assert.equal(staleRevisionResponse.status, 409);
    });
  },
);
