import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import User from "../src/modules/users/user.model.js";
import {
  replaceEmployeeATMAssignments,
  setATMEmployeeAssignment,
} from "../src/modules/employees/employeeAssignment.service.js";
import { assignATMEmployeeSchema } from "../src/modules/atms/atm.validation.js";

const atmId = "64b000000000000000000001";
const employeeAId = "64b000000000000000000002";
const employeeBId = "64b000000000000000000003";
const actorId = "64b000000000000000000004";

const matchesId = (left, right) => String(left?._id ?? left) === String(right?._id ?? right);

const query = (result) => ({
  session: async () => result,
  select() {
    return this;
  },
});

function setup({ atms = [], employees = [], users = [] } = {}) {
  const state = { atms, employees, users, transactions: 0 };
  const originals = [];
  const override = (target, key, value) => {
    originals.push([target, key, target[key]]);
    target[key] = value;
  };
  const find = (items, id) => items.find((item) => matchesId(item._id, id));

  override(mongoose, "startSession", async () => ({
    withTransaction: async (operation) => {
      state.transactions += 1;
      await operation({});
    },
    endSession: async () => {},
  }));
  override(ATM, "findOne", (filter) =>
    query(
      state.atms.find(
        (atm) =>
          matchesId(atm._id, filter._id) &&
          (!Object.hasOwn(filter, "isDeleted") ||
            atm.isDeleted === filter.isDeleted),
      ) ?? null,
    ),
  );
  override(ATM, "find", (filter) =>
    query(
      state.atms.filter((atm) =>
        filter._id.$in.some((id) => matchesId(atm._id, id)),
      ),
    ),
  );
  override(ATM, "updateMany", async (filter, update) => {
    for (const atm of state.atms) {
      if (
        filter._id?.$in &&
        !filter._id.$in.some((id) => matchesId(atm._id, id))
      ) {
        continue;
      }
      if (filter._id && !filter._id.$in && !matchesId(atm._id, filter._id)) {
        continue;
      }
      const assigned = atm.assignedEmployeeId ?? [];
      if (
        filter.assignedEmployeeId &&
        !assigned.some((id) =>
          matchesId(id, filter.assignedEmployeeId),
        )
      ) {
        continue;
      }
      if (update.$pull?.assignedEmployeeId) {
        atm.assignedEmployeeId = assigned.filter(
          (id) => !matchesId(id, update.$pull.assignedEmployeeId),
        );
      }
      if (update.$set) Object.assign(atm, update.$set);
    }
    return { modifiedCount: 1 };
  });
  override(ATM.prototype, "save", async function () {
    return this;
  });

  override(Employee, "findById", (id) => query(find(state.employees, id) ?? null));
  override(Employee, "updateMany", async (filter, update) => {
    for (const employee of state.employees) {
      if (filter._id?.$ne && matchesId(employee._id, filter._id.$ne)) continue;
      const currentIds = employee.assignedAtmIds ?? [];
      if (filter.assignedAtmIds) {
        const expected = filter.assignedAtmIds;
        const hasRef = expected.$in
          ? currentIds.some((id) =>
              expected.$in.some((expectedId) => matchesId(id, expectedId)),
            )
          : currentIds.some((id) => matchesId(id, expected));
        if (!hasRef) continue;
      }
      if (update.$pull?.assignedAtmIds) {
        const pull = update.$pull.assignedAtmIds;
        employee.assignedAtmIds = currentIds.filter(
          (id) =>
            !(pull.$in
              ? pull.$in.some((expectedId) => matchesId(id, expectedId))
              : matchesId(id, pull)),
        );
      }
    }
    return { modifiedCount: 1 };
  });
  override(Employee.prototype, "save", async function () {
    return this;
  });
  override(User, "findById", (id) =>
    query(find(state.users, id) ?? null),
  );

  return {
    state,
    restore() {
      for (const [target, key, original] of originals.reverse()) {
        target[key] = original;
      }
    },
  };
}

function makeEmployee(_id, assignedAtmIds = []) {
  return {
    _id,
    status: "active",
    userId: _id,
    assignedAtmIds,
    save: async function () {
      return this;
    },
  };
}

function makeATM(assignedEmployeeId = []) {
  return {
    _id: atmId,
    atmId: "ATM0001",
    isDeleted: false,
    assignedEmployeeId,
    save: async function () {
      return this;
    },
  };
}

const users = () => [
  { _id: employeeAId, userType: "employee", status: "active" },
  { _id: employeeBId, userType: "employee", status: "active" },
];

test("ATM assignment API accepts explicit null to unassign while validating Employee IDs", () => {
  assert.equal(
    assignATMEmployeeSchema.safeParse({ employeeId: null }).success,
    true,
  );
  assert.equal(
    assignATMEmployeeSchema.safeParse({ employeeId: employeeAId }).success,
    true,
  );
  assert.equal(
    assignATMEmployeeSchema.safeParse({ employeeId: "invalid" }).success,
    false,
  );
});

