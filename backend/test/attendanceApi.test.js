import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import attendanceRouter from "../src/modules/attendance/attendance.routes.js";
import {
  checkIn,
  checkOut,
  createEmployeeAttendance,
  getAttendanceById,
} from "../src/modules/attendance/attendance.controller.js";
import Attendance from "../src/modules/attendance/attendance.model.js";
import AttendanceEntryAudit from "../src/modules/attendance/attendanceEntryAudit.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";
import { authorizeRoles } from "../src/middlewares/role.middleware.js";
import { validateRequest } from "../src/middlewares/validate.middleware.js";
import { handleAttendanceError } from "../src/modules/attendance/attendanceError.middleware.js";
import {
  attendanceIdParamsSchema,
  myAttendanceQuerySchema,
  onBehalfAttendanceRecordSchema,
} from "../src/modules/attendance/attendance.validation.js";

const employeeId = "64b000000000000000000001";
const employeeUserId = "64b000000000000000000002";
const adminId = "64b000000000000000000003";
const attendanceId = "64b000000000000000000005";

const getRoute = (path, method) =>
  attendanceRouter.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  )?.route;

const invoke = (handler, req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
      },
    };
    handler(req, res, (error) => resolve({ error }));
  });

async function withModelMocks(callback) {
  const originals = [
    [Employee, "findOne", Employee.findOne],
    [Employee, "findById", Employee.findById],
    [Attendance, "findOne", Attendance.findOne],
    [Attendance, "find", Attendance.find],
    [Attendance, "create", Attendance.create],
    [Attendance, "findOneAndUpdate", Attendance.findOneAndUpdate],
    [AttendanceEntryAudit, "create", AttendanceEntryAudit.create],
    [mongoose, "startSession", mongoose.startSession],
  ];
  const state = { attendanceDocuments: [], entryAudits: [] };

  Employee.findOne = () => ({
    populate: async () => ({
      _id: employeeId,
      status: "active",
      userId: {
        _id: employeeUserId,
        userType: "employee",
        status: "active",
      },
    }),
  });
  Employee.findById = (id) => ({
    populate: async () =>
      String(id) === employeeId
        ? {
            _id: employeeId,
            status: "active",
            supervisorId: adminId,
            userId: {
              _id: employeeUserId,
              userType: "employee",
              status: "active",
            },
          }
        : null,
  });
  Attendance.findOne = () => ({
    session() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(null).then(resolve, reject);
    },
  });
  Attendance.find = (filter) => ({
    limit: async (limit) =>
      state.attendanceDocuments
        .filter(
          (record) =>
            String(record.employeeId) === String(filter.employeeId) &&
            record.checkOutAt == null,
        )
        .slice(0, limit),
  });
  Attendance.create = async (documents) => {
    const input = Array.isArray(documents) ? documents[0] : documents;
    const document = {
      _id: new mongoose.Types.ObjectId(),
      ...input,
    };
    state.attendanceDocuments.push(document);
    return Array.isArray(documents) ? [document] : document;
  };
  Attendance.findOneAndUpdate = async (filter, update) => {
    const record = state.attendanceDocuments.find(
      (entry) =>
        String(entry._id) === String(filter._id) &&
        String(entry.employeeId) === String(filter.employeeId) &&
        entry.checkOutAt == null &&
        entry.checkInAt <= filter.checkInAt.$lte,
    );
    if (!record) return null;
    Object.assign(record, update.$set);
    return record;
  };
  AttendanceEntryAudit.create = async (documents) => {
    const audit = { _id: new mongoose.Types.ObjectId(), ...documents[0] };
    state.entryAudits.push(audit);
    return [audit];
  };
  mongoose.startSession = async () => ({
    withTransaction: async (operation) => operation({}),
    endSession: async () => {},
  });

  try {
    await callback(state);
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
}

