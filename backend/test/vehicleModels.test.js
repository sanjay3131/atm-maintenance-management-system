import assert from "node:assert/strict";
import test from "node:test";

const models = await Promise.all([
  import("../src/modules/vehicles/vehicle.model.js"),
  import("../src/modules/vehicles/vehicleAssignment.model.js"),
  import("../src/modules/vehicles/vehicleUsageSession.model.js"),
  import("../src/modules/vehicles/vehicleService.model.js"),
  import("../src/modules/vehicles/vehicleServicePolicy.model.js"),
  import("../src/modules/vehicles/vehicleServiceReminder.model.js"),
  import("../src/modules/vehicles/vehicleOdometerCorrection.model.js"),
]);

test("vehicle feature uses exactly seven domain models", () => {
  assert.deepEqual(
    models.map(({ default: Model }) => Model.modelName).sort(),
    [
      "Vehicle",
      "VehicleAssignment",
      "VehicleOdometerCorrection",
      "VehicleService",
      "VehicleServicePolicy",
      "VehicleServiceReminder",
      "VehicleUsageSession",
    ].sort(),
  );
});

test("assignment and usage schemas declare both active unique constraints", () => {
  for (const indexModel of [models[1].default, models[2].default]) {
    const activeIndexes = indexModel.schema
      .indexes()
      .filter(
        ([, options]) => options.unique && options.partialFilterExpression,
      );
    assert.equal(activeIndexes.length, 2);
  }
});

test("service policy and reminder schemas declare concurrency indexes", () => {
  assert.ok(
    models[4].default.schema
      .indexes()
      .some(
        ([, options]) => options.name === "serviceType_active_policy_unique",
      ),
  );
  assert.ok(
    models[5].default.schema
      .indexes()
      .some(
        ([, options]) =>
          options.name === "vehicle_service_active_reminder_unique",
      ),
  );
});
