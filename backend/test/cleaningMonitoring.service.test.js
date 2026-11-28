import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import CleaningRecord from "../src/modules/cleaningRecords/cleaningRecord.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import {
  getCleaningMonitoringRecords,
  getCleaningMonitoringStatus,
} from "../src/modules/cleaningRecords/cleaningMonitoring.service.js";
import RecurringMaintenancePlan from "../src/modules/jobs/recurringMaintenancePlan.model.js";
import User from "../src/modules/users/user.model.js";

const IST_NOW = new Date("2026-11-26T06:00:00.000Z");
const ACTIVE_PLAN = {
  maintenanceType: "DAILY_CLEANING",
  monitoringActivatedAt: new Date("2026-11-01T00:00:00.000Z"),
};

test("missing activation baseline requires configuration even with cleaning history", () => {
  const result = getCleaningMonitoringStatus(
    { ...ACTIVE_PLAN, monitoringActivatedAt: null },
    "2026-11-26",
    IST_NOW,
  );

  assert.deepEqual(result, {
    status: "CONFIGURATION_REQUIRED",
    ageInCalendarDays: 0,
  });
});

test("no-history grace ends after seven full days from monitoring activation", () => {
  const plan = {
    ...ACTIVE_PLAN,
    monitoringActivatedAt: new Date("2026-11-19T06:00:00.000Z"),
  };

  assert.equal(
    getCleaningMonitoringStatus(
      plan,
      null,
      new Date("2026-11-26T05:59:59.999Z"),
    ).status,
    "GRACE_PERIOD",
  );
  assert.equal(
    getCleaningMonitoringStatus(
      plan,
      null,
      new Date("2026-11-26T06:00:00.000Z"),
    ).status,
    "NO_HISTORY",
  );
});

test("daily cleaning is green today and red for an earlier valid date", () => {
  assert.equal(
    getCleaningMonitoringStatus(ACTIVE_PLAN, "2026-11-26", IST_NOW).status,
    "GREEN",
  );
  assert.equal(
    getCleaningMonitoringStatus(ACTIVE_PLAN, "2026-11-25", IST_NOW).status,
    "RED",
  );
});

test("weekly mopping is green at two calendar days and red at three", () => {
  const plan = { ...ACTIVE_PLAN, maintenanceType: "WEEKLY_MOPPING" };

  assert.equal(
    getCleaningMonitoringStatus(plan, "2026-11-24", IST_NOW).status,
    "GREEN",
  );
  assert.equal(
    getCleaningMonitoringStatus(plan, "2026-11-23", IST_NOW).status,
    "RED",
  );
});

