import assert from "node:assert/strict";
import mongoose from "mongoose";
import test from "node:test";
import Employee from "../src/modules/employees/employee.model.js";
import Vehicle from "../src/modules/vehicles/vehicle.model.js";
import VehicleDailyMileage from "../src/modules/vehicles/vehicleDailyMileage.model.js";
import VehicleUsageSession from "../src/modules/vehicles/vehicleUsageSession.model.js";
import {
  addDailyMileageReading,
  closeDailyMileage,
  handoverDailyMileage,
  joinDailyMileage,
  recoverDailyMileageRollover,
  reopenDailyMileage,
  startDailyMileage,
} from "../src/modules/vehicles/vehicleDailyMileage.service.js";
import { toAsiaKolkataDateKey } from "../src/modules/vehicles/vehicle.utils.js";

const vehicleId = "64b000000000000000000001";
const dailyMileageId = "64b000000000000000000010";
const employeeAId = "64b000000000000000000002";
const employeeBId = "64b000000000000000000012";
const userAId = "64b000000000000000000003";
const userBId = "64b000000000000000000013";

const query = (value) => ({
  populate() {
    return this;
  },
  select() {
    return this;
  },
  lean() {
    return this;
  },
  sort() {
    return this;
  },
  limit() {
    return this;
  },
  session() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const withOverrides = async (overrides, run) => {
  const originals = overrides.map(([target, key]) => [
    target,
    key,
    target[key],
  ]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    return await run();
  } finally {
    for (const [target, key, value] of originals.reverse()) target[key] = value;
  }
};

const transactionStub = () => ({
  async withTransaction(operation) {
    return operation(this);
  },
  async endSession() {},
});

const employee = (id, userId, firstName) => ({
  _id: id,
  employeeCode: id === employeeAId ? "EMP-001" : "EMP-002",
  status: "active",
  userId: {
    _id: userId,
    firstName,
    lastName: "Kumar",
    userType: "employee",
    status: "active",
  },
});

test("daily mileage supports sequential shared use and reconciles handovers", async () => {
  const employees = new Map([
    [userAId, employee(employeeAId, userAId, "Ravi")],
    [userBId, employee(employeeBId, userBId, "Kumar")],
  ]);
  const vehicle = {
    _id: vehicleId,
    registrationNumber: "TN45AB1234",
    status: "ACTIVE",
    currentOdometerKm: 100,
    serviceStateRevision: 0,
  };
  const state = { record: null };
  const overrides = [
    [mongoose, "startSession", async () => transactionStub()],
    [Employee, "findOne", (filter) => query(employees.get(String(filter.userId)))],
    [Employee, "updateOne", async () => ({ matchedCount: 1 })],
    [Vehicle, "findById", () => query(vehicle)],
    [Vehicle, "updateOne", async (_filter, update) => {
      Object.assign(vehicle, update.$set);
      vehicle.serviceStateRevision += update.$inc.serviceStateRevision;
      return { matchedCount: 1 };
    }],
    [VehicleUsageSession, "exists", () => query(false)],
    [VehicleDailyMileage, "exists", () => query(false)],
    [VehicleDailyMileage, "find", () => query([])],
    [VehicleDailyMileage, "findOne", () => query(state.record)],
    [VehicleDailyMileage, "findById", () => query(state.record)],
    [VehicleDailyMileage, "create", async ([record]) => {
      state.record = {
        ...record,
        _id: dailyMileageId,
        status: "OPEN",
        revision: 0,
        toObject() {
          return { ...this };
        },
      };
      return [state.record];
    }],
    [VehicleDailyMileage, "updateOne", async (_filter, update) => {
      Object.assign(state.record, update.$set);
      state.record.revision += update.$inc.revision;
      return { matchedCount: 1 };
    }],
  ];

  await withOverrides(overrides, async () => {
    const started = await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 100,
      expectedVehicleRevision: 0,
    });
    assert.equal(started.status, "OPEN");
    assert.equal(state.record.segments.length, 1);
    assert.deepEqual(
      state.record.segments[0].odometerReadings.map((reading) => ({
        odometerKm: reading.odometerKm,
        distanceKm: reading.distanceKm,
        source: reading.source,
      })),
      [{ odometerKm: 100, distanceKm: 0, source: "BASELINE" }],
    );

    await addDailyMileageReading({
      dailyMileageId,
      user: { _id: userAId },
      requestId: "before-handover-110",
      odometerKm: 110,
      expectedVehicleRevision: 1,
      expectedDailyRevision: 0,
    });
    await addDailyMileageReading({
      dailyMileageId,
      user: { _id: userAId },
      requestId: "before-handover-125",
      odometerKm: 125,
      expectedVehicleRevision: 2,
      expectedDailyRevision: 1,
    });
    await handoverDailyMileage({
      dailyMileageId,
      user: { _id: userAId },
      endingOdometerKm: 130,
      expectedVehicleRevision: 3,
      expectedDailyRevision: 2,
    });
    assert.equal(state.record.segments[0].distanceKm, 30);
    assert.deepEqual(
      state.record.segments[0].odometerReadings.map((reading) => [
        reading.odometerKm,
        reading.distanceKm,
        reading.source,
      ]),
      [
        [100, 0, "BASELINE"],
        [110, 10, "EMPLOYEE_SUBMISSION"],
        [125, 15, "EMPLOYEE_SUBMISSION"],
        [130, 5, "HANDOVER"],
      ],
    );
    assert.equal(state.record.activeEmployeeId, null);
    await assert.rejects(
      addDailyMileageReading({
        dailyMileageId,
        user: { _id: userAId },
        requestId: "after-handover",
        odometerKm: 131,
        expectedVehicleRevision: 4,
        expectedDailyRevision: 3,
      }),
      { code: "PERMISSION_DENIED" },
    );

    await joinDailyMileage({
      dailyMileageId,
      user: { _id: userBId },
      expectedVehicleRevision: 4,
      expectedDailyRevision: 3,
    });
    assert.equal(state.record.segments[1].startOdometerKm, 130);
    assert.equal(state.record.segments[1].odometerReadings.length, 0);

    const closed = await closeDailyMileage({
      dailyMileageId,
      user: { _id: userBId },
      endingOdometerKm: 150,
      expectedVehicleRevision: 5,
      expectedDailyRevision: 4,
    });
    assert.equal(closed.status, "CLOSED");
    assert.equal(closed.dailyDistanceKm, 50);
    assert.deepEqual(
      closed.segments.map((segment) => segment.distanceKm),
      [30, 20],
    );
    assert.equal(
      closed.segments.reduce((total, segment) => total + segment.distanceKm, 0),
      closed.dailyDistanceKm,
    );
    assert.deepEqual(
      closed.segments[1].odometerReadings.map((reading) => [
        reading.odometerKm,
        reading.distanceKm,
        reading.source,
        reading.employeeNameSnapshot,
      ]),
      [[150, 20, "CLOSE", "Kumar Kumar"]],
    );
    assert.equal(
      closed.segments.flatMap((segment) => segment.odometerReadings).at(-1)
        .odometerKm,
      closed.latestOdometerKm,
    );
    assert.equal(vehicle.currentOdometerKm, 150);
    assert.equal(vehicle.serviceStateRevision, 6);
  });
});

