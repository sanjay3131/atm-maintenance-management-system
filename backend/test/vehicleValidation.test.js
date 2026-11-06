import assert from "node:assert/strict";
import test from "node:test";
import {
  completeSessionSchema,
  createVehicleSchema,
  reportQuerySchema,
  serviceReviewParamsSchema,
  serviceReviewSchema,
  servicePolicyUpdateSchema,
  transferSchema,
} from "../src/modules/vehicles/vehicle.validation.js";

test("vehicle creation rejects client-controlled odometer and revision fields", () => {
  const valid = {
    registrationNumber: "TN 45 AB 1234",
    make: "Honda",
    model: "Shine",
    initialOdometerKm: 100,
  };
  assert.equal(createVehicleSchema.safeParse(valid).success, true);
  assert.equal(
    createVehicleSchema.safeParse({ ...valid, currentOdometerKm: 100 }).success,
    false,
  );
  assert.equal(
    createVehicleSchema.safeParse({ ...valid, initialOdometerKm: 1.5 }).success,
    false,
  );
  assert.equal(
    createVehicleSchema.safeParse({ ...valid, registrationNumber: "TN/45/AB" })
      .success,
    false,
  );
});

test("transfer requires both revisions and distinct vehicles", () => {
  const ids = {
    employeeId: "64b000000000000000000001",
    sourceVehicleId: "64b000000000000000000002",
    targetVehicleId: "64b000000000000000000003",
    expectedSourceRevision: 0,
    expectedTargetRevision: 4,
  };
  assert.equal(transferSchema.safeParse(ids).success, true);
  assert.equal(
    transferSchema.safeParse({ ...ids, expectedTargetRevision: undefined })
      .success,
    false,
  );
});

test("session completion requires a safe integer and expected revision", () => {
  assert.equal(
    completeSessionSchema.safeParse({
      endingOdometerKm: 0,
      expectedVehicleRevision: 2,
    }).success,
    true,
  );
  assert.equal(
    completeSessionSchema.safeParse({
      endingOdometerKm: 2.5,
      expectedVehicleRevision: 2,
    }).success,
    false,
  );
});

test("report date filters must be paired and ordered", () => {
  const fromDate = "2026-01-01";
  const toDate = "2026-01-31";
  assert.equal(reportQuerySchema.safeParse({ fromDate, toDate }).success, true);
  assert.equal(reportQuerySchema.safeParse({ fromDate }).success, false);
  assert.equal(
    reportQuerySchema.safeParse({ fromDate: toDate, toDate: fromDate }).success,
    false,
  );
});

test("service interval policy updates accept explicit initial version zero", () => {
  assert.equal(
    servicePolicyUpdateSchema.safeParse({
      intervalKm: 3000,
      expectedVersion: 0,
    }).success,
    true,
  );
  assert.equal(
    servicePolicyUpdateSchema.safeParse({ intervalKm: 0, expectedVersion: 0 })
      .success,
    false,
  );
});

test("service conflict review requires valid IDs, explicit confirmation, revision, and reason", () => {
  assert.equal(
    serviceReviewParamsSchema.safeParse({
      vehicleId: "64b000000000000000000201",
      serviceId: "64b000000000000000000202",
    }).success,
    true,
  );
  assert.equal(
    serviceReviewParamsSchema.safeParse({
      vehicleId: "invalid",
      serviceId: "64b000000000000000000202",
    }).success,
    false,
  );
  const valid = {
    expectedVehicleRevision: 3,
    confirmReviewed: true,
    reason: "Verified service paperwork",
  };
  assert.equal(serviceReviewSchema.safeParse(valid).success, true);
  assert.equal(
    serviceReviewSchema.safeParse({ ...valid, confirmReviewed: false }).success,
    false,
  );
  assert.equal(
    serviceReviewSchema.safeParse({ ...valid, reason: "  " }).success,
    false,
  );
  assert.equal(
    serviceReviewSchema.safeParse({ ...valid, expectedVehicleRevision: undefined }).success,
    false,
  );
});
