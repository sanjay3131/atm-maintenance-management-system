import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import attendanceRouter from "../src/modules/attendance/attendance.routes.js";
import { setAttendanceStatus } from "../src/modules/attendance/attendance.controller.js";
import Attendance from "../src/modules/attendance/attendance.model.js";
import AttendanceStatusOverride from "../src/modules/attendance/attendanceStatusOverride.model.js";
import AttendanceStatusOverrideAudit from "../src/modules/attendance/attendanceStatusOverrideAudit.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";
import { authorizeRoles } from "../src/middlewares/role.middleware.js";
import {
  attendanceStatusOverrideAuditParamsSchema,
  attendanceStatusOverrideAuditQuerySchema,
  attendanceStatusOverrideParamsSchema,
  attendanceStatusOverrideSchema,
} from "../src/modules/attendance/attendance.validation.js";
import {
  listAttendanceStatusOverrideAudit,
  setAttendanceStatusOverride,
} from "../src/modules/attendance/attendance.service.js";

const employeeId = "64b000000000000000000001";
const employeeUserId = "64b000000000000000000002";
const adminId = "64b000000000000000000003";
const attendanceId = "64b000000000000000000004";
const attendanceDate = "2026-10-10";
const checkInAt = new Date("2026-10-10T03:00:00.000Z");
const checkOutAt = new Date("2026-10-10T12:00:00.000Z");

const getRoute = (path, method) =>
  attendanceRouter.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  )?.route;

const makeActor = (userType, id = adminId) => ({ _id: id, userType });

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

const runMiddleware = (middleware, req) =>
  new Promise((resolve) => {
    middleware(req, {}, (error) => resolve(error));
  });