test("unchanged handover and close reuse the accepted reading without duplicates", async () => {
  const { state, overrides } = await createDailyReadingHarness({
    includeEmployeeB: true,
  });
  await withOverrides(overrides, async () => {
    const started = await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 18000,
      expectedVehicleRevision: 0,
    });
    const handedOver = await handoverDailyMileage({
      dailyMileageId,
      user: { _id: userAId },
      endingOdometerKm: 18000,
      expectedVehicleRevision: 1,
      expectedDailyRevision: 0,
    });
    assert.equal(handedOver.segments[0].odometerReadings.length, 1);
    assert.equal(handedOver.dailyDistanceKm, 0);

    await assert.rejects(
      handoverDailyMileage({
        dailyMileageId,
        user: { _id: userAId },
        endingOdometerKm: 18000,
        expectedVehicleRevision: 1,
        expectedDailyRevision: 0,
      }),
    );
    assert.equal(state.record.segments[0].odometerReadings.length, 1);

    await joinDailyMileage({
      dailyMileageId,
      user: { _id: userBId },
      expectedVehicleRevision: 2,
      expectedDailyRevision: 1,
    });
    const closed = await closeDailyMileage({
      dailyMileageId,
      user: { _id: userBId },
      endingOdometerKm: 18000,
      expectedVehicleRevision: 3,
      expectedDailyRevision: 2,
    });
    assert.equal(closed.segments[1].odometerReadings.length, 0);
    assert.equal(closed.dailyDistanceKm, 0);

    await assert.rejects(
      closeDailyMileage({
        dailyMileageId,
        user: { _id: userBId },
        endingOdometerKm: 18000,
        expectedVehicleRevision: 3,
        expectedDailyRevision: 2,
      }),
    );
    assert.equal(state.record.segments[0].odometerReadings.length, 1);
    assert.equal(state.record.segments[1].odometerReadings.length, 0);
    assert.equal(state.record.revision, 3);
    assert.equal(started.segments[0].odometerReadings.length, 1);
  });
});

