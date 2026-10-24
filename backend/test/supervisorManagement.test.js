import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import User from "../src/modules/users/user.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import ATM from "../src/modules/atms/atm.model.js";
import userRoutes from "../src/modules/users/user.routes.js";
import {
  createSupervisor,
  getSupervisorManagementDetails,
  getSupervisorManagementList,
  updateSupervisor,
  updateSupervisorStatus,
} from "../src/modules/users/user.controller.js";
import {
  createSupervisorSchema,
  supervisorIdParamsSchema,
  supervisorManagementQuerySchema,
  supervisorStatusSchema,
  updateSupervisorSchema,
} from "../src/modules/users/user.validate.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";

const adminId = "64b000000000000000000001";
const supervisorId = "64b000000000000000000002";

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

const supervisorDocument = (overrides = {}) => ({
  _id: supervisorId,
  firstName: "Sam",
  lastName: "Supervisor",
  email: "sam@example.test",
  phoneNumber: "5550100000",
  password: "hashed",
  userType: "supervisor",
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  toObject() {
    return { ...this };
  },
  async save() {},
  ...overrides,
});

const withOverrides = async (overrides, callback) => {
  const originals = overrides.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    await callback();
  } finally {
    for (const [target, key, value] of originals.reverse()) {
      target[key] = value;
    }
  }
};

test("supervisor management validation rejects role overrides and invalid account data", () => {
  const valid = {
    firstName: "Sam",
    lastName: "Supervisor",
    email: "sam@example.test",
    password: "password123",
    phoneNumber: "5550100000",
  };
  assert.equal(createSupervisorSchema.safeParse(valid).success, true);
  assert.equal(
    createSupervisorSchema.safeParse({ ...valid, userType: "admin" }).success,
    false,
  );
  assert.equal(
    createSupervisorSchema.safeParse({ ...valid, email: "invalid" }).success,
    false,
  );
  assert.equal(
    updateSupervisorSchema.safeParse({ email: "invalid" }).success,
    false,
  );
  assert.equal(
    updateSupervisorSchema.safeParse({ firstName: "Sam", role: "admin" })
      .success,
    false,
  );
  assert.equal(
    supervisorManagementQuerySchema.safeParse({
      search: "Sam",
      page: "2",
      limit: "10",
    }).success,
    true,
  );
  assert.equal(
    supervisorManagementQuerySchema.safeParse({ limit: "101" }).success,
    false,
  );
  assert.equal(
    supervisorIdParamsSchema.safeParse({ id: "bad-id" }).success,
    false,
  );
  assert.equal(
    supervisorStatusSchema.safeParse({ status: "blocked" }).success,
    false,
  );
});

test("supervisor CRUD routes require authentication and Admin roles", () => {
  const routes = [
    ["/supervisor-management", "get"],
    ["/supervisor-management", "post"],
    ["/supervisor-management/:id", "get"],
    ["/supervisor-management/:id", "put"],
    ["/supervisor-management/:id/status", "patch"],
  ];
  for (const [path, method] of routes) {
    const route = userRoutes.stack.find(
      (layer) => layer.route?.path === path && layer.route.methods[method],
    )?.route;
    assert.ok(route, `${method.toUpperCase()} ${path}`);
    assert.equal(route.stack[0].handle, verifyAccessToken);
    const authorize = route.stack[1].handle;
    for (const userType of ["admin", "superAdmin"]) {
      assert.doesNotThrow(() =>
        authorize({ user: { userType } }, {}, () => {}),
      );
    }
    for (const userType of ["employee", "supervisor", "customer"]) {
      assert.throws(
        () => authorize({ user: { userType } }, {}, () => {}),
        { statusCode: 403 },
      );
    }
    assert.throws(() => authorize({}, {}, () => {}), { statusCode: 401 });
  }
});

test("supervisor creation assigns the Supervisor role on the backend and hashes the password", async () => {
  const created = [];
  const document = supervisorDocument();
  await withOverrides(
    [
      [
        User,
        "findOne",
        () => ({
          select: async () => null,
        }),
      ],
      [
        User,
        "create",
        async (payload) => {
          created.push(payload);
          return document;
        },
      ],
    ],
    async () => {
      const result = await invoke(createSupervisor, {
        user: { _id: adminId, userType: "admin" },
        body: {
          firstName: "Sam",
          lastName: "Supervisor",
          email: "SAM@example.test",
          password: "password123",
          phoneNumber: "5550100000",
        },
      });
      assert.equal(result.status, 201);
      assert.equal(created[0].userType, "supervisor");
      assert.equal(created[0].email, "sam@example.test");
      assert.notEqual(created[0].password, "password123");
      assert.equal(result.body.data.supervisor.password, undefined);
    },
  );
});

