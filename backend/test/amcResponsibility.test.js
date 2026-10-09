import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import User from "../src/modules/users/user.model.js";
import AMC from "../src/modules/amc/amc.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import {
  guardEmployeeEligibilityChange,
  guardUserEligibilityChange,
  setATMAMCResponsibleEmployee,
  withAMCResponsibilityTransaction,
} from "../src/modules/amc/amcResponsibility.service.js";
import { generateMonthlyAMC } from "../src/modules/amc/amc.service.js";

const atmId = "64b000000000000000000001";
const employeeAId = "64b000000000000000000002";
const employeeBId = "64b000000000000000000003";
const userAId = "64b000000000000000000005";
const userBId = "64b000000000000000000006";
const actorId = "64b000000000000000000007";

const idKey = (value) => String(value?._id ?? value).toLowerCase();
const matches = (left, right) => idKey(left) === idKey(right);

const query = (result) => ({
  select() {
    return this;
  },
  session: async () => result,
});

function setup({
  atms = [],
  employees = [],
  users = [],
  failATMSave = false,
} = {}) {
  const state = { atms, employees, users, transactions: 0 };
  const originals = [];
  const override = (target, key, value) => {
    originals.push([target, key, target[key]]);
    target[key] = value;
  };
  const findById = (items, id) => items.find((item) => matches(item._id, id));
  const matchesATMQuery = (atm, filter) => {
    if (filter._id?.$in) {
      return filter._id.$in.some((id) => matches(atm._id, id));
    }
    if (filter.isDeleted !== undefined && atm.isDeleted !== filter.isDeleted) {
      return false;
    }
    return (filter.$or ?? []).some((clause) => {
      if (clause.assignedEmployeeId?.$in) {
        return (atm.assignedEmployeeId ?? []).some((employeeId) =>
          clause.assignedEmployeeId.$in.some((id) =>
            matches(employeeId, id),
          ),
        );
      }
      if (clause.assignedEmployeeId) {
        return (atm.assignedEmployeeId ?? []).some((employeeId) =>
          matches(employeeId, clause.assignedEmployeeId),
        );
      }
      if (clause.amcResponsibleEmployeeId?.$in) {
        return clause.amcResponsibleEmployeeId.$in.some((id) =>
          matches(atm.amcResponsibleEmployeeId, id),
        );
      }
      if (clause.amcResponsibleEmployeeId) {
        return matches(
          atm.amcResponsibleEmployeeId,
          clause.amcResponsibleEmployeeId,
        );
      }
      return false;
    });
  };

  override(mongoose, "startSession", async () => ({
    withTransaction: async (operation) => {
      state.transactions++;
      const atmSnapshot = atms.map((atm) => ({
        atm,
        assignedEmployeeId: [...(atm.assignedEmployeeId ?? [])],
        amcResponsibleEmployeeId: atm.amcResponsibleEmployeeId ?? null,
        updatedBy: atm.updatedBy,
      }));
      const employeeSnapshot = employees.map((employee) => ({
        employee,
        status: employee.status,
        updatedBy: employee.updatedBy,
      }));
      const userSnapshot = users.map((user) => ({
        user,
        status: user.status,
        userType: user.userType,
      }));
      try {
        await operation({});
      } catch (error) {
        for (const snapshot of atmSnapshot) {
          snapshot.atm.assignedEmployeeId = snapshot.assignedEmployeeId;
          snapshot.atm.amcResponsibleEmployeeId =
            snapshot.amcResponsibleEmployeeId;
          snapshot.atm.updatedBy = snapshot.updatedBy;
        }
        for (const snapshot of employeeSnapshot) {
          snapshot.employee.status = snapshot.status;
          snapshot.employee.updatedBy = snapshot.updatedBy;
        }
        for (const snapshot of userSnapshot) {
          snapshot.user.status = snapshot.status;
          snapshot.user.userType = snapshot.userType;
        }
        throw error;
      }
    },
    endSession: async () => {},
  }));
  override(ATM, "findOne", (filter) =>
    query(
      atms.find(
        (atm) =>
          matches(atm._id, filter._id) &&
          (!Object.hasOwn(filter, "isDeleted") ||
            atm.isDeleted === filter.isDeleted),
      ) ?? null,
    ),
  );
  override(ATM, "find", (filter) =>
    query(atms.filter((atm) => matchesATMQuery(atm, filter))),
  );
  override(ATM.prototype, "save", async function () {
    if (failATMSave) throw new Error("ATM save failed");
    return this;
  });
  override(Employee, "findById", (id) =>
    query(findById(employees, id) ?? null),
  );
  override(Employee, "find", (filter) =>
    query(
      employees.filter((employee) => matches(employee.userId, filter.userId)),
    ),
  );
  override(User, "findById", (id) => query(findById(users, id) ?? null));

  return {
    state,
    restore() {
      for (const [target, key, original] of originals.reverse()) {
        target[key] = original;
      }
    },
  };
}

