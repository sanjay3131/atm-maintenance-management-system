import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import JobCostReport from "../src/modules/jobCostReports/jobCostReport.model.js";

const ids = {
  job: "64b000000000000000000001",
  user: "64b000000000000000000002",
  usage: "64b000000000000000000003",
  item: "64b000000000000000000004",
};

const sourceSnapshot = {
  jobId: "JOB-001",
  jobNumber: "WO-001",
  complaintNumber: "CMP-001",
  callLogDate: new Date("2026-10-01T00:00:00.000Z"),
  bankName: "Example Bank",
  branch: null,
  atmId: "ATM-001",
  atmLocationName: "Main Branch",
  atmAddress: "1 Main Street",
  complaintDescription: "Repair required",
  currentStatus: "COMPLETED",
  assignedTechnicianName: "Test Employee",
  assignedEmployeeCode: "EMP-001",
  workType: "repair",
  completionDate: new Date("2026-10-02T00:00:00.000Z"),
  employeeRemarks: "Completed",
};

test("JobCostReport applies approved defaults", () => {
  const report = new JobCostReport({
    jobId: ids.job,
    jobSnapshot: sourceSnapshot,
    createdBy: ids.user,
    updatedBy: ids.user,
    sourceRevisions: {
      materialUsageRevision: { isKnown: false },
    },
  });

  assert.equal(report.status, "DRAFT");
  assert.equal(report.draftRevision, 1);
  assert.equal(report.reportFields.serviceLaborCost, "0.00");
  assert.equal(report.reportFields.gstRate, "18.00");
  assert.deepEqual(report.serviceVisits, []);
  assert.deepEqual(report.materialSnapshot, []);
  assert.equal(report.materialSnapshotStatus, "NOT_REFRESHED");
  assert.deepEqual(report.materialSnapshotRevision.toObject(), {
    value: null,
    isKnown: false,
  });
  assert.equal(report.sourceRevisions.materialUsageRevision.value, null);
  assert.equal(report.sourceRevisions.materialUsageRevision.isKnown, false);
  assert.equal(report.serviceVisits.length, 0);
});

test("JobCostReport exposes a unique jobId index", () => {
  const indexes = JobCostReport.schema.indexes();
  const jobIndex = indexes.find(([fields]) => fields.jobId === 1);

  assert.ok(jobIndex);
  assert.equal(jobIndex[1].unique, true);
});

test("JobCostReport uses generated subdocument ids for service visits", () => {
  const report = new JobCostReport({
    jobId: ids.job,
    jobSnapshot: sourceSnapshot,
    serviceVisits: [{ sequence: 1, workPerformed: "Inspection" }],
    createdBy: ids.user,
    updatedBy: ids.user,
    sourceRevisions: {
      materialUsageRevision: { value: 2, isKnown: true },
    },
  });

  assert.ok(report.serviceVisits[0]._id instanceof mongoose.Types.ObjectId);
  assert.equal("id" in report.serviceVisits[0].toObject(), false);
});

test("JobCostReport rejects duplicate service visit sequences", async () => {
  const report = new JobCostReport({
    jobId: ids.job,
    jobSnapshot: sourceSnapshot,
    serviceVisits: [{ sequence: 1 }, { sequence: 1 }],
    createdBy: ids.user,
    updatedBy: ids.user,
    sourceRevisions: {
      materialUsageRevision: { value: 2, isKnown: true },
    },
  });

  await assert.rejects(
    () => report.validate(),
    (error) => /unique/.test(error.errors.serviceVisits.message),
  );
});

test("JobCostReport stores material snapshots without billing status", async () => {
  const report = new JobCostReport({
    jobId: ids.job,
    jobSnapshot: sourceSnapshot,
    materialSnapshot: [
      {
        usageId: ids.usage,
        itemId: ids.item,
        itemNameSnapshot: "Filter",
        quantity: 2,
        unitSnapshot: "piece",
        unitCostSnapshot: "12.50",
        lineCostSnapshot: "25.00",
        capturedAt: new Date("2026-10-02T00:00:00.000Z"),
        billingStatus: "Billed",
      },
    ],
    createdBy: ids.user,
    updatedBy: ids.user,
    sourceRevisions: {
      materialUsageRevision: { value: 2, isKnown: true },
    },
  });

  assert.equal("billingStatus" in report.materialSnapshot[0].toObject(), false);
  await report.validate();
});

test("JobCostReport defaults override values to null and inactive", () => {
  const report = new JobCostReport({
    jobId: ids.job,
    jobSnapshot: sourceSnapshot,
    createdBy: ids.user,
    updatedBy: ids.user,
    sourceRevisions: {
      materialUsageRevision: { isKnown: false },
    },
  });

  assert.deepEqual(report.reportFields.overrides.branch.toObject(), {
    value: null,
    isOverridden: false,
  });
  assert.deepEqual(report.reportFields.overrides.callLogDate.toObject(), {
    value: null,
    isOverridden: false,
  });
});

test("JobCostReport enforces required audit users and timestamps", async () => {
  const report = new JobCostReport({
    jobId: ids.job,
    jobSnapshot: sourceSnapshot,
    sourceRevisions: {
      materialUsageRevision: { isKnown: false },
    },
  });

  await assert.rejects(
    () => report.validate(),
    (error) => {
      assert.ok(error.errors.createdBy);
      assert.ok(error.errors.updatedBy);
      return true;
    },
  );
  assert.equal(JobCostReport.schema.get("createdAt"), undefined);
  assert.equal(JobCostReport.schema.options.timestamps, true);
});

test("JobCostReport rejects invalid monetary values at the model layer", async () => {
  const report = new JobCostReport({
    jobId: ids.job,
    jobSnapshot: sourceSnapshot,
    reportFields: {
      serviceLaborCost: "-1.00",
      gstRate: "1.234",
    },
    createdBy: ids.user,
    updatedBy: ids.user,
    sourceRevisions: {
      materialUsageRevision: { isKnown: false },
    },
  });

  await assert.rejects(
    () => report.validate(),
    (error) => {
      assert.ok(error.errors["reportFields.serviceLaborCost"]);
      assert.ok(error.errors["reportFields.gstRate"]);
      return true;
    },
  );
});

test("JobCostReport strips unsupported strict fields", () => {
  const report = new JobCostReport({
    jobId: ids.job,
    jobSnapshot: {
      ...sourceSnapshot,
      unsupported: "discard me",
    },
    unsupported: "discard me",
    createdBy: ids.user,
    updatedBy: ids.user,
    sourceRevisions: {
      materialUsageRevision: { isKnown: false },
    },
  });

  assert.equal("unsupported" in report.toObject(), false);
  assert.equal("unsupported" in report.jobSnapshot.toObject(), false);
});

test("JobCostReport rejects contradictory material revision states", async () => {
  for (const materialUsageRevision of [
    { value: 2, isKnown: false },
    { value: null, isKnown: true },
  ]) {
    const report = new JobCostReport({
      jobId: ids.job,
      jobSnapshot: sourceSnapshot,
      createdBy: ids.user,
      updatedBy: ids.user,
      sourceRevisions: { materialUsageRevision },
    });

    await assert.rejects(
      () => report.validate(),
      (error) => {
        assert.ok(
          error.errors["sourceRevisions.materialUsageRevision.value"],
        );
        return true;
      },
    );
  }
});