test("all Attendance endpoints require access-token authentication and expected roles", () => {
  const routes = [
    ["/me/check-in", "post", ["employee"]],
    ["/me/check-out", "post", ["employee"]],
    ["/me", "get", ["employee"]],
    [
      "/employees/:employeeId/records",
      "post",
      ["admin", "superAdmin", "supervisor"],
    ],
    ["/records", "get", ["admin", "superAdmin", "supervisor"]],
    ["/records/:id", "get", ["admin", "superAdmin", "supervisor"]],
    ["/records/:id/correction", "patch", ["admin", "superAdmin"]],
  ];

  for (const [path, method, roles] of routes) {
    const route = getRoute(path, method);
    assert.ok(route, `${method.toUpperCase()} ${path}`);
    assert.equal(route.stack[0].handle, verifyAccessToken);
    const authorize = route.stack[1].handle;
    for (const role of roles) {
      let nextCalled = false;
      authorize({ user: { userType: role } }, {}, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true, `${role} should access ${path}`);
    }
    assert.throws(
      () => authorize({ user: { userType: "customer" } }, {}, () => {}),
      { statusCode: 403 },
    );
    assert.throws(() => authorize({}, {}, () => {}), { statusCode: 401 });
  }

  const correctionRoute = getRoute("/records/:id/correction", "patch");
  const correctionAuth = correctionRoute.stack[1].handle;
  assert.throws(
    () =>
      correctionAuth(
        { user: { userType: "supervisor" } },
        {},
        () => {},
      ),
    { statusCode: 403 },
  );
});

test("access-token middleware rejects unauthenticated Attendance requests without database access", async () => {
  const route = getRoute("/me/check-in", "post");
  let error;
  await route.stack[0].handle(
    { headers: {} },
    {},
    (nextError) => {
      error = nextError;
    },
  );
  assert.equal(error.statusCode, 401);
});

test("validation middleware supports strict body, query, and path parameter schemas", async () => {
  const queryReq = {
    query: { fromDate: "2026-10-01", page: "3", limit: "10" },
  };
  let queryNext = false;
  await validateRequest(myAttendanceQuerySchema, "query")(
    queryReq,
    {},
    () => {
      queryNext = true;
    },
  );
  assert.equal(queryNext, true);
  assert.deepEqual(queryReq.validatedQuery, {
    fromDate: "2026-10-01",
    page: 3,
    limit: 10,
  });
  assert.equal(queryReq.query.page, "3");

  const invalidQueryReq = {
    query: { employeeId, limit: "1000" },
  };
  let queryError;
  await validateRequest(myAttendanceQuerySchema, "query")(
    invalidQueryReq,
    {},
    (error) => {
      queryError = error;
    },
  );
  assert.equal(queryError.statusCode, 400);

  const paramsReq = { params: { id: "bad" } };
  let paramsError;
  await validateRequest(attendanceIdParamsSchema, "params")(
    paramsReq,
    {},
    (error) => {
      paramsError = error;
    },
  );
  assert.equal(paramsError.statusCode, 400);

  const bodyReq = { body: { checkInAt: "2026-10-10T09:00:00+05:30" } };
  let bodyNext = false;
  await validateRequest(onBehalfAttendanceRecordSchema)(
    bodyReq,
    {},
    () => {
      bodyNext = true;
    },
  );
  assert.equal(bodyNext, true);
  assert.deepEqual(bodyReq.body, {
    checkInAt: "2026-10-10T09:00:00+05:30",
  });
});