function employee(_id, userId, assignedAtmIds = [], status = "active") {
  return {
    _id,
    userId,
    assignedAtmIds,
    status,
    updatedBy: null,
  };
}

function atm({
  assignedEmployeeId = [employeeAId, employeeBId],
  amcResponsibleEmployeeId = null,
} = {}) {
  return {
    _id: atmId,
    atmId: "ATM0001",
    isDeleted: false,
    assignedEmployeeId,
    amcResponsibleEmployeeId,
    save: async function (...args) {
      return ATM.prototype.save.apply(this, args);
    },
  };
}

function validEmployees() {
  return [
    employee(employeeAId, userAId, [atmId]),
    employee(employeeBId, userBId, [atmId]),
  ];
}

function validUsers() {
  return [
    { _id: userAId, status: "active", userType: "employee" },
    { _id: userBId, status: "active", userType: "employee" },
  ];
}

test("sets, changes, and clears AMC responsibility without changing general assignments", async () => {
  const record = atm();
  const originalAssignedIds = [...record.assignedEmployeeId];
  const db = setup({
    atms: [record],
    employees: validEmployees(),
    users: validUsers(),
  });
  try {
    await setATMAMCResponsibleEmployee({
      atmId,
      employeeId: employeeAId,
      updatedBy: actorId,
    });
    assert.equal(idKey(record.amcResponsibleEmployeeId), employeeAId);

    await setATMAMCResponsibleEmployee({
      atmId,
      employeeId: employeeBId,
      updatedBy: actorId,
    });
    assert.equal(idKey(record.amcResponsibleEmployeeId), employeeBId);

    await setATMAMCResponsibleEmployee({
      atmId,
      employeeId: null,
      updatedBy: actorId,
    });
    assert.equal(record.amcResponsibleEmployeeId, null);
    assert.deepEqual(record.assignedEmployeeId, originalAssignedIds);
    assert.deepEqual(
      db.state.employees.map((item) => item.assignedAtmIds),
      [[atmId], [atmId]],
    );
    assert.equal(db.state.transactions, 3);
  } finally {
    db.restore();
  }
});

test("rejects AMC responsibility for missing, unassigned, or ineligible employees", async (t) => {
  await t.test("missing employee", async () => {
    const record = atm();
    const db = setup({ atms: [record] });
    try {
      await assert.rejects(
        setATMAMCResponsibleEmployee({
          atmId,
          employeeId: employeeAId,
          updatedBy: actorId,
        }),
        /Employee not found/,
      );
      assert.equal(record.amcResponsibleEmployeeId, null);
    } finally {
      db.restore();
    }
  });

  await t.test("employee not assigned to ATM", async () => {
    const record = atm({ assignedEmployeeId: [employeeAId] });
    const employeeB = employee(employeeBId, userBId);
    const db = setup({
      atms: [record],
      employees: [employeeB],
      users: validUsers(),
    });
    try {
      await assert.rejects(
        setATMAMCResponsibleEmployee({
          atmId,
          employeeId: employeeBId,
          updatedBy: actorId,
        }),
        /must already be assigned/,
      );
    } finally {
      db.restore();
    }
  });

  for (const scenario of [
    {
      name: "inactive employee",
      employees: [employee(employeeAId, userAId, [atmId], "inactive")],
      users: validUsers(),
      message: /must be active/,
    },
    {
      name: "missing linked User",
      employees: [employee(employeeAId, userAId, [atmId])],
      users: [],
      message: /linked User was not found/,
    },
    {
      name: "inactive linked User",
      employees: [employee(employeeAId, userAId, [atmId])],
      users: [{ _id: userAId, status: "inactive", userType: "employee" }],
      message: /must be active and have employee type/,
    },
    {
      name: "non-employee linked User",
      employees: [employee(employeeAId, userAId, [atmId])],
      users: [{ _id: userAId, status: "active", userType: "admin" }],
      message: /must be active and have employee type/,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const record = atm({ assignedEmployeeId: [employeeAId] });
      const db = setup({
        atms: [record],
        employees: scenario.employees,
        users: scenario.users,
      });
      try {
        await assert.rejects(
          setATMAMCResponsibleEmployee({
            atmId,
            employeeId: employeeAId,
            updatedBy: actorId,
          }),
          scenario.message,
        );
        assert.equal(record.amcResponsibleEmployeeId, null);
      } finally {
        db.restore();
      }
    });
  }
});

