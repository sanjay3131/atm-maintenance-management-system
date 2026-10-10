import test from "node:test";
import assert from "node:assert/strict";
import Employee from "../src/modules/employees/employee.model.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";
import employeeRoutes from "../src/modules/employees/employee.routes.js";
import {
  getMyEmployeeProfile,
  viewEmployeeById,
} from "../src/modules/employees/employee.controller.js";
import { getSupervisedEmployees } from "../src/modules/supervisor/supervisor.controller.js";

const employeeDocumentId = "64b000000000000000000001";
const linkedUserId = "64b000000000000000000002";
const otherEmployeeId = "64b000000000000000000003";
const supervisorId = "64b000000000000000000004";

const makeQuery = (value, capture = {}) => ({
  select(selection) {
    capture.select = selection;
    const applyProjection = (record) => {
      const projected = { ...record };
      for (const field of String(selection).split(/\s+/)) {
        if (field.startsWith("-")) delete projected[field.slice(1)];
      }
      return projected;
    };
    if (Array.isArray(value)) value = value.map(applyProjection);
    else if (value && typeof value === "object") value = applyProjection(value);
    return this;
  },
  populate(...args) {
    (capture.populate ??= []).push(args);
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

const withEmployeeFindOne = async (findOne, callback) => {
  const original = Employee.findOne;
  Employee.findOne = findOne;
  try {
    await callback();
  } finally {
    Employee.findOne = original;
  }
};

test("employee self-profile resolves the authenticated User to a safe readable Employee profile", async () => {
  const capture = {};
  const employee = {
    _id: employeeDocumentId,
    userId: {
      _id: linkedUserId,
      firstName: "Asha",
      lastName: "Patel",
      email: "asha@example.test",
      phoneNumber: "5550100",
      password: "must-not-leak",
      refreshToken: "must-not-leak",
      loginAttempts: 7,
    },
    employeeCode: "EMP042",
    designation: "Technician",
    department: "Maintenance",
    joiningDate: "2024-03-01T00:00:00.000Z",
    employmentType: "full-time",
    status: "active",
    salary: 999999,
    supervisorId,
    createdBy: supervisorId,
    districtIds: [
      {
        _id: "64b000000000000000000010",
        districtName: "Central",
        pinCode: "560001",
        state: "Karnataka",
      },
    ],
    regionIds: [
      {
        _id: "64b000000000000000000011",
        name: "Central Region",
        code: "CTR",
        districtId: {
          _id: "64b000000000000000000010",
          districtName: "Central",
          pinCode: "560001",
        },
      },
    ],
    assignedAtmIds: [
      {
        _id: "64b000000000000000000012",
        atmId: "ATM0042",
        locationName: "Central Branch",
        status: "ACTIVE",
        districtId: {
          _id: "64b000000000000000000010",
          districtName: "Central",
          pinCode: "560001",
        },
        regionId: {
          _id: "64b000000000000000000011",
          name: "Central Region",
          code: "CTR",
        },
      },
    ],
  };

  await withEmployeeFindOne(
    (filter) => {
      capture.filter = filter;
      return makeQuery(employee, capture);
    },
    async () => {
      const { status, body } = await invoke(getMyEmployeeProfile, {
        user: { _id: linkedUserId, userType: "employee" },
        params: { employeeId: otherEmployeeId },
      });

      assert.equal(status, 200);
      assert.equal(String(capture.filter.userId), linkedUserId);
      assert.equal(
        capture.select.includes("salary"),
        false,
        "salary must not be selected for self-service",
      );
      assert.equal(body.data.employeeCode, "EMP042");
      assert.deepEqual(body.data.user, {
        firstName: "Asha",
        lastName: "Patel",
        email: "asha@example.test",
        phoneNumber: "5550100",
      });
      assert.deepEqual(body.data.districts, [
        {
          districtName: "Central",
          pinCode: "560001",
          state: "Karnataka",
        },
      ]);
      assert.deepEqual(body.data.regions, [
        {
          name: "Central Region",
          code: "CTR",
          district: {
            districtName: "Central",
            pinCode: "560001",
          },
        },
      ]);
      assert.deepEqual(body.data.assignedAtms, [
        {
          atmId: "ATM0042",
          locationName: "Central Branch",
          status: "ACTIVE",
          district: {
            districtName: "Central",
            pinCode: "560001",
          },
          region: { name: "Central Region", code: "CTR" },
        },
      ]);
      const serialized = JSON.stringify(body.data);
      for (const secret of [
        employeeDocumentId,
        linkedUserId,
        otherEmployeeId,
        supervisorId,
        "64b000000000000000000010",
        "64b000000000000000000011",
        "64b000000000000000000012",
        "999999",
        "must-not-leak",
        "salary",
        "supervisorId",
        "createdBy",
      ]) {
        assert.equal(serialized.includes(secret), false, `${secret} leaked`);
      }
    },
  );
});

test("employee self-profile returns not found when authenticated User has no Employee document", async () => {
  await withEmployeeFindOne(
    () => makeQuery(null),
    async () => {
      await assert.rejects(
        invoke(getMyEmployeeProfile, {
          user: { _id: linkedUserId, userType: "employee" },
          params: { employeeId: otherEmployeeId },
        }),
        { statusCode: 404, message: "Employee profile not found" },
      );
    },
  );
});

test("self-profile route is employee-only and registered before the arbitrary-ID profile route", () => {
  const selfRoute = employeeRoutes.stack.find(
    (layer) => layer.route?.path === "/me",
  );
  const byIdRoute = employeeRoutes.stack.find(
    (layer) => layer.route?.path === "/:employeeId",
  );

  assert.ok(selfRoute);
  assert.ok(byIdRoute);
  assert.ok(
    employeeRoutes.stack.indexOf(selfRoute) <
      employeeRoutes.stack.indexOf(byIdRoute),
  );
  assert.equal(selfRoute.route.methods.get, true);
  assert.equal(selfRoute.route.stack[0].handle, verifyAccessToken);
  assert.equal(selfRoute.route.stack.at(-1).handle, getMyEmployeeProfile);
  assert.doesNotThrow(() =>
    selfRoute.route.stack[1].handle(
      { user: { userType: "employee" } },
      {},
      () => {},
    ),
  );
  assert.throws(
    () =>
      selfRoute.route.stack[1].handle(
        { user: { userType: "supervisor" } },
        {},
        () => {},
      ),
    { statusCode: 403 },
  );

  assert.equal(byIdRoute.route.stack[0].handle, verifyAccessToken);
  assert.equal(byIdRoute.route.stack.at(-1).handle, viewEmployeeById);
  assert.doesNotThrow(() =>
    byIdRoute.route.stack[1].handle(
      { user: { userType: "admin" } },
      {},
      () => {},
    ),
  );
  assert.throws(
    () =>
      byIdRoute.route.stack[1].handle(
        { user: { userType: "employee" } },
        {},
        () => {},
      ),
      { statusCode: 403 },
  );
});

test("supervisor employee list preserves direct-report scope and excludes salary", async () => {
  const capture = {};
  const report = {
    _id: employeeDocumentId,
    userId: {
      firstName: "Asha",
      lastName: "Patel",
      email: "asha@example.test",
      phoneNumber: "5550100",
      status: "active",
    },
    employeeCode: "EMP042",
    salary: 999999,
    assignedAtmIds: [],
    districtIds: [],
  };
  const originalFind = Employee.find;
  Employee.find = (filter) => {
    capture.filter = filter;
    return makeQuery([report], capture);
  };

  try {
    const { status, body } = await invoke(getSupervisedEmployees, {
      user: { _id: supervisorId, userType: "supervisor" },
    });
    assert.equal(status, 200);
    assert.deepEqual(capture.filter, { supervisorId });
    assert.equal(capture.select, "-salary");
    assert.equal("salary" in body.data[0], false);
    assert.equal(body.data[0].employeeCode, "EMP042");
  } finally {
    Employee.find = originalFind;
  }
});