test("self check-in controller derives employee identity exclusively from req.user", async () => {
  await withModelMocks(async (state) => {
    const result = await invoke(checkIn, {
      user: {
        _id: employeeUserId,
        userType: "employee",
      },
      body: {},
      query: { employeeId: "64b000000000000000000099" },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.statusCode, 201);
    assert.equal(state.attendanceDocuments[0].employeeId, employeeId);
    assert.equal(
      state.attendanceDocuments[0].checkInRecordedBy,
      employeeUserId,
    );
  });
});

test("bodyless Employee check-in passes route validation and reaches the controller", async () => {
  await withModelMocks(async (state) => {
    const route = getRoute("/me/check-in", "post");
    const validateBody = route.stack[2].handle;
    const req = {
      user: { _id: employeeUserId, userType: "employee" },
      body: undefined,
    };
    let validationError;
    let validationPassed = false;

    await validateBody(req, {}, (error) => {
      validationError = error;
      validationPassed = !error;
    });

    assert.equal(validationError, undefined);
    assert.equal(validationPassed, true);
    assert.deepEqual(req.body, {});

    const response = await invoke(route.stack[3].handle, req);
    assert.equal(response.error, undefined);
    assert.equal(response.statusCode, 201);
    assert.equal(state.attendanceDocuments.length, 1);
    assert.equal(state.attendanceDocuments[0].employeeId, employeeId);
    assert.equal(
      state.attendanceDocuments[0].checkInRecordedBy,
      employeeUserId,
    );
  });
});

test("bodyless Employee check-out passes route validation and atomically closes an open record", async () => {
  await withModelMocks(async (state) => {
    const existing = {
      _id: attendanceId,
      employeeId,
      attendanceDate: "2026-10-10",
      checkInAt: new Date("2026-10-10T03:00:00.000Z"),
      checkOutAt: null,
      checkInRecordedBy: employeeUserId,
      checkOutRecordedBy: null,
      checkInSource: "employee",
      checkOutSource: null,
    };
    state.attendanceDocuments.push(existing);

    const route = getRoute("/me/check-out", "post");
    const req = {
      user: { _id: employeeUserId, userType: "employee" },
      body: undefined,
    };
    let validationError;
    await route.stack[2].handle(req, {}, (error) => {
      validationError = error;
    });
    assert.equal(validationError, undefined);
    assert.deepEqual(req.body, {});

    const response = await invoke(route.stack[3].handle, req);
    assert.equal(response.error, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data._id, attendanceId);
    assert.equal(response.body.data.checkOutRecordedBy, employeeUserId);
    assert.equal(response.body.data.checkOutSource, "employee");
    assert.ok(response.body.data.checkOutAt instanceof Date);
    assert.equal(state.attendanceDocuments[0].attendanceDate, "2026-10-10");
  });
});

test("Employee check-out with no open record returns the established conflict", async () => {
  await withModelMocks(async () => {
    const response = await invoke(checkOut, {
      user: { _id: employeeUserId, userType: "employee" },
      body: {},
    });
    assert.equal(response.error.statusCode, 409);
    assert.match(response.error.message, /No open attendance record/);
  });
});

test("on-behalf controller uses authenticated actor; request schemas reject supplied identities", async () => {
  assert.equal(
    onBehalfAttendanceRecordSchema.safeParse({
      actorId: adminId,
      userId: employeeUserId,
    }).success,
    false,
  );
  assert.equal(
    onBehalfAttendanceRecordSchema.safeParse({
      gps: { latitude: 1, longitude: 2 },
    }).success,
    false,
  );

  await withModelMocks(async (state) => {
    const result = await invoke(createEmployeeAttendance, {
      user: { _id: adminId, userType: "admin" },
      validatedParams: { employeeId },
      body: {},
    });
    assert.equal(result.error, undefined);
    assert.equal(result.statusCode, 201);
    assert.equal(state.attendanceDocuments[0].employeeId, employeeId);
    assert.equal(state.attendanceDocuments[0].checkInRecordedBy, adminId);
    assert.equal(state.entryAudits[0].actorId, adminId);
  });
});

test("controller forwards service errors with their established status code", async () => {
  const result = await invoke(getAttendanceById, {
    user: { _id: adminId, userType: "admin" },
    validatedParams: { id: "invalid-id" },
  });
  assert.equal(result.error.statusCode, 400);
});

test("Attendance 5xx responses do not expose internal error messages or stacks", () => {
  const error = new Error("database credentials or query details");
  let response;
  let forwardedError;
  const res = {
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      response = { statusCode: this.statusCode, body };
      return this;
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    handleAttendanceError(error, {}, res, (forwarded) => {
      forwardedError = forwarded;
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(forwardedError, undefined);
  assert.deepEqual(response, {
    statusCode: 500,
    body: {
      success: false,
      message: "Internal Server Error",
      errors: [],
    },
  });
});

test("Attendance client errors retain their established status and response handling", () => {
  const error = { statusCode: 409, message: "Attendance conflict" };
  let forwardedError;
  handleAttendanceError(error, {}, {}, (forwarded) => {
    forwardedError = forwarded;
  });
  assert.equal(forwardedError, error);
});

test("routes bind request validation to intended input locations", () => {
  const expectedLengths = [
    ["/me/check-in", "post", 4],
    ["/employees/:employeeId/records", "post", 5],
    ["/me", "get", 4],
    ["/records", "get", 4],
    ["/records/:id", "get", 4],
    ["/records/:id/correction", "patch", 5],
  ];

  for (const [path, method, length] of expectedLengths) {
    const route = getRoute(path, method);
    assert.equal(route.stack.length, length);
  }
  assert.equal(getRoute("/me/check-out", "post").stack.length, 4);
  assert.equal(attendanceRouter.stack.at(-1).handle, handleAttendanceError);
});