test("failed responsibility save rolls back responsibility and keeps general assignments", async () => {
  const record = atm({ amcResponsibleEmployeeId: employeeAId });
  const originalAssignedIds = [...record.assignedEmployeeId];
  const db = setup({
    atms: [record],
    employees: validEmployees(),
    users: validUsers(),
    failATMSave: true,
  });
  try {
    await assert.rejects(
      setATMAMCResponsibleEmployee({
        atmId,
        employeeId: employeeBId,
        updatedBy: actorId,
      }),
      /ATM save failed/,
    );
    assert.equal(idKey(record.amcResponsibleEmployeeId), employeeAId);
    assert.deepEqual(record.assignedEmployeeId, originalAssignedIds);
  } finally {
    db.restore();
  }
});

test("employee and user eligibility changes are blocked while AMC responsibility remains", async () => {
  const record = atm({ amcResponsibleEmployeeId: employeeBId });
  const employees = validEmployees();
  const users = validUsers();
  const db = setup({ atms: [record], employees, users });
  try {
    await assert.rejects(
      withAMCResponsibilityTransaction((session) =>
        guardEmployeeEligibilityChange({
          employeeId: employeeBId,
          session,
          updatedBy: actorId,
        }),
      ),
      /Change or clear AMC responsibility first/,
    );
    await assert.rejects(
      withAMCResponsibilityTransaction((session) =>
        guardUserEligibilityChange({
          userId: userBId,
          session,
          updatedBy: actorId,
        }),
      ),
      /Change or clear AMC responsibility first/,
    );
    record.amcResponsibleEmployeeId = null;
    await withAMCResponsibilityTransaction((session) =>
      guardEmployeeEligibilityChange({
        employeeId: employeeBId,
        session,
        updatedBy: actorId,
      }),
    );
    await withAMCResponsibilityTransaction((session) =>
      guardUserEligibilityChange({
        userId: userBId,
        session,
        updatedBy: actorId,
      }),
    );
    assert.deepEqual(record.assignedEmployeeId, [employeeAId, employeeBId]);
  } finally {
    db.restore();
  }
});

test("AMC generation uses the dedicated responsible employee for a multi-employee ATM", async () => {
  const record = {
    _id: atmId,
    atmId: "ATM0001",
    status: "ACTIVE",
    assignedEmployeeId: [
      { _id: employeeAId, userId: { _id: userAId } },
      { _id: employeeBId, userId: { _id: userBId } },
    ],
    amcResponsibleEmployeeId: {
      _id: employeeBId,
      employeeCode: "EMP-B",
      status: "active",
      supervisorId: null,
      userId: { _id: userBId, status: "active", userType: "employee" },
    },
    customer: null,
    bankId: null,
    districtId: null,
  };
  const created = [];
  const originals = [];
  const override = (target, key, value) => {
    originals.push([target, key, target[key]]);
    target[key] = value;
  };
  const queryResult = {
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve([record]).then(resolve, reject);
    },
  };
  override(ATM, "find", () => queryResult);
  override(ATM, "countDocuments", async () => 0);
  override(User, "findOne", () => ({
    select: async () => ({ _id: actorId }),
  }));
  override(AMC, "countDocuments", async () => 0);
  override(AMC, "create", async (data) => {
    created.push(data);
    return data;
  });
  try {
    const result = await generateMonthlyAMC(10, 2026, actorId);
    assert.equal(result.created, 1);
    assert.equal(created[0].employeeId, userBId);
    assert.equal(created[0].atmId, atmId);

    const historicalAMC = created[0];
    record.amcResponsibleEmployeeId = {
      ...record.amcResponsibleEmployeeId,
      _id: employeeAId,
      employeeCode: "EMP-A",
      userId: { _id: userAId, status: "active", userType: "employee" },
    };
    const nextMonth = await generateMonthlyAMC(11, 2026, actorId);
    assert.equal(nextMonth.created, 1);
    assert.equal(created[1].employeeId, userAId);
    assert.equal(historicalAMC.employeeId, userBId);

    const uniqueATMMonthIndex = AMC.schema.indexes().find(
      ([fields, options]) =>
        fields.atmId === 1 &&
        fields.month === 1 &&
        fields.year === 1 &&
        options.unique === true,
    );
    assert.ok(uniqueATMMonthIndex);
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
});