test("joining preserves a partially tracked legacy segment without fabricating a boundary reading", async () => {
  const { vehicle, state, overrides } = await createDailyReadingHarness({
    includeEmployeeB: true,
  });
  await withOverrides(overrides, async () => {
    await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 18000,
      expectedVehicleRevision: 0,
    });
    await addDailyMileageReading({
      dailyMileageId,
      user: { _id: userAId },
      requestId: "legacy-partial-history-reading",
      odometerKm: 18025,
      expectedVehicleRevision: 1,
      expectedDailyRevision: 0,
    });

    const endedAt = new Date();
    const firstSegment = state.record.segments[0];
    state.record.segments[0] = {
      ...firstSegment,
      endOdometerKm: 18030,
      distanceKm: 30,
      odometerReadingsComplete: false,
      endedAt,
      endedBy: userAId,
    };
    state.record.latestOdometerKm = 18030;
    state.record.activeEmployeeId = null;
    state.record.dailyDistanceKm = 30;
    state.record.revision += 1;
    state.record.auditHistory.push({
      action: "HANDOVER",
      employeeId: employeeAId,
      odometerKm: 18030,
      occurredAt: endedAt,
    });
    vehicle.currentOdometerKm = 18030;
    vehicle.serviceStateRevision += 1;

    await joinDailyMileage({
      dailyMileageId,
      user: { _id: userBId },
      expectedVehicleRevision: 3,
      expectedDailyRevision: 2,
    });

    assert.deepEqual(
      state.record.segments[0].odometerReadings.map((reading) => [
        reading.odometerKm,
        reading.distanceKm,
        reading.source,
      ]),
      [
        [18000, 0, "BASELINE"],
        [18025, 25, "EMPLOYEE_SUBMISSION"],
      ],
    );
    assert.equal(state.record.segments[0].distanceKm, 30);
    assert.equal(state.record.segments[0].odometerReadingsComplete, false);
    assert.equal(state.record.segments[1].odometerReadings.length, 0);
  });
});

const createDailyReadingHarness = async ({
  employeeStatus = "active",
  recordStatus = "OPEN",
  includeEmployeeB = false,
} = {}) => {
  const activeEmployee = employee(employeeAId, userAId, "Ravi");
  activeEmployee.status = employeeStatus;
  const employeesByUserId = new Map([
    [userAId, activeEmployee],
    ...(includeEmployeeB
      ? [[userBId, employee(employeeBId, userBId, "Kumar")]]
      : []),
  ]);
  const vehicle = {
    _id: vehicleId,
    registrationNumber: "TN45AB1234",
    status: "ACTIVE",
    currentOdometerKm: 18000,
    serviceStateRevision: 0,
  };
  const state = { record: null };
  const overrides = [
    [mongoose, "startSession", async () => transactionStub()],
    [Employee, "findOne", (filter) => query(employeesByUserId.get(String(filter.userId)))],
    [Employee, "findById", (id) =>
      query(
        [...employeesByUserId.values()].find(
          (item) => String(item._id) === String(id),
        ),
      )],
    [Employee, "updateOne", async (filter) => ({
      matchedCount:
        employeesByUserId.get(userAId) &&
        [...employeesByUserId.values()].find(
          (item) => String(item._id) === String(filter._id),
        )?.status === "active"
          ? 1
          : 0,
    })],
    [Vehicle, "findById", () => query(vehicle)],
    [Vehicle, "updateOne", async (filter, update) => {
      if (filter.serviceStateRevision !== vehicle.serviceStateRevision) {
        return { matchedCount: 0 };
      }
      Object.assign(vehicle, update.$set);
      vehicle.serviceStateRevision += update.$inc.serviceStateRevision;
      return { matchedCount: 1 };
    }],
    [VehicleUsageSession, "exists", () => query(false)],
    [VehicleDailyMileage, "exists", () => query(false)],
    [VehicleDailyMileage, "find", () => query([])],
    [VehicleDailyMileage, "findOne", () => query(state.record)],
    [VehicleDailyMileage, "findById", () => query(state.record)],
    [VehicleDailyMileage, "create", async ([record]) => {
      state.record = {
        ...record,
        _id: dailyMileageId,
        status: recordStatus,
        revision: 0,
        toObject() {
          return { ...this };
        },
      };
      return [state.record];
    }],
    [VehicleDailyMileage, "updateOne", async (filter, update) => {
      if (
        filter.revision !== state.record.revision ||
        filter.status !== state.record.status
      ) {
        return { matchedCount: 0 };
      }
      Object.assign(state.record, update.$set);
      state.record.revision += update.$inc.revision;
      return { matchedCount: 1 };
    }],
  ];
  return { activeEmployee, employeesByUserId, vehicle, state, overrides };
};