test("monitoring resolves batched references with fresh deadline options", async () => {
  const firstPlanId = new mongoose.Types.ObjectId();
  const secondPlanId = new mongoose.Types.ObjectId();
  const futureOnlyPlanId = new mongoose.Types.ObjectId();
  const atmId = new mongoose.Types.ObjectId();
  const employeeId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const plans = [
    {
      _id: firstPlanId,
      atmId,
      assignedEmployeeId: employeeId,
      maintenanceType: "DAILY_CLEANING",
      monitoringActivatedAt: new Date("2026-11-19T06:00:00.000Z"),
    },
    {
      _id: secondPlanId,
      atmId: null,
      assignedEmployeeId: null,
      maintenanceType: "DAILY_CLEANING",
      monitoringActivatedAt: new Date("2026-11-19T06:00:00.000Z"),
    },
    {
      _id: futureOnlyPlanId,
      atmId: null,
      assignedEmployeeId: null,
      maintenanceType: "WEEKLY_MOPPING",
      monitoringActivatedAt: new Date("2026-11-19T06:00:00.000Z"),
    },
  ];
  const originalPlanFind = RecurringMaintenancePlan.find;
  const originalAtmFind = ATM.find;
  const originalEmployeeFind = Employee.find;
  const originalUserFind = User.find;
  const originalRecordAggregate = CleaningRecord.aggregate;
  const queryOptions = [];
  let aggregateOptions;
  const controller = new AbortController();
  const originalDateNow = Date.now;
  let currentTime = 1_000;
  Date.now = () => currentTime;

  RecurringMaintenancePlan.find = (filter) => {
    assert.deepEqual(filter, {
      isActive: true,
      maintenanceType: { $in: ["DAILY_CLEANING", "WEEKLY_MOPPING"] },
    });
    return {
      select() {
        return this;
      },
      sort() {
        return this;
      },
      setOptions(options) {
        queryOptions.push({ name: "plans", options });
        return this;
      },
      lean: async () => {
        currentTime += 1_000;
        return plans;
      },
    };
  };
  const mockLookup = (name, expectedIds, documents) => (filter) => {
    assert.deepEqual(filter, { _id: { $in: expectedIds } });
    return {
      select() {
        return this;
      },
      setOptions(options) {
        queryOptions.push({ name, options });
        return this;
      },
      lean: async () => {
        currentTime += 1_000;
        return documents;
      },
    };
  };
  ATM.find = mockLookup("atms", [atmId], [
    { _id: atmId, atmId: "ATM-001", locationName: "Central" },
  ]);
  Employee.find = mockLookup("employees", [employeeId], [
    { _id: employeeId, employeeCode: "EMP-001", userId },
  ]);
  User.find = mockLookup("users", [userId], [
    { _id: userId, firstName: "Asha", lastName: "Rao" },
  ]);
  CleaningRecord.aggregate = async (pipeline, options) => {
    aggregateOptions = options;
    currentTime += 1_000;
    assert.deepEqual(pipeline[0].$match, {
      recurringPlanId: {
        $in: [firstPlanId, secondPlanId, futureOnlyPlanId],
      },
      validityStatus: "VALID",
      cleaningDate: { $lte: "2026-11-26" },
    });
    assert.deepEqual(pipeline[1].$sort, {
      cleaningDate: -1,
      submittedAt: -1,
    });
    return [
      {
        _id: firstPlanId,
        cleaningDate: "2026-11-26",
      },
      {
        _id: secondPlanId,
        cleaningDate: "2026-11-25",
      },
    ];
  };

  try {
    const records = await getCleaningMonitoringRecords(
      new Date("2026-11-26T05:59:59.999Z"),
      {
        signal: controller.signal,
        deadline: 11_000,
      },
    );

    assert.deepEqual(
      queryOptions.map(({ name, options }) => [name, options.maxTimeMS]),
      [
        ["plans", 10_000],
        ["atms", 9_000],
        ["employees", 8_000],
        ["users", 7_000],
      ],
    );
    for (const { options } of queryOptions) {
      assert.equal(options.signal, controller.signal);
      assert.ok(options.maxTimeMS > 0 && options.maxTimeMS <= 15_000);
    }
    assert.equal(aggregateOptions.maxTimeMS, 6_000);
    assert.equal(aggregateOptions.signal, controller.signal);
    assert.equal(records.length, 3);
    assert.equal(records[0].status, "GREEN");
    assert.equal(records[0].latestCleaningDate, "2026-11-26");
    assert.deepEqual(records[0].atm, {
      _id: String(atmId),
      atmId: "ATM-001",
      clientAtmId: null,
      locationName: "Central",
    });
    assert.deepEqual(records[0].responsibleEmployee, {
      _id: String(employeeId),
      employeeCode: "EMP-001",
      userId: { firstName: "Asha", lastName: "Rao" },
    });
    assert.equal(records[1].status, "RED");
    assert.equal(records[1].latestCleaningDate, "2026-11-25");
    assert.equal(records[2].status, "GRACE_PERIOD");
    assert.equal(records[2].latestCleaningDate, null);
  } finally {
    Date.now = originalDateNow;
    RecurringMaintenancePlan.find = originalPlanFind;
    ATM.find = originalAtmFind;
    Employee.find = originalEmployeeFind;
    User.find = originalUserFind;
    CleaningRecord.aggregate = originalRecordAggregate;
  }
});

test("aborted or expired monitoring exports do not start a plan query", async () => {
  const originalPlanFind = RecurringMaintenancePlan.find;
  const originalRecordAggregate = CleaningRecord.aggregate;
  let databaseCalls = 0;
  RecurringMaintenancePlan.find = () => {
    databaseCalls += 1;
    throw new Error("Unexpected plan query");
  };
  CleaningRecord.aggregate = () => {
    databaseCalls += 1;
    throw new Error("Unexpected record aggregation");
  };

  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      getCleaningMonitoringRecords(new Date(), {
        signal: controller.signal,
        deadline: Date.now() + 30_000,
      }),
      { statusCode: 499 },
    );
    await assert.rejects(
      getCleaningMonitoringRecords(new Date(), {
        deadline: Date.now() - 1,
      }),
      { statusCode: 504 },
    );
    assert.equal(databaseCalls, 0);
  } finally {
    RecurringMaintenancePlan.find = originalPlanFind;
    CleaningRecord.aggregate = originalRecordAggregate;
  }
});

