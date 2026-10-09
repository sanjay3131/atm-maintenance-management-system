import test from "node:test";
import assert from "node:assert/strict";
import ATM from "../src/modules/atms/atm.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import RecurringMaintenancePlan from "../src/modules/jobs/recurringMaintenancePlan.model.js";
import {
  createRecurringMaintenancePlan,
  generateRecurringJobs,
  updateRecurringMaintenancePlan,
} from "../src/modules/jobs/recurringMaintenance.service.js";
import {
  createRecurringMaintenancePlanSchema,
  updateRecurringMaintenancePlanSchema,
} from "../src/modules/jobs/recurringMaintenance.validation.js";
import { getRecurringJobDueState } from "../src/modules/jobs/recurringMaintenance.utils.js";

const atmId = "64b000000000000000000061";
const employeeId = "64b000000000000000000062";
const otherEmployeeId = "64b000000000000000000063";
const userId = "64b000000000000000000064";
const planId = "64b000000000000000000065";
const adminId = "64b000000000000000000066";

const validEmployee = (updates = {}) => ({
  _id: employeeId,
  status: "active",
  userId: { _id: userId, status: "active", userType: "employee" },
  ...updates,
});

const makePlan = (updates = {}) => ({
  _id: planId,
  atmId,
  maintenanceType: "DAILY_CLEANING",
  assignedEmployeeId: employeeId,
  startDate: new Date("2020-01-01T00:00:00Z"),
  dayOfWeek: null,
  isActive: true,
  async save() {
    return this;
  },
  ...updates,
});

const query = (result) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  lean: async () => result,
  then(resolve, reject) {
    return Promise.resolve(result).then(resolve, reject);
  },
});

function withOverrides(overrides, callback) {
  const originals = overrides.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, value] of overrides) target[key] = value;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const [target, key, value] of originals.reverse()) {
        target[key] = value;
      }
    });
}

function planValidationMocks({
  employee = validEmployee(),
  assignedEmployeeIds = [employeeId],
  atm = { _id: atmId, isDeleted: false, status: "ACTIVE", assignedEmployeeId: assignedEmployeeIds },
} = {}) {
  return [
    [ATM, "findOne", () => query(atm)],
    [Employee, "findById", () => query(employee)],
  ];
}

const validCreateData = {
  atmId,
  assignedEmployeeId: employeeId,
  maintenanceType: "DAILY_CLEANING",
  startDate: "2026-10-08",
};

test("create schema requires an Employee reference", () => {
  assert.equal(
    createRecurringMaintenancePlanSchema.safeParse(validCreateData).success,
    true,
  );
  const missingEmployee = { ...validCreateData };
  delete missingEmployee.assignedEmployeeId;
  assert.equal(
    createRecurringMaintenancePlanSchema.safeParse(missingEmployee).success,
    false,
  );
});

test("update schema allows Employee assignment without resetting unrelated fields", () => {
  assert.deepEqual(
    updateRecurringMaintenancePlanSchema.parse({
      assignedEmployeeId: employeeId,
    }),
    { assignedEmployeeId: employeeId },
  );
});

test("creating a plan accepts an eligible Employee assigned to its ATM", async () => {
  let createdData;
  await withOverrides(
    [
      ...planValidationMocks(),
      [
        RecurringMaintenancePlan,
        "create",
        async (data) => {
          createdData = data;
          return data;
        },
      ],
    ],
    async () => {
      await createRecurringMaintenancePlan(validCreateData, adminId);
    },
  );
  assert.equal(createdData.assignedEmployeeId, employeeId);
  assert.equal(createdData.createdBy, adminId);
});

test("creating a plan rejects a missing Employee selection", async () => {
  const data = { ...validCreateData };
  delete data.assignedEmployeeId;
  await assert.rejects(createRecurringMaintenancePlan(data, adminId), {
    statusCode: 400,
    message: "An Employee must be selected for the recurring plan",
  });
});

