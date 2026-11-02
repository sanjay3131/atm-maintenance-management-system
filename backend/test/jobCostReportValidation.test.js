import test from "node:test";
import assert from "node:assert/strict";
import {
  jobCostReportFieldsSchema,
  jobCostReportMaterialSnapshotSchema,
  jobCostReportSchema,
  jobCostReportServiceVisitSchema,
} from "../src/modules/jobCostReports/jobCostReport.validation.js";

const ids = {
  job: "64b000000000000000000001",
  user: "64b000000000000000000002",
  usage: "64b000000000000000000003",
  item: "64b000000000000000000004",
};

const validSnapshot = {
  jobId: "JOB-001",
  jobNumber: "WO-001",
  complaintNumber: "CMP-001",
  callLogDate: "2026-10-01T00:00:00.000Z",
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
  completionDate: "2026-10-02T00:00:00.000Z",
  employeeRemarks: "Completed",
};

const validOverrides = {
  bankName: { value: null, isOverridden: false },
  branch: { value: null, isOverridden: false },
  complaintDescription: { value: null, isOverridden: false },
  callLogDate: { value: null, isOverridden: false },
  atmLocationName: { value: null, isOverridden: false },
  atmAddress: { value: null, isOverridden: false },
  assignedTechnicianName: { value: null, isOverridden: false },
  workType: { value: null, isOverridden: false },
};

const validReport = () => ({
  jobId: ids.job,
  jobSnapshot: validSnapshot,
  reportFields: {
    overrides: validOverrides,
  },
  serviceVisits: [],
  materialSnapshot: [],
  sourceRevisions: {
    materialUsageRevision: { value: 2, isKnown: true },
    jobUpdatedAt: "2026-10-03T00:00:00.000Z",
    complaintUpdatedAt: "2026-10-01T00:00:00.000Z",
  },
  createdBy: ids.user,
  updatedBy: ids.user,
});

test("report validation applies approved defaults", () => {
  const result = jobCostReportSchema.parse(validReport());

  assert.equal(result.status, "DRAFT");
  assert.equal(result.draftRevision, 1);
  assert.equal(result.reportFields.serviceLaborCost, "0.00");
  assert.equal(result.reportFields.gstRate, "18.00");
  assert.equal(result.materialSnapshotStatus, "NOT_REFRESHED");
  assert.deepEqual(result.materialSnapshotRevision, {
    value: null,
    isKnown: false,
  });
});

test("money validation accepts non-negative values with at most two decimals", () => {
  const result = jobCostReportFieldsSchema.parse({
    overrides: validOverrides,
    serviceLaborCost: "100.50",
    gstRate: "18",
  });

  assert.equal(result.serviceLaborCost, "100.50");
  assert.equal(result.gstRate, "18");
});

test("money validation rejects negative, excessive precision, exponent, and non-finite values", () => {
  for (const value of ["-1.00", "1.234", "1e2", "NaN", "Infinity"]) {
    assert.throws(() =>
      jobCostReportFieldsSchema.parse({
        overrides: validOverrides,
        serviceLaborCost: value,
      }),
    );
  }
});

test("explicit blank overrides remain valid", () => {
  const fields = jobCostReportFieldsSchema.parse({
    overrides: {
      ...validOverrides,
      branch: { value: null, isOverridden: true },
    },
  });

  assert.deepEqual(fields.overrides.branch, {
    value: null,
    isOverridden: true,
  });
});

test("unsupported override keys are rejected", () => {
  assert.throws(() =>
    jobCostReportFieldsSchema.parse({
      overrides: {
        ...validOverrides,
        unsupported: { value: "x", isOverridden: true },
      },
    }),
  );
});

test("service visit validation accepts valid entries", () => {
  const visit = jobCostReportServiceVisitSchema.parse({
    sequence: 1,
    visitDate: "2026-10-02T00:00:00.000Z",
    workPerformed: "Completed repair",
    status: "COMPLETED",
    signOffOrPhotoReference: "RECEIVED",
  });

  assert.equal(visit.sequence, 1);
});