test("supervisor create prevents duplicates even when the unique index catches a race", async () => {
  const duplicate = supervisorDocument();
  await withOverrides(
    [
      [
        User,
        "findOne",
        () => ({
          select: async () => duplicate,
        }),
      ],
    ],
    async () => {
      await assert.rejects(
        invoke(createSupervisor, {
          user: { _id: adminId, userType: "admin" },
          body: {
            firstName: "Sam",
            email: "sam@example.test",
            password: "password123",
            phoneNumber: "5550100000",
          },
        }),
        (error) => error.statusCode === 409,
      );
    },
  );

  await withOverrides(
    [
      [
        User,
        "findOne",
        () => ({
          select: async () => null,
        }),
      ],
      [User, "create", async () => {
        throw { code: 11000 };
      }],
    ],
    async () => {
      await assert.rejects(
        invoke(createSupervisor, {
          user: { _id: adminId, userType: "admin" },
          body: {
            firstName: "Sam",
            email: "sam@example.test",
            password: "password123",
            phoneNumber: "5550100000",
          },
        }),
        (error) => error.statusCode === 409,
      );
    },
  );
});

test("supervisor listing searches, paginates, and includes team counts", async () => {
  const document = supervisorDocument();
  const query = {
    select() {
      return this;
    },
    sort() {
      return this;
    },
    skip(value) {
      assert.equal(value, 10);
      return this;
    },
    limit(value) {
      assert.equal(value, 10);
      return Promise.resolve([document]);
    },
  };
  const aggregatePipeline = [];
  await withOverrides(
    [
      [
        User,
        "find",
        (filter) => {
          assert.equal(filter.userType, "supervisor");
          assert.match(filter.$or[0].firstName.$regex, /Sam/);
          return query;
        },
      ],
      [User, "countDocuments", async () => 21],
      [
        Employee,
        "aggregate",
        async (pipeline) => {
          aggregatePipeline.push(pipeline);
          return [{ _id: supervisorId, count: 4 }];
        },
      ],
    ],
    async () => {
      const result = await invoke(getSupervisorManagementList, {
        user: { _id: adminId, userType: "admin" },
        validatedQuery: { search: "Sam", page: 2, limit: 10 },
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.data.supervisors[0].teamCount, 4);
      assert.deepEqual(result.body.data.pagination, {
        page: 2,
        limit: 10,
        total: 21,
        totalPages: 3,
      });
      assert.deepEqual(aggregatePipeline[0][0].$match.supervisorId.$in, [
        supervisorId,
      ]);
    },
  );
});

test("supervisor detail, update, and activation are restricted to supervisor accounts", async () => {
  const document = supervisorDocument();
  let saved = 0;
  document.save = async () => {
    saved += 1;
  };
  await withOverrides(
    [
      [
        User,
        "findOne",
        (filter) => {
          if (filter.$or) {
            return { select: async () => null };
          }
          return {
            select() {
              return this;
            },
            then(resolve, reject) {
              return Promise.resolve(document).then(resolve, reject);
            },
          };
        },
      ],
      [Employee, "countDocuments", async () => 3],
    ],
    async () => {
      const detail = await invoke(getSupervisorManagementDetails, {
        validatedParams: { id: supervisorId },
      });
      assert.equal(detail.body.data.supervisor.teamCount, 3);

      const update = await invoke(updateSupervisor, {
        validatedParams: { id: supervisorId },
        body: { firstName: "Updated" },
      });
      assert.equal(update.body.data.supervisor.firstName, "Updated");
      assert.equal(saved, 1);

      const activation = await invoke(updateSupervisorStatus, {
        validatedParams: { id: supervisorId },
        body: { status: "active" },
        user: { _id: adminId, userType: "admin" },
      });
      assert.equal(activation.body.data.supervisor.status, "active");
      assert.equal(saved, 2);
    },
  );
});

test("supervisor team assignments remain stored when account status changes", async () => {
  const originalFindOne = User.findOne;
  const originalStartSession = mongoose.startSession;
  const originalEmployeeFind = Employee.find;
  const originalATMFind = ATM.find;
  const teamSupervisor = supervisorDocument();
  teamSupervisor.save = async function save() {};
  const assignedEmployee = { _id: "existing-employee", supervisorId };
  User.findOne = () => ({
    select() {
      return this;
    },
    session() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(teamSupervisor).then(resolve, reject);
    },
  });
  Employee.find = () => ({
    session: async () => [assignedEmployee],
  });
  ATM.find = () => ({
    session: async () => [],
  });
  mongoose.startSession = async () => ({
    withTransaction: async (operation) => operation({}),
    endSession: async () => {},
  });
  try {
    const result = await invoke(updateSupervisorStatus, {
      validatedParams: { id: supervisorId },
      body: { status: "inactive" },
      user: { _id: adminId, userType: "admin" },
    });
    assert.equal(result.body.data.supervisor.status, "inactive");
    assert.equal(assignedEmployee.supervisorId, supervisorId);
  } finally {
    User.findOne = originalFindOne;
    Employee.find = originalEmployeeFind;
    ATM.find = originalATMFind;
    mongoose.startSession = originalStartSession;
  }
});
