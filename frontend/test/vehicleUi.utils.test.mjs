import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  findReminderForVehicle,
  getOdometerCorrectionSuccessMessage,
  getEmployeeDefaultVehicleId,
  getPrefilledStartingOdometer,
  getStartingOdometerForVehicleSelection,
  normalizeVehicleReference,
  parseStartingOdometer,
  resolveVehicleEditDraft,
} from "../src/features/vehicles/vehicle-ui.utils.ts";

const vehicleId = "64b000000000000000000001";

test("reminder lookup matches a plain vehicle ID", () => {
  const reminder = { _id: "r1", vehicleId, deliveryStatus: "PENDING" };
  assert.equal(findReminderForVehicle([reminder], vehicleId), reminder);
});

test("reminder lookup matches a populated vehicle reference", () => {
  const reminder = { _id: "r1", vehicleId: { _id: vehicleId }, deliveryStatus: "PENDING" };
  assert.equal(findReminderForVehicle([reminder], vehicleId), reminder);
});

test("malformed or missing vehicle references do not match", () => {
  assert.equal(normalizeVehicleReference(null), null);
  assert.equal(normalizeVehicleReference({ registrationNumber: "TN45AB1234" }), null);
  assert.equal(findReminderForVehicle([], vehicleId), undefined);
});

test("vehicle edit drafts survive refetches but reset when the vehicle changes", () => {
  const vehicle = { _id: vehicleId, registrationNumber: "TN45AB1234", make: "Honda", model: "Shine", notes: "server" };
  const draft = { ...vehicle, vehicleId: vehicle._id, notes: "unsaved" };
  assert.equal(resolveVehicleEditDraft(vehicle, draft), draft);
  const nextVehicle = { ...vehicle, _id: "64b000000000000000000002", registrationNumber: "TN46CD1234" };
  assert.deepEqual(resolveVehicleEditDraft(nextVehicle, draft), {
    vehicleId: nextVehicle._id,
    registrationNumber: nextVehicle.registrationNumber,
    make: nextVehicle.make,
    model: nextVehicle.model,
    notes: "server",
  });
});

test("employee default bike is primary when eligible and KM is prefilled from current odometer", () => {
  const available = { _id: "bike-a", currentOdometerKm: 10015, primaryAssignedToMe: false };
  const primary = { _id: "bike-b", currentOdometerKm: 12000, primaryAssignedToMe: true };
  assert.equal(getEmployeeDefaultVehicleId([available, primary]), "bike-b");
  assert.equal(getEmployeeDefaultVehicleId([available]), "");
  assert.equal(getPrefilledStartingOdometer(primary), "12000");
  assert.equal(getPrefilledStartingOdometer(undefined), "");
  const vehicles = [
    { ...available, usageState: "AVAILABLE" },
    { ...primary, usageState: "AVAILABLE" },
  ];
  assert.equal(getStartingOdometerForVehicleSelection("bike-a", vehicles), "10015");
  assert.equal(getStartingOdometerForVehicleSelection("bike-b", vehicles), "12000");
  assert.equal(getStartingOdometerForVehicleSelection("", vehicles), "");
});

test("starting odometer accepts valid whole readings and rejects invalid values", () => {
  assert.equal(parseStartingOdometer("18000", 18000), 18000);
  const prefilled = getPrefilledStartingOdometer({
    _id: "bike-prefilled",
    currentOdometerKm: 18000,
  });
  assert.equal(parseStartingOdometer(prefilled, 18000), 18000);
  assert.equal(parseStartingOdometer("18000", 18000), 18000);
  assert.equal(parseStartingOdometer("18001", 18000), 18001);
  for (const invalid of ["17999", "18000.1", "-1", "", "invalid", "1e4"]) {
    assert.equal(parseStartingOdometer(invalid, 18000), null);
  }
});

test("employee mileage input submits its controlled prefill without a fallback-only value", async () => {
  const page = await readFile(
    new URL("../src/pages/employee/EmployeeMileagePage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /value=\{startingOdometerKm\}/);
  assert.match(page, /getStartingOdometerForVehicleSelection\(/);
  assert.match(page, /parseStartingOdometer\(\s*startingOdometerKm/);
  assert.match(page, /"Reopen today's record"/);
  assert.match(page, /\["CLOSED", "REOPENED"\]/);
});

test("legacy mileage start helper uses daily record creation instead of the retired endpoint", async () => {
  const service = await readFile(
    new URL("../src/services/vehicle.service.ts", import.meta.url),
    "utf8",
  );
  const legacyStart = service.slice(
    service.indexOf("export const startVehicleSession"),
    service.indexOf("export const completeVehicleSession"),
  );
  assert.match(legacyStart, /startDailyMileage\(\{/);
  assert.doesNotMatch(legacyStart, /\/vehicles\/employee\/usage\/start/);
});

test("historical correction success messaging reflects remaining review conflicts", () => {
  assert.equal(
    getOdometerCorrectionSuccessMessage({ historical: false, timelineReviewRequired: false }),
    "Odometer correction recorded.",
  );
  assert.equal(
    getOdometerCorrectionSuccessMessage({ historical: true, timelineReviewRequired: true }),
    "Historical reading corrected. Conflicting records still require review; reminders remain paused.",
  );
  assert.equal(
    getOdometerCorrectionSuccessMessage({ historical: true, timelineReviewRequired: false }),
    "Historical reading corrected. No timeline review conflicts remain.",
  );
});

test("admin service review UI sends explicit confirmation, reason, and current revision", async () => {
  const [service, page] = await Promise.all([
    readFile(new URL("../src/services/vehicle.service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/admin/VehicleDetailsPage.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(
    service,
    /\/vehicles\/admin\/\$\{vehicleId\}\/services\/\$\{serviceId\}\/review/,
  );
  assert.match(service, /confirmReviewed:\s*true/);
  assert.match(page, /Confirm reviewed record/);
  assert.match(page, /expectedVehicleRevision:\s*vehicle\.revision/);
  assert.match(page, /result\.timelineReviewRequired/);
});