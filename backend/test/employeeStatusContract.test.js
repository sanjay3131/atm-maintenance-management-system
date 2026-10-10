import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { authorizeRoles } from "../src/middlewares/role.middleware.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";
import { loginUser } from "../src/modules/auth/auth.controller.js";
import ATM from "../src/modules/atms/atm.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import { updateEmployee } from "../src/modules/employees/employee.controller.js";
import User from "../src/modules/users/user.model.js";
import { changeUserStatus } from "../src/modules/users/user.controller.js";
import { changeUserStatusSchema } from "../src/modules/users/user.validate.js";
import { updateEmployeeSchema } from "../src/modules/employees/employee.validate.js";

const userId = "64b000000000000000000001";
const employeeId = "64b000000000000000000002";
const atmId = "64b000000000000000000003";
const adminId = "64b000000000000000000004";

const makeQuery = (value) => ({
  session() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
    };
    handler(req, res, reject);
  });

const captureError = async (handler, req) => {
  try {
    await invoke(handler, req);
    assert.fail("Expected handler to reject");
  } catch (error) {
    return error;
  }
};

const withOverrides = async (overrides, callback) => {
  const originals = overrides.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, replacement] of overrides) {
    target[key] = replacement;
  }
  try {
    await callback();
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
};

const makeRecords = ({ amcResponsibleEmployeeId = null } = {}) => {
  const employee = {
    _id: employeeId,
    userId,
    status: "active",
    assignedAtmIds: [atmId],
    updatedBy: null,
    async save() {
      return this;
    },
    async populate() {
      return this;
    },
  };
  const user = {
    _id: userId,
    userType: "employee",
    status: "active",
    toObject() {
      return { _id: this._id, userType: this.userType, status: this.status };
    },
    async save() {
      return this;
    },
  };
  const atm = {
    _id: atmId,
    assignedEmployeeId: [employeeId],
    amcResponsibleEmployeeId,
    updatedBy: null,
    async save() {
      return this;
    },
  };
  const history = { performedBy: userId };
  const job = { assignedEmployeeId: userId };
  const recurringPlan = { assignedEmployeeId: employeeId };
  const amcRecord = { employeeId: userId };

  return {
    employee,
    user,
    atm,
    history,
    job,
    recurringPlan,
    amcRecord,
    deleteCalls: [],
  };
};

const withStatusMocks = async (records, callback) => {
  const session = {
    async withTransaction(operation) {
      return operation(this);
    },
    async endSession() {},
  };
  const overrides = [
    [mongoose, "startSession", async () => session],
    [Employee, "findById", () => makeQuery(records.employee)],
    [Employee, "find", () => makeQuery([records.employee])],
    [User, "findById", () => makeQuery(records.user)],
    [ATM, "find", () => makeQuery([records.atm])],
  ];
  for (const model of [Employee, User]) {
    for (const method of [
      "deleteOne",
      "findByIdAndDelete",
      "findOneAndDelete",
    ]) {
      overrides.push([
        model,
        method,
        async () => {
          records.deleteCalls.push(`${model.modelName}.${method}`);
        },
      ]);
    }
  }
  await withOverrides(overrides, callback);
};

const adminRequest = (id, body) => ({
  params: { employeeId: id },
  body,
  user: { _id: adminId, userType: "admin" },
});

test("Employee and User statuses are separate validated fields", () => {
  for (const status of ["active", "inactive", "on_leave", "resigned"]) {
    assert.equal(updateEmployeeSchema.safeParse({ status }).success, true);
  }
  for (const status of ["blocked", "pending", "unknown"]) {
    assert.equal(updateEmployeeSchema.safeParse({ status }).success, false);
  }
  for (const status of ["active", "inactive", "blocked"]) {
    assert.equal(changeUserStatusSchema.safeParse({ status }).success, true);
  }
  for (const status of ["on_leave", "resigned", "pending", "unknown"]) {
    assert.equal(changeUserStatusSchema.safeParse({ status }).success, false);
  }
  assert.equal(
    updateEmployeeSchema.safeParse({ status: "inactive", userType: "admin" })
      .success,
    false,
  );
  assert.equal(
    changeUserStatusSchema.safeParse({ status: "inactive", employeeStatus: "active" })
      .success,
    false,
  );
});