const makeLegacyActiveSegment = (state, vehicle, partialReadings = []) => {
  state.record.businessDate = "2026-03-19";
  state.record.latestOdometerKm = 18020;
  state.record.dailyDistanceKm = 20;
  state.record.revision = 1;
  state.record.segments[0] = {
    ...state.record.segments[0],
    distanceKm: 20,
    endOdometerKm: null,
    odometerReadingsComplete: false,
    odometerReadings: partialReadings,
  };
  vehicle.currentOdometerKm = 18020;
  vehicle.serviceStateRevision = 2;
};

test("legacy daily mileage boundaries preserve historical distance without fabricated readings", async () => {
  for (const boundary of ["reading", "handover", "close", "rollover"]) {
    const { vehicle, state, overrides } = await createDailyReadingHarness();
    await withOverrides(overrides, async () => {
      await startDailyMileage({
        user: { _id: userAId },
        vehicleId,
        startingOdometerKm: 18000,
        expectedVehicleRevision: 0,
        now: new Date("2026-03-19T17:00:00.000Z"),
      });
      makeLegacyActiveSegment(state, vehicle);

      if (boundary === "reading") {
        await addDailyMileageReading({
          dailyMileageId,
          user: { _id: userAId },
          requestId: "legacy-incremental-reading",
          odometerKm: 18030,
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: new Date("2026-03-19T17:10:00.000Z"),
        });
        assert.equal(state.record.segments[0].distanceKm, 30);
        assert.deepEqual(
          state.record.segments[0].odometerReadings.map((reading) => [
            reading.odometerKm,
            reading.distanceKm,
          ]),
          [[18030, 10]],
        );
        assert.equal(state.record.segments[0].odometerReadingsComplete, false);
      } else if (boundary === "handover") {
        await handoverDailyMileage({
          dailyMileageId,
          user: { _id: userAId },
          endingOdometerKm: 18030,
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: new Date("2026-03-19T17:10:00.000Z"),
        });
        assert.equal(state.record.segments[0].distanceKm, 30);
        assert.deepEqual(
          state.record.segments[0].odometerReadings.map((reading) => [
            reading.odometerKm,
            reading.distanceKm,
            reading.source,
          ]),
          [[18030, 10, "HANDOVER"]],
        );
      } else if (boundary === "close") {
        await closeDailyMileage({
          dailyMileageId,
          user: { _id: userAId },
          endingOdometerKm: 18030,
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          now: new Date("2026-03-19T17:10:00.000Z"),
        });
        assert.equal(state.record.segments[0].distanceKm, 30);
        assert.deepEqual(
          state.record.segments[0].odometerReadings.map((reading) => [
            reading.odometerKm,
            reading.distanceKm,
            reading.source,
          ]),
          [[18030, 10, "CLOSE"]],
        );
      } else {
        state.record.status = "ROLLOVER_PENDING";
        const recovered = await recoverDailyMileageRollover({
          dailyMileageId,
          recoveryOdometerKm: 18030,
          expectedVehicleRevision: 2,
          expectedDailyRevision: 1,
          user: { _id: "64b000000000000000000099", userType: "admin" },
          now: new Date("2026-03-19T18:31:00.000Z"),
        });
        assert.equal(recovered.previousRecord.segments[0].distanceKm, 30);
        assert.deepEqual(
          recovered.previousRecord.segments[0].odometerReadings.map(
            (reading) => [
              reading.odometerKm,
              reading.distanceKm,
              reading.source,
              String(reading.employeeId),
            ],
          ),
          [[18030, 10, "ROLLOVER_RECOVERY", employeeAId]],
        );
        assert.equal(
          recovered.previousRecord.segments[0].odometerReadingsComplete,
          false,
        );
        assert.equal(
          recovered.dailyRecord.segments[0].odometerReadings[0].odometerKm,
          18030,
        );
      }

      const currentRecord =
        boundary === "rollover" ? state.record : state.record;
      assert.equal(currentRecord.latestOdometerKm, 18030);
      assert.equal(vehicle.currentOdometerKm, 18030);
    });
  }
});