test("service visit validation rejects invalid sequences and fields", () => {
  assert.throws(() =>
    jobCostReportServiceVisitSchema.parse({ sequence: 0 }),
  );
  assert.throws(() =>
    jobCostReportServiceVisitSchema.parse({ sequence: 1.5 }),
  );
  assert.throws(() =>
    jobCostReportServiceVisitSchema.parse({
      sequence: 1,
      unknown: true,
    }),
  );
});

test("report validation rejects duplicate service visit sequences", () => {
  assert.throws(() =>
    jobCostReportSchema.parse({
      ...validReport(),
      serviceVisits: [{ sequence: 1 }, { sequence: 1 }],
    }),
  );
});

test("report validation accepts known and unknown material revision states", () => {
  const known = jobCostReportSchema.parse(validReport());
  assert.deepEqual(known.sourceRevisions.materialUsageRevision, {
    value: 2,
    isKnown: true,
  });

  test("material snapshot validation requires a consistent status and captured revision", () => {
    const refreshed = jobCostReportSchema.parse({
      ...validReport(),
      materialSnapshotStatus: "REFRESHED",
      materialSnapshotRevision: { value: 2, isKnown: true },
    });
    assert.equal(refreshed.materialSnapshotStatus, "REFRESHED");

    for (const materialSnapshotRevision of [
      { value: 2, isKnown: false },
      { value: null, isKnown: true },
    ]) {
      assert.throws(() =>
        jobCostReportSchema.parse({
          ...validReport(),
          materialSnapshotStatus: "REFRESHED",
          materialSnapshotRevision,
        }),
      );
    }
  });

  const unknown = jobCostReportSchema.parse({
    ...validReport(),
    sourceRevisions: {
      ...validReport().sourceRevisions,
      materialUsageRevision: { value: null, isKnown: false },
    },
  });
  assert.deepEqual(unknown.sourceRevisions.materialUsageRevision, {
    value: null,
    isKnown: false,
  });
});

test("report validation rejects contradictory material revision states", () => {
  for (const materialUsageRevision of [
    { value: 2, isKnown: false },
    { value: null, isKnown: true },
  ]) {
    assert.throws(() =>
      jobCostReportSchema.parse({
        ...validReport(),
        sourceRevisions: {
          ...validReport().sourceRevisions,
          materialUsageRevision,
        },
      }),
    );
  }
});

test("Zod rejects invalid JavaScript Date objects", () => {
  assert.throws(() =>
    jobCostReportServiceVisitSchema.parse({
      sequence: 1,
      visitDate: new Date("invalid"),
    }),
  );
});

test("material snapshot validation accepts historical decimal strings", () => {
  const snapshot = jobCostReportMaterialSnapshotSchema.parse({
    usageId: ids.usage,
    itemId: ids.item,
    itemNameSnapshot: "Filter",
    quantity: 2,
    unitSnapshot: "piece",
    unitCostSnapshot: "12.50",
    lineCostSnapshot: "25.00",
    capturedAt: "2026-10-02T00:00:00.000Z",
  });

  assert.equal(snapshot.lineCostSnapshot, "25.00");
});

test("material snapshot validation rejects fabricated billing status", () => {
  assert.throws(() =>
    jobCostReportMaterialSnapshotSchema.parse({
      usageId: ids.usage,
      itemId: ids.item,
      itemNameSnapshot: "Filter",
      quantity: 2,
      unitSnapshot: "piece",
      unitCostSnapshot: "12.50",
      lineCostSnapshot: "25.00",
      capturedAt: "2026-10-02T00:00:00.000Z",
      billingStatus: "Billed",
    }),
  );
});

test("report validation rejects client-provided calculated totals", () => {
  assert.throws(() =>
    jobCostReportSchema.parse({
      ...validReport(),
      calculations: {
        materialTotal: "25.00",
        subtotal: "100.00",
        gstAmount: "18.00",
        finalAmount: "118.00",
      },
    }),
  );
});
