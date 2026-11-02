import test from "node:test";
import assert from "node:assert/strict";
import { mapJobToCostReportSource } from "../src/modules/jobCostReports/jobCostReport.mapper.js";

const baseJob = () => ({
  _id: "64b000000000000000000001",
  jobId: "JOB-001",
  jobNumber: "WO-001",
  description: "Job description",
  status: "COMPLETED",
  workType: "repair",
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-03T00:00:00.000Z"),
  completedAt: new Date("2026-10-02T00:00:00.000Z"),
  employeeRemarks: "Employee remarks",
  materialUsageRevision: 4,
  complaintId: {
    _id: "64b000000000000000000002",
    complaintNumber: "CMP-001",
    title: "Complaint title",
    description: "Complaint description",
    reportedAt: new Date("2026-09-30T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  },
  atmId: {
    atmId: "ATM-001",
    locationName: "Main Branch",
    address: "1 Main Street",
    bankId: {
      bankName: "ATM Bank",
    },
  },
  customerId: {
    bankName: "Customer Bank",
  },
  assignedEmployeeId: {
    firstName: "Test",
    lastName: "Employee",
    employeeCode: "EMP-001",
  },
});

test("mapper creates a structured source snapshot from one populated Job graph", () => {
  const result = mapJobToCostReportSource(baseJob());

  assert.deepEqual(result.jobSnapshot, {
    jobId: "JOB-001",
    jobNumber: "WO-001",
    complaintNumber: "CMP-001",
    callLogDate: new Date("2026-09-30T00:00:00.000Z"),
    bankName: "ATM Bank",
    branch: null,
    atmId: "ATM-001",
    atmLocationName: "Main Branch",
    atmAddress: "1 Main Street",
    complaintDescription: "Complaint description",
    currentStatus: "COMPLETED",
    assignedTechnicianName: "Test Employee",
    assignedEmployeeCode: "EMP-001",
    workType: "repair",
    completionDate: new Date("2026-10-02T00:00:00.000Z"),
    employeeRemarks: "Employee remarks",
  });
  assert.deepEqual(result.sourceRevisions, {
    materialUsageRevision: { value: 4, isKnown: true },
    jobUpdatedAt: new Date("2026-10-03T00:00:00.000Z"),
    complaintUpdatedAt: new Date("2026-10-01T00:00:00.000Z"),
  });
});

test("mapper applies complaint, date, description, and bank fallbacks", () => {
  const job = baseJob();
  delete job.complaintId.complaintNumber;
  delete job.complaintId.reportedAt;
  delete job.complaintId.description;
  delete job.complaintId.title;
  delete job.atmId.bankId;
  job.complaintId = { updatedAt: null };
  job.customerId = { bankName: "Fallback Bank" };

  const result = mapJobToCostReportSource(job);

  assert.equal(result.jobSnapshot.jobId, "JOB-001");
  assert.equal(result.jobSnapshot.complaintNumber, "WO-001");
  assert.equal(
    result.jobSnapshot.callLogDate.toISOString(),
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(result.jobSnapshot.complaintDescription, "Job description");
  assert.equal(result.jobSnapshot.bankName, "Fallback Bank");
  assert.equal(result.jobSnapshot.branch, null);
});

test("mapper falls back from complaint title to Job title", () => {
  const job = baseJob();
  job.complaintId = { reportedAt: job.createdAt };
  delete job.description;
  job.title = "Job title";
  job.atmId.bankId = undefined;
  job.customerId = undefined;

  const result = mapJobToCostReportSource(job);

  assert.equal(result.jobSnapshot.complaintDescription, "Job title");
  assert.equal(result.jobSnapshot.bankName, null);
});

test("mapper uses Job ID and preserves unknown material revision", () => {
  const job = baseJob();
  delete job.jobNumber;
  delete job.jobId;
  delete job.materialUsageRevision;
  job.complaintId = null;
  job.atmId = null;
  job.customerId = null;
  job.assignedEmployeeId = null;

  const result = mapJobToCostReportSource(job);

  assert.equal(result.jobSnapshot.jobId, "64b000000000000000000001");
  assert.deepEqual(result.sourceRevisions.materialUsageRevision, {
    value: null,
    isKnown: false,
  });
  assert.equal(result.jobSnapshot.assignedTechnicianName, null);
  assert.equal(result.jobSnapshot.assignedEmployeeCode, null);
});

test("mapper does not fabricate service visits or mutate input", () => {
  const job = baseJob();
  const original = structuredClone(job);

  const result = mapJobToCostReportSource(job);

  assert.equal("serviceVisits" in result, false);
  assert.deepEqual(job, original);
});