test("Admin and SuperAdmin are the only roles authorized by Employee status route middleware", () => {
  for (const userType of ["admin", "superAdmin"]) {
    assert.doesNotThrow(() =>
      authorizeRoles("admin", "superAdmin")(
        { user: { userType } },
        {},
        () => {},
      ),
    );
  }
  assert.throws(
    () =>
      authorizeRoles("admin", "superAdmin")(
        { user: { userType: "employee" } },
        {},
        () => {},
      ),
    { statusCode: 403 },
  );
});

test("User status controller rejects non-admin callers", async () => {
  const result = await invoke(changeUserStatus, {
    params: { id: userId },
    body: { status: "inactive" },
    user: { _id: userId, userType: "employee" },
  });
  assert.equal(result.status, 403);
});

test("User status changes do not change Employee work status or reciprocal ATM assignments", async () => {
  const records = makeRecords();
  await withStatusMocks(records, async () => {
    const result = await invoke(
      changeUserStatus,
      {
        params: { id: userId },
        body: { status: "inactive" },
        user: { _id: adminId, userType: "admin" },
      },
    );

    assert.equal(result.status, 200);
    assert.equal(records.user.status, "inactive");
    assert.equal(records.employee.status, "active");
    assert.deepEqual(records.employee.assignedAtmIds, [atmId]);
    assert.deepEqual(records.atm.assignedEmployeeId, [employeeId]);
    assert.equal(records.atm.amcResponsibleEmployeeId, null);
    assert.equal(records.job.assignedEmployeeId, userId);
    assert.equal(records.history.performedBy, userId);
    assert.equal(records.recurringPlan.assignedEmployeeId, employeeId);
    assert.equal(records.amcRecord.employeeId, userId);
    assert.deepEqual(records.deleteCalls, []);
  });
});

test("Employee work-status changes do not change linked User login status or history references", async () => {
  const records = makeRecords();
  await withStatusMocks(records, async () => {
    const result = await invoke(
      updateEmployee,
      adminRequest(employeeId, { status: "on_leave" }),
    );

    assert.equal(result.status, 200);
    assert.equal(records.employee.status, "on_leave");
    assert.equal(records.user.status, "active");
    assert.deepEqual(records.employee.assignedAtmIds, [atmId]);
    assert.deepEqual(records.atm.assignedEmployeeId, [employeeId]);
    assert.equal(records.job.assignedEmployeeId, userId);
    assert.equal(records.history.performedBy, userId);
    assert.equal(records.recurringPlan.assignedEmployeeId, employeeId);
    assert.equal(records.amcRecord.employeeId, userId);
    assert.deepEqual(records.deleteCalls, []);
  });
});

test("both status changes are blocked while the Employee remains AMC responsible", async () => {
  const records = makeRecords({ amcResponsibleEmployeeId: employeeId });
  await withStatusMocks(records, async () => {
    const employeeError = await captureError(
      updateEmployee,
      adminRequest(employeeId, { status: "inactive" }),
    );
    const userError = await captureError(changeUserStatus, {
      params: { id: userId },
      body: { status: "blocked" },
      user: { _id: adminId, userType: "superAdmin" },
    });

    assert.equal(employeeError.statusCode, 409);
    assert.equal(userError.statusCode, 409);
    assert.equal(records.employee.status, "active");
    assert.equal(records.user.status, "active");
    assert.deepEqual(records.employee.assignedAtmIds, [atmId]);
    assert.deepEqual(records.atm.assignedEmployeeId, [employeeId]);
  });
});

test("inactive and blocked User accounts are denied at login", async (t) => {
  for (const status of ["inactive", "blocked"]) {
    await t.test(status, async () => {
      await withOverrides(
        [[User, "findOne", async () => ({ status })]],
        async () => {
          const error = await captureError(loginUser, {
            body: { email: "employee@example.test", password: "password" },
          });
          assert.equal(error.statusCode, 403);
        },
      );
    });
  }
});

test("access-token middleware also rejects inactive or blocked User accounts", async (t) => {
  for (const status of ["inactive", "blocked"]) {
    await t.test(status, async () => {
      await withOverrides(
        [
          [
            User,
            "findById",
            () => ({
              select() {
                return Promise.resolve({ status });
              },
            }),
          ],
        ],
        async () => {
          const originalVerify = (await import("jsonwebtoken")).default.verify;
          const jwt = (await import("jsonwebtoken")).default;
          jwt.verify = () => ({ id: userId });
          try {
            const error = await captureError(verifyAccessToken, {
              headers: { authorization: "Bearer test-token" },
            });
            assert.equal(error.statusCode, 403);
          } finally {
            jwt.verify = originalVerify;
          }
        },
      );
    });
  }
});
