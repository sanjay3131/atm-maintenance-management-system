import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import User from "../src/modules/users/user.model.js";
import {
  addEmployeeToATM,
  removeEmployeeFromATM,
  replaceATMEmployeeAssignments,
  replaceEmployeeATMAssignments,
} from "../src/modules/employees/employeeAssignment.service.js";
import { setATMAMCResponsibleEmployeeSchema } from "../src/modules/atms/atm.validation.js";
import {
  assignATMEmployeeSchema,
  createAtmSchema,
  updateAtmSchema,
} from "../src/modules/atms/atm.validation.js";

const atmId = "64b000000000000000000001";
const atm2Id = "64b000000000000000000005";
const atm3Id = "64b000000000000000000006";
const employeeAId = "64b000000000000000000002";
const employeeBId = "64b000000000000000000003";
const employeeCId = "64b000000000000000000007";
const employeeDId = "64b000000000000000000008";
const actorId = "64b000000000000000000004";

const matchesId = (left, right) =>
  String(left?._id ?? left).toLowerCase() ===
  String(right?._id ?? right).toLowerCase();

const query = (result) => ({
  session: async () => result,
  select() {
    return this;
  },
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
  const find = (items, id) => items.find((item) => matchesId(item._id, id));

  override(mongoose, "startSession", async () => ({
    withTransaction: async (operation) => {
      state.transactions += 1;
      const atmSnapshot = state.atms.map((atm) => ({
        atm,
        assignedEmployeeId: [...(atm.assignedEmployeeId ?? [])],
        amcResponsibleEmployeeId: atm.amcResponsibleEmployeeId ?? null,
        updatedBy: atm.updatedBy,
      }));
      const employeeSnapshot = state.employees.map((employee) => ({
        employee,
        assignedAtmIds: [...(employee.assignedAtmIds ?? [])],
        updatedBy: employee.updatedBy,
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
          snapshot.employee.assignedAtmIds = snapshot.assignedAtmIds;
          snapshot.employee.updatedBy = snapshot.updatedBy;
        }
        throw error;
      }
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
        filter.$or
          ? filter.$or.some(
              (condition) =>
                condition._id?.$in?.some((id) => matchesId(atm._id, id)) ||
                (condition.assignedEmployeeId &&
                  (atm.assignedEmployeeId ?? []).some((id) =>
                    matchesId(id, condition.assignedEmployeeId),
                  )),
            )
          : filter._id.$in.some((id) => matchesId(atm._id, id)),
      ),
    ),
  );
  override(ATM.prototype, "save", async function () {
    if (failATMSave) throw new Error("ATM save failed");
    return this;
  });

  override(Employee, "findById", (id) =>
    query(find(state.employees, id) ?? null),
  );
  override(Employee, "find", (filter) =>
    query(
      state.employees.filter((employee) =>
        (employee.assignedAtmIds ?? []).some((id) =>
          matchesId(id, filter.assignedAtmIds),
        ),
      ),
    ),
  );
  override(Employee, "findOne", (filter) =>
    query(state.employees.find((employee) => matchesId(employee.userId, filter.userId)) ?? null),
  );
  override(Employee.prototype, "save", async function () {
    return this;
  });
  override(User, "findById", (id) => query(find(state.users, id) ?? null));

  return {
    state,
    restore() {
      for (const [target, key, original] of originals.reverse()) {
        target[key] = original;
      }
    },
  };
}

function makeEmployee(_id, assignedAtmIds = [], userId = _id) {
  return {
    _id,
    status: "active",
    userId,
    assignedAtmIds,
    save: async function () {
      return this;
    },
  };
}

function makeATM(_id = atmId, assignedEmployeeId = [], status = "ACTIVE") {
  return {
    _id,
    atmId: "ATM0001",
    isDeleted: false,
    status,
    assignedEmployeeId,
    amcResponsibleEmployeeId: null,
    save: async function (...args) {
      return ATM.prototype.save.apply(this, args);
    },
  };
}

const employees = () => [
  makeEmployee(employeeAId),
  makeEmployee(employeeBId),
  makeEmployee(employeeCId),
  makeEmployee(employeeDId),
];

const users = () => [
  { _id: employeeAId, userType: "employee", status: "active" },
  { _id: employeeBId, userType: "employee", status: "active" },
  { _id: employeeCId, userType: "employee", status: "active" },
  { _id: employeeDId, userType: "employee", status: "active" },
];

test("ATM assignment validators accept multiple IDs and normalize duplicates", () => {
  const employeeIdsValidator = ATM.schema
    .path("assignedEmployeeId")
    .validators.find((entry) => entry.message.includes("duplicate Employees"));
  const shouldValidateAssignments = { isModified: () => true };
  assert.equal(
    employeeIdsValidator.validator.call(shouldValidateAssignments, [
      new mongoose.Types.ObjectId(employeeAId),
      new mongoose.Types.ObjectId(employeeBId),
    ]),
    true,
  );
  assert.equal(
    employeeIdsValidator.validator.call(shouldValidateAssignments, [
      new mongoose.Types.ObjectId(employeeAId),
      new mongoose.Types.ObjectId(employeeAId),
    ]),
    false,
  );

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
  assert.equal(
    setATMAMCResponsibleEmployeeSchema.safeParse({
      employeeId: employeeAId,
    }).success,
    true,
  );
  assert.equal(
    setATMAMCResponsibleEmployeeSchema.safeParse({ employeeId: null }).success,
    true,
  );
  assert.equal(
    setATMAMCResponsibleEmployeeSchema.safeParse({
      employeeId: "invalid",
    }).success,
    false,
  );

  const payload = {
    bankId: "bank",
    customerId: "customer",
    districtId: "64b000000000000000000010",
    regionId: null,
    locationName: "Location",
    address: "Address",
    installationType: "ONSITE",
    assignedEmployeeId: [employeeAId, employeeBId, employeeAId.toUpperCase()],
  };
  assert.deepEqual(
    createAtmSchema.parse(payload).assignedEmployeeId,
    [employeeAId, employeeBId],
  );
  assert.deepEqual(
    updateAtmSchema.parse({
      assignedEmployeeId: [employeeAId, employeeAId.toUpperCase()],
    }).assignedEmployeeId,
    [employeeAId],
  );
  assert.equal(
    updateAtmSchema.safeParse({ assignedEmployeeId: [employeeAId, "invalid"] })
      .success,
    false,
  );
  assert.equal(
    updateAtmSchema.safeParse({ assignedEmployeeId: employeeAId }).success,
    false,
  );
});

test("general ATM assignment cannot remove or clear its AMC responsible Employee", async (t) => {
  await t.test("individual ATM-side removal", async () => {
    const atm = makeATM(atmId, [employeeAId, employeeBId]);
    atm.amcResponsibleEmployeeId = employeeBId;
    const employeeA = makeEmployee(employeeAId, [atmId]);
    const employeeB = makeEmployee(employeeBId, [atmId]);
    const db = setup({ atms: [atm], employees: [employeeA, employeeB], users: users() });
    try {
      await assert.rejects(
        removeEmployeeFromATM({
          atmId,
          employeeId: employeeBId,
          updatedBy: actorId,
        }),
        /Change or clear AMC responsibility first/,
      );
      assert.deepEqual(atm.assignedEmployeeId, [employeeAId, employeeBId]);
      assert.deepEqual(employeeB.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });

  await t.test("ATM-side full replacement", async () => {
    const atm = makeATM(atmId, [employeeAId, employeeBId]);
    atm.amcResponsibleEmployeeId = employeeBId;
    const employeeA = makeEmployee(employeeAId, [atmId]);
    const employeeB = makeEmployee(employeeBId, [atmId]);
    const db = setup({ atms: [atm], employees: [employeeA, employeeB], users: users() });
    try {
      await assert.rejects(
        replaceATMEmployeeAssignments({
          atmId,
          employeeIds: [employeeAId],
          updatedBy: actorId,
        }),
        /Change or clear AMC responsibility first/,
      );
      assert.deepEqual(atm.assignedEmployeeId, [employeeAId, employeeBId]);
      assert.deepEqual(employeeB.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });

  await t.test("Employee-side ATM replacement", async () => {
    const atm = makeATM(atmId, [employeeAId, employeeBId]);
    atm.amcResponsibleEmployeeId = employeeBId;
    const employeeA = makeEmployee(employeeAId, [atmId]);
    const employeeB = makeEmployee(employeeBId, [atmId]);
    const db = setup({ atms: [atm], employees: [employeeA, employeeB], users: users() });
    try {
      await assert.rejects(
        replaceEmployeeATMAssignments({
          employeeId: employeeBId,
          assignedAtmIds: [],
          updatedBy: actorId,
        }),
        /Change or clear AMC responsibility first/,
      );
      assert.deepEqual(atm.assignedEmployeeId, [employeeAId, employeeBId]);
      assert.deepEqual(employeeB.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });
});

test("adding an Employee to an ATM preserves other assignees and synchronizes both sides", async () => {
  const employeeA = makeEmployee(employeeAId, [atmId]);
  const employeeB = makeEmployee(employeeBId);
  const atm = makeATM(atmId, [employeeAId]);
  const db = setup({ atms: [atm], employees: [employeeA, employeeB], users: users() });
  try {
    const result = await addEmployeeToATM({
      atmId,
      employeeId: employeeBId,
      updatedBy: actorId,
    });
    assert.deepEqual(result.assignedEmployeeId, [employeeAId, employeeBId]);
    assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    assert.deepEqual(employeeB.assignedAtmIds, [atmId]);
    assert.equal(db.state.transactions, 1);
  } finally {
    db.restore();
  }
});

test("removing one Employee preserves unrelated ATM assignments", async () => {
  const employeeA = makeEmployee(employeeAId, [atmId]);
  const employeeB = makeEmployee(employeeBId, [atmId]);
  const employeeC = makeEmployee(employeeCId, [atmId]);
  const atm = makeATM(atmId, [employeeAId, employeeBId, employeeCId]);
  const db = setup({
    atms: [atm],
    employees: [employeeA, employeeB, employeeC],
    users: users(),
  });
  try {
    await removeEmployeeFromATM({
      atmId,
      employeeId: employeeBId,
      updatedBy: actorId,
    });
    assert.deepEqual(atm.assignedEmployeeId, [employeeAId, employeeCId]);
    assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    assert.deepEqual(employeeB.assignedAtmIds, []);
    assert.deepEqual(employeeC.assignedAtmIds, [atmId]);
  } finally {
    db.restore();
  }
});

test("adding the same Employee repeatedly is idempotent", async () => {
  const employeeA = makeEmployee(employeeAId, [atmId]);
  const employeeB = makeEmployee(employeeBId, [atmId]);
  const atm = makeATM(atmId, [employeeAId, employeeBId, employeeBId]);
  const db = setup({ atms: [atm], employees: [employeeA, employeeB], users: users() });
  try {
    await addEmployeeToATM({ atmId, employeeId: employeeBId, updatedBy: actorId });
    await addEmployeeToATM({ atmId, employeeId: employeeBId, updatedBy: actorId });
    assert.deepEqual(atm.assignedEmployeeId, [employeeAId, employeeBId]);
    assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    assert.deepEqual(employeeB.assignedAtmIds, [atmId]);
  } finally {
    db.restore();
  }
});

test("replacing an ATM employee list updates only removed and added reciprocals", async () => {
  const employeeA = makeEmployee(employeeAId, [atmId]);
  const employeeB = makeEmployee(employeeBId, [atmId]);
  const employeeC = makeEmployee(employeeCId, [atmId]);
  const employeeD = makeEmployee(employeeDId);
  const atm = makeATM(atmId, [employeeAId, employeeBId, employeeCId]);
  const db = setup({
    atms: [atm],
    employees: [employeeA, employeeB, employeeC, employeeD],
    users: users(),
  });
  try {
    await replaceATMEmployeeAssignments({
      atmId,
      employeeIds: [employeeAId, employeeDId],
      updatedBy: actorId,
    });
    assert.deepEqual(atm.assignedEmployeeId, [employeeAId, employeeDId]);
    assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    assert.deepEqual(employeeB.assignedAtmIds, []);
    assert.deepEqual(employeeC.assignedAtmIds, []);
    assert.deepEqual(employeeD.assignedAtmIds, [atmId]);
  } finally {
    db.restore();
  }
});

test("Employee-side replacement can share an ATM with existing employees", async () => {
  const atm = makeATM(atmId, [employeeAId]);
  const employeeA = makeEmployee(employeeAId, [atmId]);
  const employeeB = makeEmployee(employeeBId);
  const db = setup({ atms: [atm], employees: [employeeA, employeeB], users: users() });
  try {
    await replaceEmployeeATMAssignments({
      employeeId: employeeBId,
      assignedAtmIds: [atmId],
      updatedBy: actorId,
    });
    assert.deepEqual(atm.assignedEmployeeId, [employeeAId, employeeBId]);
    assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    assert.deepEqual(employeeB.assignedAtmIds, [atmId]);
  } finally {
    db.restore();
  }
});

test("Employee-side replacement removes and adds only that Employee's links", async () => {
  const atm1 = makeATM(atmId, [employeeAId, employeeBId]);
  const atm2 = makeATM(atm2Id, [employeeBId]);
  const atm3 = makeATM(atm3Id, [employeeAId]);
  const employeeA = makeEmployee(employeeAId, [atmId, atm3Id]);
  const employeeB = makeEmployee(employeeBId, [atmId, atm2Id]);
  const db = setup({
    atms: [atm1, atm2, atm3],
    employees: [employeeA, employeeB],
    users: users(),
  });
  try {
    await replaceEmployeeATMAssignments({
      employeeId: employeeBId,
      assignedAtmIds: [atm2Id, atm3Id],
      updatedBy: actorId,
    });
    assert.deepEqual(employeeB.assignedAtmIds, [atm2Id, atm3Id]);
    assert.deepEqual(atm1.assignedEmployeeId, [employeeAId]);
    assert.deepEqual(atm2.assignedEmployeeId, [employeeBId]);
    assert.deepEqual(atm3.assignedEmployeeId, [employeeAId, employeeBId]);
    assert.deepEqual(employeeA.assignedAtmIds, [atmId, atm3Id]);
  } finally {
    db.restore();
  }
});

test("transaction failure rolls back both sides of a reciprocal update", async () => {
  const atm = makeATM(atmId, [employeeAId]);
  const employeeA = makeEmployee(employeeAId, [atmId]);
  const employeeB = makeEmployee(employeeBId);
  const db = setup({
    atms: [atm],
    employees: [employeeA, employeeB],
    users: users(),
    failATMSave: true,
  });
  try {
    await assert.rejects(
      replaceEmployeeATMAssignments({
        employeeId: employeeBId,
        assignedAtmIds: [atmId],
        updatedBy: actorId,
      }),
      /ATM save failed/,
    );
    assert.deepEqual(atm.assignedEmployeeId, [employeeAId]);
    assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    assert.deepEqual(employeeB.assignedAtmIds, []);
  } finally {
    db.restore();
  }
});

test("rejects missing and inactive Employees without changing either side", async (t) => {
  await t.test("missing Employee", async () => {
    const atm = makeATM();
    const db = setup({ atms: [atm] });
    try {
      await assert.rejects(
        addEmployeeToATM({ atmId, employeeId: employeeAId, updatedBy: actorId }),
        (error) => error.statusCode === 404,
      );
      assert.deepEqual(atm.assignedEmployeeId, []);
    } finally {
      db.restore();
    }
  });

  await t.test("inactive Employee", async () => {
    const atm = makeATM();
    const employeeA = makeEmployee(employeeAId);
    employeeA.status = "inactive";
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await assert.rejects(
        addEmployeeToATM({ atmId, employeeId: employeeAId, updatedBy: actorId }),
        (error) => error.statusCode === 400,
      );
      assert.deepEqual(atm.assignedEmployeeId, []);
      assert.deepEqual(employeeA.assignedAtmIds, []);
    } finally {
      db.restore();
    }
  });

  await t.test("missing ATM", async () => {
    const employeeA = makeEmployee(employeeAId);
    const db = setup({ employees: [employeeA], users: users() });
    try {
      await assert.rejects(
        addEmployeeToATM({ atmId, employeeId: employeeAId, updatedBy: actorId }),
        (error) => error.statusCode === 404,
      );
      assert.deepEqual(employeeA.assignedAtmIds, []);
    } finally {
      db.restore();
    }
  });
});

test("new Employee assignments require an ACTIVE ATM", async (t) => {
  await t.test("assignment to an active ATM succeeds reciprocally", async () => {
    const atm = makeATM();
    const employeeA = makeEmployee(employeeAId);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await addEmployeeToATM({
        atmId,
        employeeId: employeeAId,
        updatedBy: actorId,
      });
      assert.deepEqual(atm.assignedEmployeeId, [employeeAId]);
      assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });

  await t.test("adding to an inactive ATM is rejected", async () => {
    const atm = makeATM(atmId, [], "INACTIVE");
    const employeeA = makeEmployee(employeeAId);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await assert.rejects(
        addEmployeeToATM({
          atmId,
          employeeId: employeeAId,
          updatedBy: actorId,
        }),
        {
          statusCode: 400,
          message: "New Employee assignments require an ACTIVE ATM",
        },
      );
      assert.deepEqual(atm.assignedEmployeeId, []);
      assert.deepEqual(employeeA.assignedAtmIds, []);
    } finally {
      db.restore();
    }
  });

  await t.test("ATM-side replacement rejects a new inactive-ATM assignment", async () => {
    const atm = makeATM(atmId, [employeeBId], "INACTIVE");
    const employeeA = makeEmployee(employeeAId);
    const employeeB = makeEmployee(employeeBId, [atmId]);
    const db = setup({
      atms: [atm],
      employees: [employeeA, employeeB],
      users: users(),
    });
    try {
      await assert.rejects(
        replaceATMEmployeeAssignments({
          atmId,
          employeeIds: [employeeAId],
          updatedBy: actorId,
        }),
        {
          statusCode: 400,
          message: "New Employee assignments require an ACTIVE ATM",
        },
      );
      assert.deepEqual(atm.assignedEmployeeId, [employeeBId]);
      assert.deepEqual(employeeA.assignedAtmIds, []);
      assert.deepEqual(employeeB.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });
});

test("direct add retains either one-sided legacy reference on an inactive ATM", async (t) => {
  await t.test("Employee-only reference is recognized and synchronized", async () => {
    const atm = makeATM(atmId, [], "INACTIVE");
    const employeeA = makeEmployee(employeeAId, [atmId]);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await addEmployeeToATM({
        atmId,
        employeeId: employeeAId,
        updatedBy: actorId,
      });
      assert.deepEqual(atm.assignedEmployeeId, [employeeAId]);
      assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });

  await t.test("ATM-only reference is recognized and synchronized", async () => {
    const atm = makeATM(atmId, [employeeAId], "INACTIVE");
    const employeeA = makeEmployee(employeeAId);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await addEmployeeToATM({
        atmId,
        employeeId: employeeAId,
        updatedBy: actorId,
      });
      assert.deepEqual(atm.assignedEmployeeId, [employeeAId]);
      assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });
});

test("inactive-ATM assignments can be retained or removed by Employee-side replacement", async (t) => {
  await t.test("retaining an existing assignment succeeds", async () => {
    const atm = makeATM(atmId, [employeeAId], "INACTIVE");
    const employeeA = makeEmployee(employeeAId, [atmId]);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await replaceEmployeeATMAssignments({
        employeeId: employeeAId,
        assignedAtmIds: [atmId],
        updatedBy: actorId,
      });
      assert.deepEqual(atm.assignedEmployeeId, [employeeAId]);
      assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });

  await t.test("removing an existing assignment succeeds when AMC allows it", async () => {
    const atm = makeATM(atmId, [employeeAId], "INACTIVE");
    const employeeA = makeEmployee(employeeAId, [atmId]);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await replaceEmployeeATMAssignments({
        employeeId: employeeAId,
        assignedAtmIds: [],
        updatedBy: actorId,
      });
      assert.deepEqual(atm.assignedEmployeeId, []);
      assert.deepEqual(employeeA.assignedAtmIds, []);
    } finally {
      db.restore();
    }
  });
});

test("one-sided legacy references are reconciled safely on explicit replacement", async (t) => {
  await t.test("Employee-side reference can be retained on an inactive ATM", async () => {
    const atm = makeATM(atmId, [], "INACTIVE");
    const employeeA = makeEmployee(employeeAId, [atmId]);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await replaceEmployeeATMAssignments({
        employeeId: employeeAId,
        assignedAtmIds: [atmId],
        updatedBy: actorId,
      });
      assert.deepEqual(atm.assignedEmployeeId, [employeeAId]);
      assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });

  await t.test("ATM-side reference can be retained on an inactive ATM", async () => {
    const atm = makeATM(atmId, [employeeAId], "INACTIVE");
    const employeeA = makeEmployee(employeeAId);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await replaceATMEmployeeAssignments({
        atmId,
        employeeIds: [employeeAId],
        updatedBy: actorId,
      });
      assert.deepEqual(atm.assignedEmployeeId, [employeeAId]);
      assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });

  await t.test("Employee-side replacement removes a stale ATM-only reference", async () => {
    const atm = makeATM(atmId, [employeeAId], "INACTIVE");
    const employeeA = makeEmployee(employeeAId);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await replaceEmployeeATMAssignments({
        employeeId: employeeAId,
        assignedAtmIds: [],
        updatedBy: actorId,
      });
      assert.deepEqual(atm.assignedEmployeeId, []);
      assert.deepEqual(employeeA.assignedAtmIds, []);
    } finally {
      db.restore();
    }
  });

  await t.test("Employee-side replacement removes a stale Employee-only reference", async () => {
    const atm = makeATM(atmId, [], "INACTIVE");
    const employeeA = makeEmployee(employeeAId, [atmId]);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await replaceEmployeeATMAssignments({
        employeeId: employeeAId,
        assignedAtmIds: [],
        updatedBy: actorId,
      });
      assert.deepEqual(atm.assignedEmployeeId, []);
      assert.deepEqual(employeeA.assignedAtmIds, []);
    } finally {
      db.restore();
    }
  });

  await t.test("ATM-side removal clears stale Employee-only references", async () => {
    const atm = makeATM(atmId, [], "INACTIVE");
    const employeeA = makeEmployee(employeeAId, [atmId]);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await replaceATMEmployeeAssignments({
        atmId,
        employeeIds: [],
        updatedBy: actorId,
      });
      assert.deepEqual(atm.assignedEmployeeId, []);
      assert.deepEqual(employeeA.assignedAtmIds, []);
    } finally {
      db.restore();
    }
  });

  await t.test("AMC responsibility still blocks removal of a stale one-sided reference", async () => {
    const atm = makeATM(atmId, [], "INACTIVE");
    atm.amcResponsibleEmployeeId = employeeAId;
    const employeeA = makeEmployee(employeeAId, [atmId]);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await assert.rejects(
        replaceATMEmployeeAssignments({
          atmId,
          employeeIds: [],
          updatedBy: actorId,
        }),
        /Change or clear AMC responsibility first/,
      );
      assert.deepEqual(atm.assignedEmployeeId, []);
      assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });
});

test("mixed replacement with a new inactive-ATM assignment leaves all assignment references unchanged", async () => {
  const activeAtm = makeATM(atmId);
  const inactiveAtm = makeATM(atm2Id, [], "UNDER_MAINTENANCE");
  const employeeA = makeEmployee(employeeAId);
  const db = setup({
    atms: [activeAtm, inactiveAtm],
    employees: [employeeA],
    users: users(),
  });
  try {
    await assert.rejects(
      replaceEmployeeATMAssignments({
        employeeId: employeeAId,
        assignedAtmIds: [atmId, atm2Id],
        updatedBy: actorId,
      }),
      {
        statusCode: 400,
        message: "New Employee assignments require an ACTIVE ATM",
      },
    );
    assert.deepEqual(employeeA.assignedAtmIds, []);
    assert.deepEqual(activeAtm.assignedEmployeeId, []);
    assert.deepEqual(inactiveAtm.assignedEmployeeId, []);
  } finally {
    db.restore();
  }
});

test("inactive linked Users are still rejected for new ATM assignments", async () => {
  const atm = makeATM();
  const employeeA = makeEmployee(employeeAId);
  const inactiveUser = {
    _id: employeeAId,
    userType: "employee",
    status: "inactive",
  };
  const db = setup({
    atms: [atm],
    employees: [employeeA],
    users: [inactiveUser],
  });
  try {
    await assert.rejects(
      addEmployeeToATM({
        atmId,
        employeeId: employeeAId,
        updatedBy: actorId,
      }),
      { statusCode: 400, message: "Employee is inactive" },
    );
    assert.deepEqual(atm.assignedEmployeeId, []);
    assert.deepEqual(employeeA.assignedAtmIds, []);
  } finally {
    db.restore();
  }
});

test("assignment relationships use Employee document IDs, distinct from linked User IDs", async () => {
  const linkedUserId = "64b000000000000000000009";
  const atm = makeATM();
  const employeeA = makeEmployee(employeeAId, [], linkedUserId);
  const linkedUser = {
    _id: linkedUserId,
    userType: "employee",
    status: "active",
  };
  const db = setup({
    atms: [atm],
    employees: [employeeA],
    users: [linkedUser],
  });
  try {
    await addEmployeeToATM({
      atmId,
      employeeId: employeeAId,
      updatedBy: actorId,
    });
    assert.deepEqual(atm.assignedEmployeeId, [employeeAId]);
    assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    assert.equal(
      atm.assignedEmployeeId.some((id) => matchesId(id, linkedUserId)),
      false,
    );
  } finally {
    db.restore();
  }
});

test("inactive-ATM assignment replacement retains protected AMC assignments and rejects their removal", async (t) => {
  await t.test("retaining the responsible Employee succeeds", async () => {
    const atm = makeATM(atmId, [employeeAId], "INACTIVE");
    atm.amcResponsibleEmployeeId = employeeAId;
    const employeeA = makeEmployee(employeeAId, [atmId]);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await replaceATMEmployeeAssignments({
        atmId,
        employeeIds: [employeeAId],
        updatedBy: actorId,
      });
      assert.deepEqual(atm.assignedEmployeeId, [employeeAId]);
      assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });

  await t.test("removing the responsible Employee is still rejected", async () => {
    const atm = makeATM(atmId, [employeeAId], "INACTIVE");
    atm.amcResponsibleEmployeeId = employeeAId;
    const employeeA = makeEmployee(employeeAId, [atmId]);
    const db = setup({ atms: [atm], employees: [employeeA], users: users() });
    try {
      await assert.rejects(
        replaceEmployeeATMAssignments({
          employeeId: employeeAId,
          assignedAtmIds: [],
          updatedBy: actorId,
        }),
        /Change or clear AMC responsibility first/,
      );
      assert.deepEqual(atm.assignedEmployeeId, [employeeAId]);
      assert.deepEqual(employeeA.assignedAtmIds, [atmId]);
    } finally {
      db.restore();
    }
  });
});