test("AMC generation skips an inactive dedicated responsible employee", async () => {
  const record = {
    _id: atmId,
    atmId: "ATM0001",
    status: "ACTIVE",
    assignedEmployeeId: [employeeAId],
    amcResponsibleEmployeeId: {
      _id: employeeAId,
      employeeCode: "EMP-A",
      status: "inactive",
      userId: { _id: userAId, status: "active", userType: "employee" },
    },
  };
  const created = [];
  const originals = [];
  const override = (target, key, value) => {
    originals.push([target, key, target[key]]);
    target[key] = value;
  };
  const queryResult = {
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve([record]).then(resolve, reject);
    },
  };
  override(ATM, "find", () => queryResult);
  override(User, "findOne", () => ({
    select: async () => ({ _id: actorId }),
  }));
  override(AMC, "countDocuments", async () => 0);
  override(AMC, "create", async (data) => {
    created.push(data);
    return data;
  });
  try {
    const result = await generateMonthlyAMC(10, 2026, actorId);
    assert.equal(result.created, 0);
    assert.equal(result.skipped, 1);
    assert.match(result.errors[0].error, /inactive or ineligible/);
    assert.equal(created.length, 0);
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
});

test("AMC generation reports and skips ATMs without dedicated responsibility", async () => {
  const record = {
    _id: atmId,
    atmId: "ATM0001",
    status: "ACTIVE",
    assignedEmployeeId: [{ _id: employeeAId }, { _id: employeeBId }],
    amcResponsibleEmployeeId: null,
  };
  const originals = [];
  const override = (target, key, value) => {
    originals.push([target, key, target[key]]);
    target[key] = value;
  };
  const queryResult = {
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve([record]).then(resolve, reject);
    },
  };
  override(ATM, "find", () => queryResult);
  override(User, "findOne", () => ({
    select: async () => ({ _id: actorId }),
  }));
  override(AMC, "countDocuments", async () => 0);
  override(AMC, "create", async () => {
    throw new Error("AMC must not be created");
  });
  try {
    const result = await generateMonthlyAMC(10, 2026, actorId);
    assert.equal(result.created, 0);
    assert.equal(result.skipped, 1);
    assert.match(result.errors[0].error, /No AMC responsible employee/);
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
});

test("AMC generation remains independent of a cancelled Job", async () => {
  const record = {
    _id: atmId,
    atmId: "ATM0001",
    status: "ACTIVE",
    assignedEmployeeId: [{ _id: employeeAId, userId: { _id: userAId } }],
    amcResponsibleEmployeeId: {
      _id: employeeAId,
      employeeCode: "EMP-A",
      status: "active",
      supervisorId: null,
      userId: { _id: userAId, status: "active", userType: "employee" },
    },
    customer: null,
    bankId: null,
    districtId: null,
  };
  const cancelledJob = { status: "CANCELLED" };
  const generatedAMCs = [];
  let jobCreateCalls = 0;
  const originals = [];
  const override = (target, key, value) => {
    originals.push([target, key, target[key]]);
    target[key] = value;
  };
  const queryResult = {
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve([record]).then(resolve, reject);
    },
  };
  override(ATM, "find", () => queryResult);
  override(User, "findOne", () => ({
    select: async () => ({ _id: actorId }),
  }));
  override(AMC, "countDocuments", async () => 0);
  override(AMC, "create", async (data) => {
    generatedAMCs.push(data);
    return data;
  });
  override(Job, "create", async () => {
    jobCreateCalls++;
    throw new Error("AMC generation must not create Jobs");
  });

  try {
    const result = await generateMonthlyAMC(10, 2026, actorId);
    assert.equal(result.created, 1);
    assert.equal(generatedAMCs.length, 1);
    assert.equal(generatedAMCs[0].atmId, atmId);
    assert.equal(cancelledJob.status, "CANCELLED");
    assert.equal(jobCreateCalls, 0);
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
});
