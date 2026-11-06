import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  findReminderForVehicle,
  getOdometerCorrectionSuccessMessage,
  getEmployeeDefaultVehicleId,
  getPrefilledStartingOdometer,
  normalizeVehicleReference,
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