test("partially tracked daily mileage remains explicitly incomplete", async () => {
  const { vehicle, state, overrides } = await createDailyReadingHarness();
  await withOverrides(overrides, async () => {
    await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 18000,
      expectedVehicleRevision: 0,
      now: new Date("2026-03-19T17:00:00.000Z"),
    });
    const partialReading = {
      odometerKm: 18005,
      distanceKm: 5,
      occurredAt: new Date("2026-03-19T17:05:00.000Z"),
      employeeId: employeeAId,
      employeeNameSnapshot: "Ravi Kumar",
      employeeCodeSnapshot: "EMP-001",
      source: "EMPLOYEE_SUBMISSION",
    };
    makeLegacyActiveSegment(state, vehicle, [partialReading]);
    await addDailyMileageReading({
      dailyMileageId,
      user: { _id: userAId },
      requestId: "partial-history-new-reading",
      odometerKm: 18030,
      expectedVehicleRevision: 2,
      expectedDailyRevision: 1,
      now: new Date("2026-03-19T17:30:00.000Z"),
    });

    assert.equal(state.record.segments[0].distanceKm, 30);
    assert.equal(state.record.segments[0].odometerReadingsComplete, false);
    assert.deepEqual(
      state.record.segments[0].odometerReadings.map((reading) => [
        reading.odometerKm,
        reading.distanceKm,
      ]),
      [
        [18005, 5],
        [18030, 10],
      ],
    );
    assert.equal(vehicle.currentOdometerKm, 18030);
    assert.equal(state.record.dailyDistanceKm, 30);
  });
});

test("rollover without an employee carries odometer into an unassigned record for later join", async () => {
  const { vehicle, state, overrides } = await createDailyReadingHarness({
    includeEmployeeB: true,
  });
  await withOverrides(overrides, async () => {
    await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 18000,
      expectedVehicleRevision: 0,
      now: new Date("2026-03-19T17:00:00.000Z"),
    });
    makeLegacyActiveSegment(state, vehicle);
    state.record.status = "ROLLOVER_PENDING";
    state.record.activeEmployeeId = null;
    state.record.segments[0] = {
      ...state.record.segments[0],
      endOdometerKm: 18020,
      endedAt: new Date("2026-03-19T17:30:00.000Z"),
      endedBy: userAId,
    };

    const recovered = await recoverDailyMileageRollover({
      dailyMileageId,
      recoveryOdometerKm: 18030,
      expectedVehicleRevision: 2,
      expectedDailyRevision: 1,
      user: { _id: "64b000000000000000000099", userType: "admin" },
      now: new Date("2026-03-19T18:31:00.000Z"),
    });
    assert.equal(recovered.previousRecord.dailyDistanceKm, 30);
    assert.equal(recovered.previousRecord.segments[0].distanceKm, 20);
    assert.equal(recovered.dailyRecord.activeEmployeeId, null);
    assert.equal(recovered.dailyRecord.activeRecordLock, false);
    assert.deepEqual(recovered.dailyRecord.segments, []);
    assert.equal(vehicle.currentOdometerKm, 18030);

    const joined = await joinDailyMileage({
      dailyMileageId,
      user: { _id: userBId },
      expectedVehicleRevision: 3,
      expectedDailyRevision: 0,
      now: new Date("2026-03-19T18:32:00.000Z"),
    });
    assert.equal(joined.segments.length, 1);
    assert.equal(joined.segments[0].startOdometerKm, 18030);
    assert.equal(joined.segments[0].odometerReadingsComplete, true);
    assert.deepEqual(
      joined.segments[0].odometerReadings.map((reading) => [
        reading.odometerKm,
        reading.distanceKm,
        reading.source,
      ]),
      [[18030, 0, "BASELINE"]],
    );
    assert.equal(
      joined.segments[0].odometerReadings.filter(
        (reading) => reading.source === "BASELINE",
      ).length,
      1,
    );
  });
});