test("creating a plan rejects Employees who are missing, inactive, or ineligible", async (t) => {
  const cases = [
    ["missing Employee", null, "Employee not found"],
    ["inactive Employee", validEmployee({ status: "inactive" }), "Employee is inactive"],
    ["missing linked User", validEmployee({ userId: null }), "Employee's linked User was not found"],
    [
      "inactive linked User",
      validEmployee({ userId: { _id: userId, status: "inactive", userType: "employee" } }),
      "Employee's linked User is inactive",
    ],
    [
      "wrong linked User type",
      validEmployee({ userId: { _id: userId, status: "active", userType: "admin" } }),
      "Employee's linked User must have employee type",
    ],
  ];

  for (const [name, employee, message] of cases) {
    await t.test(name, async () => {
      await withOverrides(planValidationMocks({ employee }), async () => {
        await assert.rejects(createRecurringMaintenancePlan(validCreateData, adminId), {
          statusCode: employee ? 400 : 404,
          message,
        });
      });
    });
  }
});

test("creating a plan rejects an Employee not assigned to its ATM", async () => {
  await withOverrides(
    planValidationMocks({ assignedEmployeeIds: [otherEmployeeId] }),
    async () => {
      await assert.rejects(createRecurringMaintenancePlan(validCreateData, adminId), {
        statusCode: 400,
        message: "Employee must be assigned to the selected ATM",
      });
    },
  );
});

test("updating a legacy plan configures a valid assigned Employee", async () => {
  const plan = makePlan({ assignedEmployeeId: null });
  await withOverrides(
    [
      ...planValidationMocks(),
      [RecurringMaintenancePlan, "findById", async () => plan],
    ],
    async () => {
      const updated = await updateRecurringMaintenancePlan(
        planId,
        { assignedEmployeeId: employeeId },
        adminId,
      );
      assert.equal(updated.assignedEmployeeId, employeeId);
      assert.equal(updated.updatedBy, adminId);
    },
  );
});

test("updating a plan validates Employee membership and preserves untouched fields", async () => {
  const plan = makePlan({ startDate: new Date("2025-01-02T00:00:00Z") });
  await withOverrides(
    [
      ...planValidationMocks({ assignedEmployeeIds: [otherEmployeeId] }),
      [RecurringMaintenancePlan, "findById", async () => plan],
    ],
    async () => {
      await assert.rejects(
        updateRecurringMaintenancePlan(
          planId,
          { assignedEmployeeId: employeeId },
          adminId,
        ),
        {
          statusCode: 400,
          message: "Employee must be assigned to the selected ATM",
        },
      );
      assert.equal(plan.assignedEmployeeId, employeeId);
      assert.equal(plan.startDate.toISOString(), "2025-01-02T00:00:00.000Z");
    },
  );
});

async function withGeneratorMocks({
  plan = makePlan(),
  atm = {
    _id: atmId,
    atmId: "ATM0001",
    status: "ACTIVE",
    isDeleted: false,
    assignedEmployeeId: [{ _id: employeeId }, { _id: otherEmployeeId }],
  },
  employee = validEmployee(),
  jobCreate = async (data) => ({ _id: "generated-job", ...data }),
  jobExists = async () => false,
} = {}, callback) {
  const createdJobs = [];
  const history = [];
  const countFilters = [];
  const result = await withOverrides(
    [
      [RecurringMaintenancePlan, "find", () => query([plan])],
      [ATM, "find", () => ({
        populate() {
          return this;
        },
        lean: async () => [atm],
      })],
      [Employee, "findById", () => query(employee)],
      [Job, "create", async (data) => {
        createdJobs.push(data);
        return jobCreate(data);
      }],
      [Job, "exists", jobExists],
      [Job, "countDocuments", async (filter) => {
        countFilters.push(filter);
        return 0;
      }],
      [JobHistory, "create", async (entries) => {
        history.push(...entries);
      }],
    ],
    async () => {
      const result = await generateRecurringJobs({
        createdBy: adminId,
        now: new Date("2026-10-08T06:00:00.000Z"),
      });
      return result;
    },
  );
  await callback({ result, createdJobs, history, countFilters });
}