async function withMocks(
  { attendance = null, auditInsertError = null, employeeExists = true } = {},
  callback,
) {
  const originals = [
    [Employee, "findById", Employee.findById],
    [Attendance, "findOne", Attendance.findOne],
    [AttendanceStatusOverride, "findOne", AttendanceStatusOverride.findOne],
    [
      AttendanceStatusOverride,
      "findOneAndUpdate",
      AttendanceStatusOverride.findOneAndUpdate,
    ],
    [AttendanceStatusOverrideAudit, "create", AttendanceStatusOverrideAudit.create],
    [AttendanceStatusOverrideAudit, "find", AttendanceStatusOverrideAudit.find],
    [
      AttendanceStatusOverrideAudit,
      "countDocuments",
      AttendanceStatusOverrideAudit.countDocuments,
    ],
    [mongoose, "startSession", mongoose.startSession],
  ];
  const state = {
    attendance: attendance ? { ...attendance } : null,
    overrides: [],
    audits: [],
  };
  const query = (resolve) => ({
    session() {
      return this;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve(resolve()).then(onFulfilled, onRejected);
    },
  });

  Employee.findById = (id) =>
    query(() =>
      employeeExists && String(id) === employeeId ? { _id: employeeId } : null,
    );
  Attendance.findOne = (filter) =>
    query(() =>
      state.attendance &&
      String(state.attendance.employeeId) === String(filter.employeeId) &&
      state.attendance.attendanceDate === filter.attendanceDate
        ? state.attendance
        : null,
    );
  AttendanceStatusOverride.findOne = (filter) =>
    query(
      () =>
        state.overrides.find(
          (entry) =>
            String(entry.employeeId) === String(filter.employeeId) &&
            entry.attendanceDate === filter.attendanceDate,
        ) ?? null,
    );
  AttendanceStatusOverride.findOneAndUpdate = async (
    filter,
    update,
    options,
  ) => {
    assert.ok(options.session);
    let override = state.overrides.find(
      (entry) =>
        String(entry.employeeId) === String(filter.employeeId) &&
        entry.attendanceDate === filter.attendanceDate,
    );
    if (!override) {
      override = {
        _id: new mongoose.Types.ObjectId(),
        ...update.$setOnInsert,
      };
      state.overrides.push(override);
    }
    Object.assign(override, update.$set);
    return override;
  };
  AttendanceStatusOverrideAudit.create = async (documents, options) => {
    assert.ok(options.session);
    if (auditInsertError) throw auditInsertError;
    const audit = { _id: new mongoose.Types.ObjectId(), ...documents[0] };
    state.audits.push(audit);
    return [audit];
  };
  AttendanceStatusOverrideAudit.find = (filter) => {
    let events = state.audits.filter(
      (entry) =>
        String(entry.employeeId) === String(filter.employeeId) &&
        entry.attendanceDate === filter.attendanceDate,
    );
    const cursor = {
      sort() {
        events = [...events].reverse();
        return this;
      },
      skip(value) {
        events = events.slice(value);
        return this;
      },
      limit(value) {
        return Promise.resolve(events.slice(0, value));
      },
    };
    return cursor;
  };
  AttendanceStatusOverrideAudit.countDocuments = async (filter) =>
    state.audits.filter(
      (entry) =>
        String(entry.employeeId) === String(filter.employeeId) &&
        entry.attendanceDate === filter.attendanceDate,
    ).length;
  mongoose.startSession = async () => ({
    withTransaction: async (operation) => {
      const previousOverrides = state.overrides.map((entry) => ({ ...entry }));
      const previousAuditCount = state.audits.length;
      try {
        await operation({});
      } catch (error) {
        state.overrides = previousOverrides;
        state.audits.length = previousAuditCount;
        throw error;
      }
    },
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

test("Admin and superAdmin can set Present and Absent overrides", async () => {
  await withMocks({}, async (state) => {
    for (const role of ["admin", "superAdmin"]) {
      const result = await setAttendanceStatusOverride({
        employeeId,
        attendanceDate,
        status: role === "admin" ? "absent" : "present",
        reason: `Reviewed by ${role}`,
        actor: makeActor(role),
      });
      assert.equal(result.override.status, role === "admin" ? "absent" : "present");
      assert.equal(result.audit.actorId, adminId);
    }
    assert.equal(state.overrides.length, 1);
    assert.equal(state.audits.length, 2);
  });
});

test("status overrides work both with an Attendance record and without one", async () => {
  await withMocks({ attendance: {
    _id: attendanceId,
    employeeId,
    attendanceDate,
    checkInAt,
    checkOutAt,
    checkInRecordedBy: employeeUserId,
    checkOutRecordedBy: employeeUserId,
    checkInSource: "employee",
    checkOutSource: "employee",
  } }, async (state) => {
    const result = await setAttendanceStatusOverride({
      employeeId,
      attendanceDate,
      status: "absent",
      reason: "Admin-reviewed exception",
      actor: makeActor("admin"),
    });
    assert.equal(result.audit.previousEffectiveValues.status, "present");
    assert.deepEqual(result.audit.newEffectiveValues, {
      status: "absent",
      checkInAt,
      checkOutAt,
    });
    assert.equal(state.attendance.checkInRecordedBy, employeeUserId);
    assert.equal(state.attendance.checkOutRecordedBy, employeeUserId);
    assert.equal(state.attendance.checkInSource, "employee");
    assert.equal(state.attendance.checkOutSource, "employee");
  });

  await withMocks({}, async (state) => {
    const result = await setAttendanceStatusOverride({
      employeeId,
      attendanceDate,
      status: "absent",
      reason: "Confirmed absence",
      actor: makeActor("admin"),
    });
    assert.deepEqual(result.audit.previousEffectiveValues, {
      status: "unrecorded",
      checkInAt: null,
      checkOutAt: null,
    });
    assert.deepEqual(result.audit.newEffectiveValues, {
      status: "absent",
      checkInAt: null,
      checkOutAt: null,
    });
    assert.equal(state.overrides.length, 1);
  });
});

test("marking an Employee absent preserves recorded attendance and does not write Jobs", async () => {
  const attendance = {
    _id: attendanceId,
    employeeId,
    attendanceDate,
    checkInAt,
    checkOutAt,
    checkInRecordedBy: employeeUserId,
    checkOutRecordedBy: employeeUserId,
    checkInSource: "employee",
    checkOutSource: "employee",
  };
  const jobs = [
    {
      _id: "64b000000000000000000005",
      jobId: "JOB-ATTENDANCE-1",
      title: "Scheduled ATM maintenance",
      atmId: "64b000000000000000000006",
      assignedEmployeeId: employeeUserId,
      assignedBy: adminId,
      status: "COMPLETED",
      startedAt: new Date("2026-10-10T04:00:00.000Z"),
      completedAt: new Date("2026-10-10T09:00:00.000Z"),
      isDeleted: false,
    },
  ];
  const originalJobs = structuredClone(jobs);
  const jobWriteMethods = [
    "create",
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findByIdAndUpdate",
    "replaceOne",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
    "findByIdAndDelete",
  ];
  const originalJobMethods = jobWriteMethods.map((method) => [
    method,
    Job[method],
  ]);
  const originalJobSave = Job.prototype.save;
  const jobWrites = [];
  const applyMockJobWrite = (method) => {
    if (method === "create") {
      jobs.push({ ...jobs[0], _id: "64b000000000000000000007" });
    } else if (method.toLowerCase().includes("delete")) {
      jobs.length = 0;
    } else if (jobs[0]) {
      jobs[0].status = "CANCELLED";
      jobs[0].updatedAt = new Date("2026-10-12T13:00:00.000Z");
    }
  };
  for (const method of jobWriteMethods) {
    Job[method] = (...args) => {
      jobWrites.push({ method, args });
      applyMockJobWrite(method);
      return Promise.resolve();
    };
  }
  Job.prototype.save = (...args) => {
    jobWrites.push({ method: "save", args });
    applyMockJobWrite("save");
    return Promise.resolve();
  };

  try {
    await withMocks({ attendance }, async (state) => {
      const originalAttendance = { ...state.attendance };
      await setAttendanceStatusOverride({
        employeeId,
        attendanceDate,
        status: "absent",
        reason: "Reviewed absence",
        actor: makeActor("admin"),
      });

      assert.deepEqual(state.attendance, originalAttendance);
      assert.equal(state.attendance.checkInAt.getTime(), checkInAt.getTime());
      assert.equal(state.attendance.checkOutAt.getTime(), checkOutAt.getTime());
      assert.deepEqual(jobs, originalJobs);
      assert.deepEqual(jobWrites, []);
    });
  } finally {
    for (const [method, original] of originalJobMethods) {
      Job[method] = original;
    }
    Job.prototype.save = originalJobSave;
  }
});

test("status override rejects unauthorized actors and missing Employees", async () => {
  await withMocks({}, async () => {
    for (const userType of ["employee", "supervisor", "customer"]) {
      await assert.rejects(
        setAttendanceStatusOverride({
          employeeId,
          attendanceDate,
          status: "present",
          reason: "Not authorized",
          actor: makeActor(userType),
        }),
        (error) => error.statusCode === 403,
      );
    }
  });
  await withMocks({ employeeExists: false }, async () => {
    await assert.rejects(
      setAttendanceStatusOverride({
        employeeId,
        attendanceDate,
        status: "present",
        reason: "Employee missing",
        actor: makeActor("admin"),
      }),
      (error) => error.statusCode === 404,
    );
  });
});

test("status override validation rejects bad IDs, dates, status, reason, and extra actor fields", () => {
  assert.equal(
    attendanceStatusOverrideParamsSchema.safeParse({ employeeId }).success,
    true,
  );
  assert.equal(
    attendanceStatusOverrideParamsSchema.safeParse({ employeeId: "bad" }).success,
    false,
  );
  assert.equal(
    attendanceStatusOverrideSchema.safeParse({
      attendanceDate,
      status: "absent",
      reason: "Reviewed",
    }).success,
    true,
  );
  for (const invalidBody of [
    { attendanceDate: "2026-02-30", status: "absent", reason: "Valid reason" },
    { attendanceDate, status: "unknown", reason: "Valid reason" },
    { attendanceDate, status: "present", reason: " " },
    { attendanceDate, status: "present", reason: "Valid", actorId: adminId },
  ]) {
    assert.equal(attendanceStatusOverrideSchema.safeParse(invalidBody).success, false);
  }
  assert.equal(
    attendanceStatusOverrideAuditParamsSchema.safeParse({
      employeeId,
      attendanceDate,
    }).success,
    true,
  );
  assert.equal(
    attendanceStatusOverrideAuditParamsSchema.safeParse({
      employeeId,
      attendanceDate: "not-a-date",
    }).success,
    false,
  );
  assert.equal(
    attendanceStatusOverrideAuditQuerySchema.safeParse({
      page: "2",
      limit: "100",
    }).success,
    true,
  );
});

test("each override appends actor-bound before/after audit values and preserves earlier events", async () => {
  await withMocks({ attendance: {
    _id: attendanceId,
    employeeId,
    attendanceDate,
    checkInAt,
    checkOutAt: null,
    checkInRecordedBy: employeeUserId,
    checkOutRecordedBy: null,
    checkInSource: "employee",
    checkOutSource: null,
  } }, async (state) => {
    await setAttendanceStatusOverride({
      employeeId,
      attendanceDate,
      status: "absent",
      reason: "First decision",
      actor: makeActor("admin"),
      now: new Date("2026-10-11T00:00:00.000Z"),
    });
    await setAttendanceStatusOverride({
      employeeId,
      attendanceDate,
      status: "present",
      reason: "Revised decision",
      actor: makeActor("superAdmin"),
      now: new Date("2026-10-11T01:00:00.000Z"),
    });

    assert.equal(state.audits.length, 2);
    assert.equal(state.audits[0].previousEffectiveValues.status, "incomplete");
    assert.equal(state.audits[0].newEffectiveValues.status, "absent");
    assert.equal(state.audits[0].actorId, adminId);
    assert.equal(state.audits[1].previousEffectiveValues.status, "absent");
    assert.equal(state.audits[1].newEffectiveValues.status, "present");
    assert.equal(state.audits[1].actorId, adminId);
    assert.equal(state.audits[0].reason, "First decision");
    assert.equal(state.audits[1].reason, "Revised decision");

    const history = await listAttendanceStatusOverrideAudit({
      employeeId,
      attendanceDate,
      actor: makeActor("admin"),
      page: 1,
      limit: 20,
    });
    assert.equal(history.pagination.total, 2);
    assert.equal(history.events.length, 2);
  });
});

test("audit writes roll back override state when the transaction fails", async () => {
  await withMocks({ auditInsertError: new Error("simulated audit failure") }, async (state) => {
    await assert.rejects(
      setAttendanceStatusOverride({
        employeeId,
        attendanceDate,
        status: "absent",
        reason: "Must be atomic",
        actor: makeActor("admin"),
      }),
      /simulated audit failure/,
    );
    assert.equal(state.overrides.length, 0);
    assert.equal(state.audits.length, 0);
  });
});

test("only Admin and superAdmin may access override and audit routes", () => {
  const routeCases = [
    ["/admin/employees/:employeeId/status-overrides", "post"],
    ["/admin/employees/:employeeId/status-overrides/:attendanceDate/audit", "get"],
  ];
  for (const [path, method] of routeCases) {
    const route = getRoute(path, method);
    assert.ok(route);
    assert.equal(route.stack[0].handle, verifyAccessToken);
    const authorize = route.stack[1].handle;
    for (const role of ["admin", "superAdmin"]) {
      assert.doesNotThrow(() =>
        authorize({ user: { userType: role } }, {}, () => {}),
      );
    }
    for (const role of ["employee", "supervisor", "customer"]) {
      assert.throws(
        () => authorize({ user: { userType: role } }, {}, () => {}),
        { statusCode: 403 },
      );
    }
  }
});

test("override route validates the payload and derives the actor from req.user", async () => {
  await withMocks({}, async (state) => {
    const route = getRoute(
      "/admin/employees/:employeeId/status-overrides",
      "post",
    );
    const req = {
      params: { employeeId },
      body: {
        attendanceDate,
        status: "absent",
        reason: "Admin decision",
        actorId: "64b000000000000000000099",
      },
      user: makeActor("superAdmin"),
    };
    const paramsError = await runMiddleware(route.stack[2].handle, req);
    assert.equal(paramsError, undefined);
    const bodyError = await runMiddleware(route.stack[3].handle, req);
    assert.equal(bodyError.statusCode, 400);
    assert.equal(state.audits.length, 0);

    req.body = {
      attendanceDate,
      status: "absent",
      reason: "Admin decision",
    };
    const validBodyError = await runMiddleware(route.stack[3].handle, req);
    assert.equal(validBodyError, undefined);
    const response = await invoke(setAttendanceStatus, req);
    assert.equal(response.error, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.audit.actorId, adminId);
    assert.equal(response.body.data.audit.reason, "Admin decision");
    assert.equal(state.audits.length, 1);
  });
});

test("non-admin roles cannot retrieve override audit through the service", async () => {
  await withMocks({}, async () => {
    for (const userType of ["employee", "supervisor", "customer"]) {
      await assert.rejects(
        listAttendanceStatusOverrideAudit({
          employeeId,
          attendanceDate,
          actor: makeActor(userType),
          page: 1,
          limit: 20,
        }),
        (error) => error.statusCode === 403,
      );
    }
  });
});

test("override model uniquely keys effective state without changing Attendance schema", () => {
  const uniqueIndex = AttendanceStatusOverride.schema.indexes().find(
    ([fields, options]) =>
      fields.employeeId === 1 &&
      fields.attendanceDate === 1 &&
      options.unique === true,
  );
  assert.ok(uniqueIndex);
  const auditHooks = AttendanceStatusOverrideAudit.schema.s.hooks;
  for (const hookName of [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ]) {
    assert.ok(
      auditHooks._pres.has(hookName),
      `audit model must block ${hookName}`,
    );
  }
  assert.deepEqual(
    AttendanceStatusOverride.schema.path("status").enumValues,
    ["present", "absent"],
  );
  assert.equal(Attendance.schema.path("status"), undefined);
});