test("daily mileage stores successive employee readings and incremental distances", async () => {
  const { vehicle, state, overrides } = await createDailyReadingHarness();
  await withOverrides(overrides, async () => {
    const firstReadingAt = new Date("2026-03-19T17:10:00.000Z");
    const secondReadingAt = new Date("2026-03-19T17:20:00.000Z");
    await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 18000,
      expectedVehicleRevision: 0,
      now: new Date("2026-03-19T17:00:00.000Z"),
    });

    await addDailyMileageReading({
      dailyMileageId,
      user: { _id: userAId },
      requestId: "reading-18025",
      odometerKm: 18025,
      expectedVehicleRevision: 1,
      expectedDailyRevision: 0,
      now: firstReadingAt,
    });
    const result = await addDailyMileageReading({
      dailyMileageId,
      user: { _id: userAId },
      requestId: "reading-18040",
      odometerKm: 18040,
      expectedVehicleRevision: 2,
      expectedDailyRevision: 1,
      now: secondReadingAt,
    });

    assert.deepEqual(
      state.record.segments[0].odometerReadings.map((reading) => [
        reading.odometerKm,
        reading.distanceKm,
        reading.source,
        String(reading.employeeId),
      ]),
      [
        [18000, 0, "BASELINE", employeeAId],
        [18025, 25, "EMPLOYEE_SUBMISSION", employeeAId],
        [18040, 15, "EMPLOYEE_SUBMISSION", employeeAId],
      ],
    );
    assert.equal(state.record.segments[0].distanceKm, 40);
    assert.equal(result.dailyDistanceKm, 40);
    assert.equal(result.latestOdometerKm, 18040);
    assert.equal(vehicle.currentOdometerKm, 18040);
    assert.deepEqual(
      state.record.segments[0].odometerReadings.slice(1).map((reading) => [
        reading.employeeNameSnapshot,
        reading.employeeCodeSnapshot,
        reading.occurredAt,
      ]),
      [
        ["Ravi Kumar", "EMP-001", firstReadingAt],
        ["Ravi Kumar", "EMP-001", secondReadingAt],
      ],
    );
    assert.deepEqual(
      state.record.auditHistory.map((entry) => entry.action),
      ["STARTED", "ODOMETER_READING_ADDED", "ODOMETER_READING_ADDED"],
    );
  });
});

test("daily mileage replays the original result for the same employee request ID", async () => {
  const { vehicle, state, overrides } = await createDailyReadingHarness();
  await withOverrides(overrides, async () => {
    await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 18000,
      expectedVehicleRevision: 0,
      now: new Date("2026-03-19T17:00:00.000Z"),
    });
    const submission = {
      dailyMileageId,
      user: { _id: userAId },
      requestId: "stable-reading-request",
      odometerKm: 18025,
      expectedVehicleRevision: 1,
      expectedDailyRevision: 0,
      now: new Date("2026-03-19T17:10:00.000Z"),
    };

    const originalResult = await addDailyMileageReading(submission);
    const retryResult = await addDailyMileageReading(submission);

    assert.deepEqual(retryResult, originalResult);
    assert.equal(state.record.revision, 1);
    assert.equal(state.record.segments[0].odometerReadings.length, 2);
    assert.equal(vehicle.currentOdometerKm, 18025);
    assert.equal(vehicle.serviceStateRevision, 2);

    await assert.rejects(
      addDailyMileageReading({ ...submission, odometerKm: 18026 }),
      { code: "IDEMPOTENCY_KEY_REUSED" },
    );
    assert.equal(state.record.revision, 1);
    assert.equal(state.record.segments[0].odometerReadings.length, 2);
  });
});

test("daily mileage rejects lower, duplicate, decimal, and invalid readings", async () => {
  const { state, overrides } = await createDailyReadingHarness();
  await withOverrides(overrides, async () => {
    await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 18000,
      expectedVehicleRevision: 0,
    });
    const submit = (odometerKm) =>
      addDailyMileageReading({
        dailyMileageId,
        user: { _id: userAId },
        requestId: "rejected-reading",
        odometerKm,
        expectedVehicleRevision: 1,
        expectedDailyRevision: 0,
      });
    for (const invalidReading of [17999, 18000]) {
      await assert.rejects(submit(invalidReading), {
        code: "ODOMETER_CONFLICT",
      });
    }
    for (const invalidReading of [
      18000.5,
      -1,
      Number.MAX_SAFE_INTEGER + 1,
      "18001",
      "",
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      await assert.rejects(submit(invalidReading), RangeError);
    }
    assert.equal(state.record.revision, 0);
    assert.equal(state.record.segments[0].odometerReadings.length, 1);
  });
});