test("generator assigns selected Employee's linked User ID despite multiple ATM assignments", async () => {
  await withGeneratorMocks({}, async ({ result, createdJobs }) => {
    assert.equal(result.created, 1);
    assert.equal(result.skippedMultipleAssignments, 0);
    assert.equal(createdJobs[0].assignedEmployeeId, userId);
  });
});

test("generator skips legacy plan with no selected Employee", async () => {
  await withGeneratorMocks(
    { plan: makePlan({ assignedEmployeeId: null }) },
    async ({ result, createdJobs }) => {
      assert.equal(result.skippedNoSelectedEmployee, 1);
      assert.equal(result.skipped[0].reason, "Recurring plan has no Employee selected");
      assert.equal(createdJobs.length, 0);
    },
  );
});

test("generator skips selected Employee no longer assigned to ATM without falling back", async () => {
  await withGeneratorMocks(
    { atm: { _id: atmId, atmId: "ATM0001", status: "ACTIVE", assignedEmployeeId: [{ _id: otherEmployeeId }] } },
    async ({ result, createdJobs }) => {
      assert.equal(result.skippedEmployeeNotAssignedToATM, 1);
      assert.match(result.skipped[0].reason, /no longer assigned/);
      assert.equal(createdJobs.length, 0);
    },
  );
});

test("generator reports invalid selected Employee and linked User states", async (t) => {
  const cases = [
    ["missing Employee", null, "Selected Employee no longer exists"],
    ["inactive Employee", validEmployee({ status: "inactive" }), "Selected Employee is inactive"],
    ["missing linked User", validEmployee({ userId: null }), "Selected Employee's linked User no longer exists"],
    [
      "inactive linked User",
      validEmployee({ userId: { _id: userId, status: "inactive", userType: "employee" } }),
      "Selected Employee's linked User is inactive",
    ],
    [
      "wrong linked User type",
      validEmployee({ userId: { _id: userId, status: "active", userType: "admin" } }),
      "Selected Employee's linked User is not an employee",
    ],
  ];

  for (const [name, employee, reason] of cases) {
    await t.test(name, async () => {
      await withGeneratorMocks({ employee }, async ({ result, createdJobs }) => {
        assert.equal(result.skippedInactiveEmployee, 1);
        assert.equal(result.skipped[0].reason, reason);
        assert.equal(createdJobs.length, 0);
      });
    });
  }
});

test("generator does not regenerate a cancelled occurrence", async () => {
  await withGeneratorMocks(
    {
      jobCreate: async () => {
        const error = new Error("Duplicate occurrence");
        error.code = 11000;
        throw error;
      },
      jobExists: async () => ({
        _id: "64b000000000000000000067",
        status: "CANCELLED",
      }),
    },
    async ({ result }) => {
      assert.equal(result.alreadyExists, 1);
      assert.equal(result.created, 0);
      assert.equal(result.errors.length, 0);
    },
  );
});

test("cancelled recurring Jobs are excluded from due and overdue totals", async () => {
  await withGeneratorMocks({}, async ({ countFilters }) => {
    assert.equal(countFilters.length, 2);
    for (const filter of countFilters) {
      assert.ok(filter.status.$nin.includes("CANCELLED"));
    }
  });
});

test("cancelled recurring Jobs have a distinct due state", () => {
  const state = getRecurringJobDueState(
    {
      status: "CANCELLED",
      recurringMaintenance: {
        scheduledDate: new Date("2026-10-08T00:00:00.000Z"),
        dueAt: new Date("2026-10-08T23:59:59.000Z"),
      },
    },
    new Date("2026-10-09T00:00:00.000Z"),
  );
  assert.equal(state, "CANCELLED");
});

test("updating plan employee does not update existing Jobs", async () => {
  const plan = makePlan();
  let jobUpdateCalled = false;
  await withOverrides(
    [
      ...planValidationMocks(),
      [RecurringMaintenancePlan, "findById", async () => plan],
      [Job, "updateMany", async () => {
        jobUpdateCalled = true;
      }],
    ],
    async () => {
      await updateRecurringMaintenancePlan(
        planId,
        { assignedEmployeeId: employeeId },
        adminId,
      );
    },
  );
  assert.equal(jobUpdateCalled, false);
});
