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
  import("../src/modules/vehicles/vehicleDailyMileage.model.js"),
]);

test("vehicle feature preserves existing models and adds daily mileage", () => {
  assert.deepEqual(
    models.map(({ default: Model }) => Model.modelName).sort(),
    [
      "Vehicle",
      "VehicleAssignment",
      "VehicleOdometerCorrection",
      "VehicleService",
      "VehicleServicePolicy",
      "VehicleServiceReminder",
      "VehicleDailyMileage",
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

test("daily mileage schema enforces vehicle/date and active usage uniqueness", () => {
  const indexes = models[7].default.schema.indexes();
  assert.ok(
    indexes.some(
      ([, options]) =>
        options.unique && options.name === "vehicle_daily_mileage_date_unique",
    ),
  );
  assert.ok(
    indexes.some(
      ([, options]) =>
        options.unique && options.name === "vehicle_open_daily_mileage_unique",
    ),
  );
  assert.ok(
    indexes.some(
      ([, options]) =>
        options.unique && options.name === "employee_open_daily_mileage_unique",
    ),
  );
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