test("abort or deadline expiry after a query prevents subsequent batched lookups", async () => {
  const originalPlanFind = RecurringMaintenancePlan.find;
  const originalAtmFind = ATM.find;
  const originalEmployeeFind = Employee.find;
  const originalDateNow = Date.now;
  const planId = new mongoose.Types.ObjectId();
  const atmId = new mongoose.Types.ObjectId();
  let employeeQueryCount = 0;
  let now = 1_000;
  Date.now = () => now;
  RecurringMaintenancePlan.find = () => ({
    select() {
      return this;
    },
    sort() {
      return this;
    },
    setOptions() {
      return this;
    },
    lean: async () => [
      {
        _id: planId,
        atmId,
        assignedEmployeeId: null,
        maintenanceType: "DAILY_CLEANING",
        monitoringActivatedAt: new Date("2026-11-01T00:00:00.000Z"),
      },
    ],
  });
  ATM.find = () => ({
    select() {
      return this;
    },
    setOptions() {
      return this;
    },
    lean: async () => {
      now = 11_000;
      return [{ _id: atmId, atmId: "ATM-001", locationName: "Central" }];
    },
  });
  Employee.find = () => {
    employeeQueryCount += 1;
    throw new Error("Employee lookup should not run");
  };

  try {
    await assert.rejects(
      getCleaningMonitoringRecords(IST_NOW, { deadline: 11_000 }),
      { statusCode: 504 },
    );
    assert.equal(employeeQueryCount, 0);

    now = 1_000;
    const controller = new AbortController();
    ATM.find = () => ({
      select() {
        return this;
      },
      setOptions() {
        return this;
      },
      lean: async () => {
        controller.abort();
        return [{ _id: atmId, atmId: "ATM-001", locationName: "Central" }];
      },
    });
    await assert.rejects(
      getCleaningMonitoringRecords(IST_NOW, {
        signal: controller.signal,
        deadline: 20_000,
      }),
      { statusCode: 499 },
    );
    assert.equal(employeeQueryCount, 0);
  } finally {
    Date.now = originalDateNow;
    RecurringMaintenancePlan.find = originalPlanFind;
    ATM.find = originalAtmFind;
    Employee.find = originalEmployeeFind;
  }
});

test("monitoring database errors propagate without returning partial records", async () => {
  const planId = new mongoose.Types.ObjectId();
  const atmId = new mongoose.Types.ObjectId();
  const originalPlanFind = RecurringMaintenancePlan.find;
  const originalAtmFind = ATM.find;
  const originalRecordAggregate = CleaningRecord.aggregate;
  let planError = new Error("Plan query failed");
  const atmError = new Error("ATM lookup failed");
  const recordError = new Error("Cleaning aggregation failed");
  RecurringMaintenancePlan.find = () => ({
    select() {
      return this;
    },
    sort() {
      return this;
    },
    setOptions() {
      return this;
    },
    lean: async () => {
      if (planError) throw planError;
      return [
        {
          _id: planId,
          atmId,
          assignedEmployeeId: null,
          maintenanceType: "DAILY_CLEANING",
          monitoringActivatedAt: new Date("2026-11-01T00:00:00.000Z"),
        },
      ];
    },
  });
  ATM.find = () => ({
    select() {
      return this;
    },
    setOptions() {
      return this;
    },
    lean: async () => {
      throw atmError;
    },
  });
  CleaningRecord.aggregate = async () => {
    throw recordError;
  };

  try {
    await assert.rejects(
      getCleaningMonitoringRecords(IST_NOW, {
        deadline: Date.now() + 30_000,
      }),
      (error) => error === planError,
    );

    planError = null;
    await assert.rejects(
      getCleaningMonitoringRecords(IST_NOW, {
        deadline: Date.now() + 30_000,
      }),
      (error) => error === atmError,
    );

    ATM.find = () => ({
      select() {
        return this;
      },
      setOptions() {
        return this;
      },
      lean: async () => [{ _id: atmId, atmId: "ATM-001" }],
    });
    await assert.rejects(
      getCleaningMonitoringRecords(IST_NOW, {
        deadline: Date.now() + 30_000,
      }),
      (error) => error === recordError,
    );
  } finally {
    RecurringMaintenancePlan.find = originalPlanFind;
    ATM.find = originalAtmFind;
    CleaningRecord.aggregate = originalRecordAggregate;
  }
});