test("daily mileage rejects readings from inactive employees and rollover-pending records", async () => {
  const inactive = await createDailyReadingHarness();
  await withOverrides(inactive.overrides, async () => {
    await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 18000,
      expectedVehicleRevision: 0,
    });
    inactive.activeEmployee.status = "inactive";
    await assert.rejects(
      addDailyMileageReading({
        dailyMileageId,
        user: { _id: userAId },
        requestId: "inactive-employee-reading",
        odometerKm: 18001,
        expectedVehicleRevision: 1,
        expectedDailyRevision: 0,
      }),
      { code: "PERMISSION_DENIED" },
    );
  });

  const rollover = await createDailyReadingHarness();
  await withOverrides(rollover.overrides, async () => {
    await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 18000,
      expectedVehicleRevision: 0,
    });
    rollover.state.record.status = "ROLLOVER_PENDING";
    await assert.rejects(
      addDailyMileageReading({
        dailyMileageId,
        user: { _id: userAId },
        requestId: "rollover-reading",
        odometerKm: 18001,
        expectedVehicleRevision: 1,
        expectedDailyRevision: 0,
      }),
      { code: "ROLLOVER_RECOVERY_REQUIRED" },
    );
  });
});

test("concurrent daily readings are fenced by vehicle and record revisions", async () => {
  const { state, overrides } = await createDailyReadingHarness();
  await withOverrides(overrides, async () => {
    await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 18000,
      expectedVehicleRevision: 0,
    });
    const submit = (odometerKm) =>
      addDailyMileageReading({
        dailyMileageId,
        user: { _id: userAId },
        requestId: `concurrent-${odometerKm}`,
        odometerKm,
        expectedVehicleRevision: 1,
        expectedDailyRevision: 0,
      });
    const results = await Promise.allSettled([submit(18010), submit(18020)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(
      ["ODOMETER_CONFLICT", "REVISION_CONFLICT"].includes(rejected.reason.code),
    );
    assert.equal(state.record.revision, 1);
    assert.equal(state.record.segments[0].odometerReadings.length, 2);
  });
});

test("daily mileage requires a non-empty bounded request ID", async () => {
  const { state, overrides } = await createDailyReadingHarness();
  await withOverrides(overrides, async () => {
    await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 18000,
      expectedVehicleRevision: 0,
    });
    for (const requestId of [undefined, "", "  ", "x".repeat(129)]) {
      await assert.rejects(
        addDailyMileageReading({
          dailyMileageId,
          user: { _id: userAId },
          requestId,
          odometerKm: 18001,
          expectedVehicleRevision: 1,
          expectedDailyRevision: 0,
        }),
        { code: "VALIDATION_ERROR" },
      );
    }
    assert.equal(state.record.segments[0].odometerReadings.length, 1);
  });
});

test("daily mileage reading is restricted to the active employee segment owner", async () => {
  const { state, overrides } = await createDailyReadingHarness();
  await withOverrides(overrides, async () => {
    await startDailyMileage({
      user: { _id: userAId },
      vehicleId,
      startingOdometerKm: 18000,
      expectedVehicleRevision: 0,
    });
    state.record.activeEmployeeId = employeeBId;
    await assert.rejects(
      addDailyMileageReading({
        dailyMileageId,
        user: { _id: userAId },
        requestId: "wrong-employee-reading",
        odometerKm: 18001,
        expectedVehicleRevision: 1,
        expectedDailyRevision: 0,
      }),
      { code: "PERMISSION_DENIED" },
    );
    assert.equal(state.record.segments[0].odometerReadings.length, 1);
  });
});

