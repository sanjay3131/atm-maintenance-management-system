import assert from "node:assert/strict";
import test from "node:test";
import {
  getLatestOilService,
  getServiceStatus,
  isFutureAsiaKolkataDate,
  normalizeRegistrationNumber,
  requireWholeKilometres,
  toAsiaKolkataDateKey,
} from "../src/modules/vehicles/vehicle.utils.js";

test("registration normalization keeps uppercase display and canonical identity", () => {
  assert.deepEqual(normalizeRegistrationNumber(" tn 45-ab 1234 "), {
    display: "TN 45-AB 1234",
    normalized: "TN45AB1234",
  });
  assert.throws(() => normalizeRegistrationNumber("TN/45/AB"), /only letters/);
});

test("odometer values must be non-negative safe integers", () => {
  assert.equal(requireWholeKilometres(0), 0);
  assert.equal(requireWholeKilometres(3000), 3000);
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => requireWholeKilometres(value));
  }
});

test("business dates use Asia/Kolkata calendar boundaries", () => {
  assert.equal(
    toAsiaKolkataDateKey(new Date("2026-01-01T20:00:00.000Z")),
    "2026-01-02",
  );
});

test("service date validation accepts today during early morning IST and rejects tomorrow", () => {
  const earlyMorningIst = new Date("2026-01-01T19:00:00.000Z");
  assert.equal(toAsiaKolkataDateKey(earlyMorningIst), "2026-01-02");
  assert.equal(isFutureAsiaKolkataDate("2026-01-02", earlyMorningIst), false);
  assert.equal(isFutureAsiaKolkataDate("2026-01-03", earlyMorningIst), true);
});

test("latest oil service ordering is deterministic and ignores other types", () => {
  const services = [
    {
      _id: "a",
      serviceType: "OIL_CHANGE",
      serviceOdometerKm: 5000,
      serviceDate: "2025-01-01",
      createdAt: "2025-01-01",
    },
    {
      _id: "b",
      serviceType: "OIL_CHANGE",
      serviceOdometerKm: 5000,
      serviceDate: "2025-01-01",
      createdAt: "2025-01-02",
    },
    {
      _id: "c",
      serviceType: "GENERAL_SERVICE",
      serviceOdometerKm: 9000,
      serviceDate: "2025-01-03",
      createdAt: "2025-01-03",
    },
  ];
  assert.equal(getLatestOilService(services)._id, "b");
});

test("due status separates upcoming, due, overdue and unconfigured policy", () => {
  const input = { baselineOdometerKm: 1000, intervalKm: 3000 };
  assert.deepEqual(getServiceStatus({ ...input, currentOdometerKm: 3999 }), {
    status: "UPCOMING",
    nextServiceOdometerKm: 4000,
  });
  assert.equal(
    getServiceStatus({ ...input, currentOdometerKm: 4000 }).status,
    "DUE",
  );
  assert.equal(
    getServiceStatus({ ...input, currentOdometerKm: 4001 }).status,
    "OVERDUE",
  );
  assert.equal(
    getServiceStatus({ ...input, intervalKm: null, currentOdometerKm: 1000 })
      .status,
    "POLICY_NOT_CONFIGURED",
  );
});