test("assigns an unassigned ATM to an Employee and synchronizes both sides", async () => {
  const db = setup({
    atms: [makeATM()],
    employees: [makeEmployee(employeeAId)],
    users: users(),
  });
  try {
    const result = await setATMEmployeeAssignment({
      atmId,
      employeeId: employeeAId,
      updatedBy: actorId,
    });
    assert.deepEqual(result.assignedEmployeeId, [employeeAId]);
    assert.deepEqual(db.state.employees[0].assignedAtmIds, [atmId]);
    assert.equal(db.state.transactions, 1);
  } finally {
    db.restore();
  }
});

test("reassigns an ATM and removes it from the previous Employee", async () => {
  const db = setup({
    atms: [makeATM([employeeAId])],
    employees: [
      makeEmployee(employeeAId, [atmId, atmId]),
      makeEmployee(employeeBId),
    ],
    users: users(),
  });
  try {
    const result = await setATMEmployeeAssignment({
      atmId,
      employeeId: employeeBId,
      updatedBy: actorId,
    });
    assert.deepEqual(result.assignedEmployeeId, [employeeBId]);
    assert.deepEqual(db.state.employees[0].assignedAtmIds, []);
    assert.deepEqual(db.state.employees[1].assignedAtmIds, [atmId]);
  } finally {
    db.restore();
  }
});

test("unassigns an ATM from all Employee references", async () => {
  const db = setup({
    atms: [makeATM([employeeAId])],
    employees: [
      makeEmployee(employeeAId, [atmId, atmId]),
      makeEmployee(employeeBId, [atmId]),
    ],
    users: users(),
  });
  try {
    const result = await setATMEmployeeAssignment({
      atmId,
      employeeId: null,
      updatedBy: actorId,
    });
    assert.deepEqual(result.assignedEmployeeId, []);
    assert.deepEqual(db.state.employees[0].assignedAtmIds, []);
    assert.deepEqual(db.state.employees[1].assignedAtmIds, []);
  } finally {
    db.restore();
  }
});

test("rejects nonexistent Employees and ATMs", async (t) => {
  await t.test("missing Employee", async () => {
    const db = setup({ atms: [makeATM()], employees: [], users: [] });
    try {
      await assert.rejects(
        setATMEmployeeAssignment({
          atmId,
          employeeId: employeeAId,
          updatedBy: actorId,
        }),
        (error) => error.statusCode === 404,
      );
    } finally {
      db.restore();
    }
  });

  await t.test("missing ATM", async () => {
    const db = setup({
      atms: [],
      employees: [makeEmployee(employeeAId)],
      users: users(),
    });
    try {
      await assert.rejects(
        setATMEmployeeAssignment({
          atmId,
          employeeId: employeeAId,
          updatedBy: actorId,
        }),
        (error) => error.statusCode === 404,
      );
    } finally {
      db.restore();
    }
  });
});

test("repeated assignment is idempotent and prevents duplicate Employee ATM IDs", async () => {
  const db = setup({
    atms: [makeATM([employeeAId])],
    employees: [makeEmployee(employeeAId, [atmId, atmId])],
    users: users(),
  });
  try {
    await setATMEmployeeAssignment({
      atmId,
      employeeId: employeeAId,
      updatedBy: actorId,
    });
    await setATMEmployeeAssignment({
      atmId,
      employeeId: employeeAId,
      updatedBy: actorId,
    });
    assert.deepEqual(db.state.atms[0].assignedEmployeeId, [employeeAId]);
    assert.deepEqual(db.state.employees[0].assignedAtmIds, [atmId]);
  } finally {
    db.restore();
  }
});

test("Employee assignment replacement removes prior ATM links and synchronizes destinations", async () => {
  const previousAtmId = "64b000000000000000000005";
  const desiredAtmId = "64b000000000000000000006";
  const previousATM = { ...makeATM([employeeAId]), _id: previousAtmId };
  const desiredATM = { ...makeATM(), _id: desiredAtmId };
  const db = setup({
    atms: [previousATM, desiredATM],
    employees: [makeEmployee(employeeAId, [previousAtmId, previousAtmId])],
    users: users(),
  });
  try {
    const employee = await replaceEmployeeATMAssignments({
      employeeId: employeeAId,
      assignedAtmIds: [desiredAtmId, desiredAtmId],
      updatedBy: actorId,
    });
    assert.deepEqual(employee.assignedAtmIds, [desiredAtmId]);
    assert.deepEqual(previousATM.assignedEmployeeId, []);
    assert.deepEqual(desiredATM.assignedEmployeeId, [employeeAId]);
  } finally {
    db.restore();
  }
});
