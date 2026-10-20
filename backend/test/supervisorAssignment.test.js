import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Employee from "../src/modules/employees/employee.model.js";
import ATM from "../src/modules/atms/atm.model.js";
import User from "../src/modules/users/user.model.js";
import employeeRoutes from "../src/modules/employees/employee.routes.js";
import userRoutes from "../src/modules/users/user.routes.js";
import {
  createEmployee,
  updateEmployee,
  viewEmployeeById,
} from "../src/modules/employees/employee.controller.js";
import {
  changeUserStatus,
  createUserWizard,
  getSupervisors,
} from "../src/modules/users/user.controller.js";
import {
  createEmployeeSchema,
  employeeIdParamsSchema,
  employeeUserIdParamsSchema,
  updateEmployeeSchema,
} from "../src/modules/employees/employee.validate.js";
import { createUserWizardSchema } from "../src/modules/users/user-wizard.validate.js";

const employeeUserId = "64b000000000000000000001";
const employeeDocumentId = "64b000000000000000000002";
const supervisorId = "64b000000000000000000003";
const otherSupervisorId = "64b000000000000000000004";
const adminId = "64b000000000000000000005";

const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
        return this;
      },
    };
    handler(req, res, reject);
  });

const thenableQuery = (value) => ({
  session() {
    return this;
  },
  select() {
    return this;
  },
  sort() {
    return this;
  },
  populate() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const supervisorLookup = (record) => ({
  select() {
    return thenableQuery(record);
  },
});

const withOverrides = async (overrides, callback) => {
  const originals = overrides.map(([target, key, value]) => [
    target,
    key,
    target[key],
  ]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    await callback();
  } finally {
    for (const [target, key, value] of originals.reverse()) {
      target[key] = value;
    }
  }
};

const employeePayload = {
  designation: "Technician",
  department: "Maintenance",
  joiningDate: "2026-01-01",
  employmentType: "full-time",
  districtIds: [],
};

test("employee assignment schemas accept valid IDs and explicit clearing but reject malformed IDs", () => {
  assert.equal(
    employeeIdParamsSchema.safeParse({ employeeId: employeeDocumentId }).success,
    true,
  );
  assert.equal(
    employeeIdParamsSchema.safeParse({ employeeId: "bad-id" }).success,
    false,
  );
  assert.equal(
    employeeUserIdParamsSchema.safeParse({ userId: "bad-id" }).success,
    false,
  );
  assert.equal(
    createEmployeeSchema.safeParse({
      ...employeePayload,
      supervisorId,
    }).success,
    true,
  );
  assert.equal(
    createEmployeeSchema.safeParse({
      ...employeePayload,
      supervisorId: null,
    }).success,
    true,
  );
  assert.equal(
    updateEmployeeSchema.safeParse({ supervisorId: null }).success,
    true,
  );
  assert.equal(
    updateEmployeeSchema.safeParse({ supervisorId: "not-an-object-id" })
      .success,
    false,
  );
  assert.equal(
    createUserWizardSchema.safeParse({
      user: {
        firstName: "Employee",
        lastName: "Test",
        email: "employee@example.test",
        password: "password123",
        phoneNumber: "5550100000",
      },
      role: "employee",
      employee: {
        ...employeePayload,
        supervisorId: "bad-id",
      },
    }).success,
    false,
  );
});

test("employee assignment routes reject malformed employee and user path IDs", async () => {
  for (const [path, method, params] of [
    ["/create/:userId", "post", { userId: "bad-id" }],
    ["/update/:employeeId", "patch", { employeeId: "bad-id" }],
  ]) {
    const route = employeeRoutes.stack.find(
      (layer) => layer.route?.path === path && layer.route.methods[method],
    )?.route;
    assert.ok(route);
    const paramValidator = route.stack[2].handle;
    const error = await new Promise((resolve) => {
      paramValidator({ params }, {}, resolve);
    });
    assert.equal(error.statusCode, 400);
  }
});

test("admin wizard creates an employee with a valid supervisor assignment", async () => {
  const createdEmployees = [];
  const user = {
    _id: employeeUserId,
    firstName: "Employee",
    lastName: "Test",
    email: "employee@example.test",
    phoneNumber: "5550100000",
    userType: "employee",
    toObject() {
      return { ...this };
    },
  };
  const supervisor = { _id: supervisorId };
  const employee = {
    ...employeePayload,
    supervisorId,
    assignedAtmIds: [],
    regionIds: [],
  };

  await withOverrides(
    [
      [
        User,
        "findOne",
        (filter) =>
          filter.$or ? thenableQuery(null) : supervisorLookup(supervisor),
      ],
      [User, "create", async () => user],
      [User, "findByIdAndDelete", async () => {}],
      [
        Employee,
        "findOne",
        () => ({
          sort() {
            return Promise.resolve(null);
          },
        }),
      ],
      [
        Employee,
        "create",
        async (records) => {
          const entries = Array.isArray(records) ? records : [records];
          createdEmployees.push(...entries.map((record) => ({ ...record })));
          return Array.isArray(records)
            ? entries.map((record) => ({ ...record, _id: employeeDocumentId }))
            : { ...records, _id: employeeDocumentId };
        },
      ],
    ],
    async () => {
      const result = await invoke(createUserWizard, {
        user: { _id: adminId, userType: "admin" },
        body: {
          user: {
            firstName: "Employee",
            lastName: "Test",
            email: "employee@example.test",
            password: "password123",
            phoneNumber: "5550100000",
          },
          role: "employee",
          employee,
        },
      });
      assert.equal(result.status, 201);
      assert.equal(createdEmployees[0].supervisorId, supervisorId);
      assert.equal(createdEmployees[0].userId, employeeUserId);
      assert.equal(result.body.data.role, "employee");
    },
  );
});

test("admin wizard cleans up its new user and safely maps a userId index conflict", async () => {
  const duplicateKeyError = Object.assign(new Error("database index detail"), {
    code: 11000,
    keyPattern: { userId: 1 },
  });
  let userDeleted = false;

  await withOverrides(
    [
      [User, "findOne", () => thenableQuery(null)],
      [
        User,
        "create",
        async () => ({
          _id: employeeUserId,
          firstName: "Employee",
          toObject: () => ({}),
        }),
      ],
      [
        User,
        "findByIdAndDelete",
        async (id) => {
          assert.equal(id, employeeUserId);
          userDeleted = true;
        },
      ],
      [
        Employee,
        "findOne",
        () => ({
          sort() {
            return Promise.resolve(null);
          },
        }),
      ],
      [
        Employee,
        "create",
        async () => {
          throw duplicateKeyError;
        },
      ],
    ],
    async () => {
      await assert.rejects(
        invoke(createUserWizard, {
          user: { _id: adminId, userType: "admin" },
          body: {
            user: {
              firstName: "Employee",
              lastName: "Test",
              email: "employee@example.test",
              password: "password123",
              phoneNumber: "5550100000",
            },
            role: "employee",
            employee: { ...employeePayload, assignedAtmIds: [], regionIds: [] },
          },
        }),
        (error) =>
          error.statusCode === 409 &&
          error.message === "Employee already exists for this user",
      );
      assert.equal(userDeleted, true);
    },
  );
});

test("admin wizard rejects an ID that does not identify a supervisor", async () => {
  let createdUser = false;
  let createdEmployee = false;
  await withOverrides(
    [
      [User, "findOne", (filter) => filter.$or ? thenableQuery(null) : supervisorLookup(null)],
      [
        User,
        "create",
        async () => {
          createdUser = true;
          return { _id: employeeUserId, toObject: () => ({}) };
        },
      ],
      [User, "findByIdAndDelete", async () => {}],
      [
        Employee,
        "findOne",
        () => ({
          sort() {
            return Promise.resolve(null);
          },
        }),
      ],
      [
        Employee,
        "create",
        async () => {
          createdEmployee = true;
          return [];
        },
      ],
    ],
    async () => {
      await assert.rejects(
        invoke(createUserWizard, {
          user: { _id: adminId, userType: "admin" },
          body: {
            user: {
              firstName: "Employee",
              lastName: "Test",
              email: "employee@example.test",
              password: "password123",
              phoneNumber: "5550100000",
            },
            role: "employee",
            employee: {
              ...employeePayload,
              supervisorId,
              assignedAtmIds: [],
              regionIds: [],
            },
          },
        }),
        (error) =>
          error.statusCode === 400 &&
          error.message === "Supervisor must be an active supervisor user",
      );
      assert.equal(createdUser, false);
      assert.equal(createdEmployee, false);
    },
  );
});

test("legacy employee creation stores a valid supervisor and defaults an omitted assignment to null", async () => {
  const created = [];
  const employeeUser = { _id: employeeUserId, userType: "employee", status: "active" };
  const supervisor = { _id: supervisorId };

  await withOverrides(
    [
      [User, "findById", () => thenableQuery(employeeUser)],
      [User, "findOne", () => supervisorLookup(supervisor)],
      [Employee, "findOne", (filter) => filter ? thenableQuery(null) : ({
        sort() {
          return Promise.resolve(null);
        },
      })],
      [
        Employee,
        "create",
        async (record) => {
          created.push(record);
          return record;
        },
      ],
    ],
    async () => {
      const withSupervisor = await invoke(createEmployee, {
        user: { _id: adminId, userType: "admin" },
        params: { userId: employeeUserId },
        body: { ...employeePayload, supervisorId },
      });
      const unassigned = await invoke(createEmployee, {
        user: { _id: adminId, userType: "admin" },
        params: { userId: employeeUserId },
        body: employeePayload,
      });
      assert.equal(withSupervisor.status, 201);
      assert.equal(created[0].supervisorId, supervisorId);
      assert.equal(unassigned.status, 201);
      assert.equal(created[1].supervisorId, null);
    },
  );
});

test("legacy employee creation prevents duplicate employee assignment records", async () => {
  let createCalls = 0;
  await withOverrides(
    [
      [
        User,
        "findById",
        () =>
          thenableQuery({
            _id: employeeUserId,
            userType: "employee",
            status: "active",
          }),
      ],
      [Employee, "findOne", () => thenableQuery({ _id: employeeDocumentId })],
      [
        Employee,
        "create",
        async () => {
          createCalls += 1;
        },
      ],
    ],
    async () => {
      const result = await invoke(createEmployee, {
        user: { _id: adminId, userType: "admin" },
        params: { userId: employeeUserId },
        body: employeePayload,
      });
      assert.equal(result.status, 400);
      assert.equal(createCalls, 0);
    },
  );
});

test("legacy employee creation maps a userId unique-index race to a safe conflict", async () => {
  const duplicateKeyError = Object.assign(new Error("database index detail"), {
    code: 11000,
    keyPattern: { userId: 1 },
  });

  await withOverrides(
    [
      [
        User,
        "findById",
        () =>
          thenableQuery({
            _id: employeeUserId,
            userType: "employee",
            status: "active",
          }),
      ],
      [Employee, "findOne", () => thenableQuery(null)],
      [Employee, "create", async () => {
        throw duplicateKeyError;
      }],
    ],
    async () => {
      await assert.rejects(
        invoke(createEmployee, {
          user: { _id: adminId, userType: "admin" },
          params: { userId: employeeUserId },
          body: employeePayload,
        }),
        (error) =>
          error.statusCode === 409 &&
          error.message === "Employee already exists for this user" &&
          !error.message.includes("database index detail"),
      );
    },
  );
});

test("admin can change and explicitly clear supervisor assignment", async () => {
  const employee = {
    _id: employeeDocumentId,
    userId: employeeUserId,
    status: "active",
    supervisorId: otherSupervisorId,
    async save() {
      return this;
    },
    async populate() {
      return this;
    },
  };
  const queriedSupervisors = [];
  await withOverrides(
    [
      [
        User,
        "findOne",
        (filter) => {
          queriedSupervisors.push(filter._id);
          assert.equal(filter.status, "active");
          return supervisorLookup(
            filter._id === employeeUserId
              ? { _id: employeeUserId }
              : { _id: filter._id },
          );
        },
      ],
      [Employee, "findById", () => thenableQuery(employee)],
    ],
    async () => {
      const changed = await invoke(updateEmployee, {
        user: { _id: adminId, userType: "admin" },
        params: { employeeId: employeeDocumentId },
        body: { supervisorId },
      });
      assert.equal(changed.status, 200);
      assert.equal(employee.supervisorId, supervisorId);

      const cleared = await invoke(updateEmployee, {
        user: { _id: adminId, userType: "admin" },
        params: { employeeId: employeeDocumentId },
        body: { supervisorId: null },
      });
      assert.equal(cleared.status, 200);
      assert.equal(employee.supervisorId, null);
      assert.deepEqual(queriedSupervisors, [employeeUserId, supervisorId]);
    },
  );
});

test("employee update rejects nonexistent or non-supervisor users and non-admin calls", async () => {
  let findByIdCalls = 0;
  await withOverrides(
    [
      [
        User,
        "findOne",
        (filter) =>
          supervisorLookup(
            filter._id === employeeUserId ? { _id: employeeUserId } : null,
          ),
      ],
      [
        Employee,
        "findById",
        () => {
          findByIdCalls += 1;
          return thenableQuery({
            _id: employeeDocumentId,
            userId: employeeUserId,
            status: "active",
            supervisorId: null,
          });
        },
      ],
    ],
    async () => {
      await assert.rejects(
        invoke(updateEmployee, {
          user: { _id: adminId, userType: "admin" },
          params: { employeeId: employeeDocumentId },
          body: { supervisorId },
        }),
        (error) =>
          error.statusCode === 400 &&
          error.message === "Supervisor must be an active supervisor user",
      );
      await assert.rejects(
        invoke(updateEmployee, {
          user: { _id: supervisorId, userType: "supervisor" },
          params: { employeeId: employeeDocumentId },
          body: { supervisorId: null },
        }),
        (error) => error.statusCode === 403,
      );
      assert.equal(findByIdCalls, 1);
    },
  );
});

test("new assignments require an active employee account and active employee record", async () => {
  for (const { employeeStatus, userStatus, expectedMessage } of [
    {
      employeeStatus: "inactive",
      userStatus: "active",
      expectedMessage:
        "Only active employees with active employee accounts can be assigned to a supervisor",
    },
    {
      employeeStatus: "active",
      userStatus: null,
      expectedMessage:
        "Only active employees with active employee accounts can be assigned to a supervisor",
    },
  ]) {
    const employee = {
      _id: employeeDocumentId,
      userId: employeeUserId,
      status: employeeStatus,
      supervisorId: null,
    };
    await withOverrides(
      [
        [Employee, "findById", () => thenableQuery(employee)],
        [
          User,
          "findOne",
          (filter) =>
            filter._id === employeeUserId
              ? supervisorLookup(
                  userStatus ? { _id: employeeUserId } : null,
                )
              : supervisorLookup({ _id: supervisorId }),
        ],
      ],
      async () => {
        await assert.rejects(
          invoke(updateEmployee, {
            user: { _id: adminId, userType: "admin" },
            params: { employeeId: employeeDocumentId },
            body: { supervisorId },
          }),
          (error) =>
            error.statusCode === 400 &&
            error.message === expectedMessage,
        );
        assert.equal(employee.supervisorId, null);
      },
    );
  }
});

test("existing assignments are retained for inactive employees or supervisors", async () => {
  for (const employeeStatus of ["active", "inactive"]) {
    const employee = {
      _id: employeeDocumentId,
      userId: employeeUserId,
      status: employeeStatus,
      supervisorId,
      designation: "Technician",
      async save() {
        return this;
      },
      async populate() {
        return this;
      },
    };
    let findByIdCalls = 0;
    await withOverrides(
      [
        [
          Employee,
          "findById",
          () => {
            findByIdCalls += 1;
            return thenableQuery(employee);
          },
        ],
        [
          User,
          "findOne",
          () => {
            throw new Error("An unchanged assignment must not be revalidated");
          },
        ],
      ],
      async () => {
        const result = await invoke(updateEmployee, {
          user: { _id: adminId, userType: "admin" },
          params: { employeeId: employeeDocumentId },
          body: {
            designation: "Field Technician",
            supervisorId,
          },
        });
        assert.equal(result.status, 200);
        assert.equal(employee.supervisorId, supervisorId);
        assert.equal(findByIdCalls, 2);
      },
    );
  }
});

test("deactivating a supervisor preserves employee assignment references", async () => {
  const supervisor = {
    _id: supervisorId,
    userType: "supervisor",
    status: "active",
    toObject() {
      return { _id: this._id, userType: this.userType, status: this.status };
    },
    async save() {
      return this;
    },
  };
  const assignedEmployee = {
    _id: employeeDocumentId,
    userId: employeeUserId,
    supervisorId,
  };
  const session = {
    async withTransaction(operation) {
      return operation(this);
    },
    async endSession() {},
  };

  await withOverrides(
    [
      [mongoose, "startSession", async () => session],
      [User, "findById", () => thenableQuery(supervisor)],
      [
        Employee,
        "find",
        (filter) =>
          thenableQuery(
            filter.userId === employeeUserId ? [assignedEmployee] : [],
          ),
      ],
      [ATM, "find", () => thenableQuery([])],
    ],
    async () => {
      const result = await invoke(changeUserStatus, {
        params: { id: supervisorId },
        body: { status: "inactive" },
        user: { _id: adminId, userType: "admin" },
      });
      assert.equal(result.status, 200);
      assert.equal(supervisor.status, "inactive");
      assert.equal(assignedEmployee.supervisorId, supervisorId);
    },
  );
});

test("employee creation rejects non-supervisor assignment", async () => {
  await withOverrides(
    [
      [
        User,
        "findById",
        () => thenableQuery({
          _id: employeeUserId,
          userType: "employee",
          status: "active",
        }),
      ],
      [Employee, "findOne", () => thenableQuery(null)],
      [User, "findOne", () => supervisorLookup(null)],
    ],
    async () => {
      await assert.rejects(
        invoke(createEmployee, {
          user: { _id: adminId, userType: "admin" },
          params: { userId: employeeUserId },
          body: { ...employeePayload, supervisorId },
        }),
        (error) =>
          error.statusCode === 400 &&
          error.message === "Supervisor must be an active supervisor user",
      );
    },
  );
});

test("employee and supervisor roles cannot access employee assignment routes or supervisor options", () => {
  for (const [router, path, method] of [
    [employeeRoutes, "/create/:userId", "post"],
    [employeeRoutes, "/update/:employeeId", "patch"],
    [userRoutes, "/supervisors", "get"],
    [userRoutes, "/wizard", "post"],
  ]) {
    const route = router.stack.find(
      (layer) => layer.route?.path === path && layer.route.methods[method],
    )?.route;
    assert.ok(route, `${method.toUpperCase()} ${path} route exists`);
    const authorize = route.stack[1].handle;
    for (const userType of ["employee", "supervisor"]) {
      assert.throws(
        () => authorize({ user: { userType } }, {}, () => {}),
        { statusCode: 403 },
      );
    }
  }
});

test("supervisor options endpoint is admin-only and returns only supervisor records", async () => {
  const route = userRoutes.stack.find(
    (layer) => layer.route?.path === "/supervisors",
  )?.route;
  assert.ok(route);
  const authorize = route.stack[1].handle;
  for (const userType of ["admin", "superAdmin"]) {
    let called = false;
    authorize({ user: { userType } }, {}, () => {
      called = true;
    });
    assert.equal(called, true);
  }

  let projection;
  const originalFind = User.find;
  User.find = (filter) => {
    assert.deepEqual(filter, { userType: "supervisor", status: "active" });
    return {
      select(value) {
        projection = value;
        return this;
      },
      sort() {
        return Promise.resolve([{ _id: supervisorId, firstName: "Sam" }]);
      },
    };
  };
  try {
    const result = await invoke(getSupervisors, {
      user: { _id: adminId, userType: "admin" },
    });
    assert.equal(result.status, 200);
    assert.equal(projection, "_id firstName lastName email status");
    assert.equal(result.body.data.supervisors[0]._id, supervisorId);
  } finally {
    User.find = originalFind;
  }
});

test("employee detail populates a safe supervisor display name and tolerates missing references", async () => {
  const capture = {};
  const supervisor = {
    _id: supervisorId,
    firstName: "Sam",
    lastName: "Supervisor",
    email: "sam@example.test",
    userType: "supervisor",
  };
  const employee = {
    _id: employeeDocumentId,
    userId: { _id: employeeUserId, firstName: "Employee" },
    districtIds: [],
    regionIds: [],
    assignedAtmIds: [],
    supervisorId: supervisorId,
    async populate(paths) {
      capture.paths = paths;
      this.supervisorId = supervisor;
      return this;
    },
    toObject() {
      return {
        _id: this._id,
        userId: this.userId,
        districtIds: this.districtIds,
        regionIds: this.regionIds,
        assignedAtmIds: this.assignedAtmIds,
        supervisorId: this.supervisorId,
      };
    },
  };
  const originalFindById = Employee.findById;
  Employee.findById = () => thenableQuery(employee);
  try {
    const result = await invoke(viewEmployeeById, {
      params: { employeeId: employeeDocumentId },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(capture.paths.at(-1), {
      path: "supervisorId",
      select: "firstName lastName email userType",
    });
    assert.equal(result.body.data.supervisorId, supervisorId);
    assert.equal(result.body.data.supervisor.firstName, "Sam");

    employee.populate = async function (paths) {
      capture.paths = paths;
      this.supervisorId = null;
      return this;
    };
    const missing = await invoke(viewEmployeeById, {
      params: { employeeId: employeeDocumentId },
    });
    assert.equal(missing.status, 200);
    assert.equal(missing.body.data.supervisorId, supervisorId);
    assert.equal(missing.body.data.supervisor, null);
  } finally {
    Employee.findById = originalFindById;
  }
});