test("same-day reopen preserves closure history and resumes at its verified reading", async () => {
  const now = new Date("2026-03-19T17:00:00.000Z");
  const employeeA = employee(employeeAId, userAId, "Ravi");
  const vehicle = {
    _id: vehicleId,
    status: "ACTIVE",
    currentOdometerKm: 150,
    serviceStateRevision: 2,
  };
  const record = {
    _id: dailyMileageId,
    vehicleId,
    businessDate: toAsiaKolkataDateKey(now),
    startOdometerKm: 100,
    endOdometerKm: 150,
    dailyDistanceKm: 50,
    latestOdometerKm: 150,
    status: "CLOSED",
    activeRecordLock: false,
    activeEmployeeId: null,
    revision: 2,
    segments: [{
      employeeId: employeeAId,
      employeeNameSnapshot: "Ravi Kumar",
      employeeCodeSnapshot: "EMP-001",
      startOdometerKm: 100,
      endOdometerKm: 150,
      distanceKm: 50,
      startedAt: new Date("2026-03-19T16:00:00.000Z"),
      endedAt: new Date("2026-03-19T16:30:00.000Z"),
    }],
    auditHistory: [
      { action: "STARTED", employeeId: employeeAId },
      {
        action: "CLOSED",
        employeeId: employeeAId,
        odometerKm: 150,
        occurredAt: new Date("2026-03-19T16:30:00.000Z"),
      },
    ],
    toObject() {
      return { ...this };
    },
  };
  const overrides = [
    [mongoose, "startSession", async () => transactionStub()],
    [Employee, "findOne", () => query(employeeA)],
    [Employee, "updateOne", async () => ({ matchedCount: 1 })],
    [Vehicle, "findById", () => query(vehicle)],
    [Vehicle, "updateOne", async (_filter, update) => {
      Object.assign(vehicle, update.$set);
      vehicle.serviceStateRevision += update.$inc.serviceStateRevision;
      return { matchedCount: 1 };
    }],
    [VehicleUsageSession, "exists", () => query(false)],
    [VehicleDailyMileage, "exists", () => query(false)],
    [VehicleDailyMileage, "find", () => query([])],
    [VehicleDailyMileage, "findById", () => query(record)],
    [VehicleDailyMileage, "updateOne", async (_filter, update) => {
      Object.assign(record, update.$set);
      record.revision += update.$inc.revision;
      return { matchedCount: 1 };
    }],
  ];

  await withOverrides(overrides, async () => {
    const reopened = await reopenDailyMileage({
      dailyMileageId,
      user: { _id: userAId },
      expectedVehicleRevision: 2,
      expectedDailyRevision: 2,
      now,
    });
    assert.equal(reopened.status, "OPEN");
    assert.equal(reopened.latestOdometerKm, 150);
    assert.equal(reopened.segments[0].endOdometerKm, 150);
    assert.equal(reopened.segments[1].startOdometerKm, 150);
    assert.equal(reopened.segments[0].odometerReadings, undefined);
    assert.deepEqual(reopened.segments[1].odometerReadings, []);
    assert.deepEqual(
      reopened.auditHistory.map((event) => event.action),
      ["STARTED", "CLOSED", "REOPENED"],
    );
    assert.equal(reopened.auditHistory[1].odometerKm, 150);
    assert.equal(reopened.auditHistory[1].employeeId, employeeAId);
    assert.equal(reopened.auditHistory[2].employeeNameSnapshot, "Ravi Kumar");
    assert.equal(reopened.segments[1].odometerReadings.length, 0);

    await addDailyMileageReading({
      dailyMileageId,
      user: { _id: userAId },
      requestId: "reading-after-reopen",
      odometerKm: 160,
      expectedVehicleRevision: 3,
      expectedDailyRevision: 3,
      now: new Date("2026-03-19T17:10:00.000Z"),
    });
    assert.equal(record.segments[1].odometerReadings.length, 1);
    assert.equal(record.segments[1].odometerReadings[0].distanceKm, 10);

    const closedAgain = await closeDailyMileage({
      dailyMileageId,
      user: { _id: userAId },
      endingOdometerKm: 170,
      expectedVehicleRevision: 4,
      expectedDailyRevision: 4,
      now: new Date("2026-03-19T17:30:00.000Z"),
    });
    assert.equal(closedAgain.status, "CLOSED");
    assert.equal(closedAgain.dailyDistanceKm, 70);
    assert.deepEqual(
      closedAgain.segments.map((segment) => segment.distanceKm),
      [50, 20],
    );
    assert.equal(closedAgain.auditHistory.at(-1).action, "CLOSED");
    assert.deepEqual(
      closedAgain.segments[1].odometerReadings.map((reading) => [
        reading.odometerKm,
        reading.distanceKm,
        reading.source,
      ]),
      [
        [160, 10, "EMPLOYEE_SUBMISSION"],
        [170, 10, "CLOSE"],
      ],
    );
    assert.equal(vehicle.currentOdometerKm, 170);
  });
});

test("daily mileage business dates roll over at Asia/Kolkata midnight", () => {
  assert.equal(
    toAsiaKolkataDateKey(new Date("2026-03-19T18:29:59.999Z")),
    "2026-03-19",
  );
  assert.equal(
    toAsiaKolkataDateKey(new Date("2026-03-19T18:30:00.000Z")),
    "2026-03-20",
  );
  assert.equal(
    toAsiaKolkataDateKey(new Date("2026-03-20T00:00:00.000Z")),
    "2026-03-20",
  );
});
