import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import Attendance from "../src/modules/attendance/attendance.model.js";
import AttendanceStatusOverride from "../src/modules/attendance/attendanceStatusOverride.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import PublicHoliday from "../src/modules/holidays/publicHoliday.model.js";
import User from "../src/modules/users/user.model.js";
import attendanceRouter from "../src/modules/attendance/attendance.routes.js";
import { attendanceReportQuerySchema } from "../src/modules/attendance/attendanceReport.validation.js";

const JWT_SECRET = "attendance-report-api-test-secret";
const employeeId1 = "64b000000000000000000001";
const employeeId2 = "64b000000000000000000002";
const adminId = "64b000000000000000000010";
const asOf = "2026-11-04T10:00:00.000Z";
const baseQuery = {
  fromDate: "2026-11-02",
  toDate: "2026-11-08",
};

process.env.JWT_ACCESS_SECRET = JWT_SECRET;

const reportRoute = attendanceRouter.stack.find(
  (layer) =>
    layer.route?.path === "/admin/reports" && layer.route.methods.get,
).route;

const makeEmployee = (id, values = {}) => ({
  _id: id,
  employeeCode: `EMP-${id.slice(-3)}`,
  joiningDate: new Date("2020-01-01T00:00:00.000Z"),
  effectiveExitDate: null,
  ...values,
});

const makeToken = (id = adminId) => jwt.sign({ id }, JWT_SECRET);

const invokeRoute = (query, { token = makeToken() } = {}) =>
  new Promise((resolve) => {
    const req = {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        query,
      };
      let statusCode = 200;
      let finished = false;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        if (!finished) {
          finished = true;
          resolve({ statusCode, body });
        }
        return this;
      },
    };

    const dispatch = (index, error) => {
      if (finished) return;
      let handlerIndex = index;
      while (
        handlerIndex < reportRoute.stack.length &&
        (error
          ? reportRoute.stack[handlerIndex].handle.length !== 4
          : reportRoute.stack[handlerIndex].handle.length === 4)
      ) {
        handlerIndex += 1;
      }
      if (handlerIndex >= reportRoute.stack.length) {
        res.status(500).json({
          success: false,
          message: "Unhandled route error",
          errors: [],
        });
        return;
      }

      const handler = reportRoute.stack[handlerIndex].handle;
      let advanced = false;
      const next = (nextError) => {
        if (advanced || finished) return;
        advanced = true;
        dispatch(handlerIndex + 1, nextError);
      };

      try {
        const result = error
          ? handler(error, req, res, next)
          : handler(req, res, next);
        if (result && typeof result.then === "function") {
          result.catch(next);
        }
      } catch (handlerError) {
        next(handlerError);
      }
    };

    dispatch(0);
  });

const queryBuilder = (execute, capture) => {
  const builder = {
    select(fields) {
      capture.select = fields;
      return this;
    },
    sort(value) {
      capture.sort = value;
      return this;
    },
    skip(value) {
      capture.skip = value;
      return this;
    },
    limit(value) {
      capture.limit = value;
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve().then(execute).then(resolve, reject);
    },
  };
  return builder;
};

async function withModelMocks(
  {
    employees = [makeEmployee(employeeId1)],
    employeeFindError = null,
    employeeCountError = null,
    reportQueryError = null,
    attendanceRecords = [],
    user = { _id: adminId, userType: "admin", status: "active" },
  } = {},
  callback,
) {
  const originals = [
    [User, "findById", User.findById],
    [Employee, "find", Employee.find],
    [Employee, "countDocuments", Employee.countDocuments],
    [PublicHoliday, "find", PublicHoliday.find],
    [Attendance, "find", Attendance.find],
    [AttendanceStatusOverride, "find", AttendanceStatusOverride.find],
  ];
  const calls = {
    employeeFind: [],
    employeeCount: [],
    reportQueryMaxTimeMs: [],
    holidays: 0,
    attendance: 0,
    overrides: 0,
  };

  User.findById = (id) => ({
    select: async () => (String(id) === String(user?._id) ? user : null),
  });
  Employee.find = (filter) => {
    const capture = { filter };
    calls.employeeFind.push(capture);
    return queryBuilder(() => {
      if (employeeFindError) throw employeeFindError;
      const sorted = [...employees].sort((left, right) =>
        String(left._id).localeCompare(String(right._id)),
      );
      const filtered = filter._id
        ? sorted.filter((employee) => String(employee._id) === String(filter._id))
        : sorted;
      return filtered.slice(capture.skip, capture.skip + capture.limit);
    }, capture);
  };
  Employee.countDocuments = async (filter) => {
    calls.employeeCount.push(filter);
    if (employeeCountError) throw employeeCountError;
    return filter._id
      ? employees.filter((employee) => String(employee._id) === String(filter._id))
          .length
      : employees.length;
  };
  const reportRows = (modelName) => ({
    select() {
      return this;
    },
    maxTimeMS(maxTimeMS) {
      calls.reportQueryMaxTimeMs.push(maxTimeMS);
      return this;
    },
    then(resolve, reject) {
      const result = Promise.resolve().then(() => {
      if (reportQueryError === modelName) {
          throw new Error(`private ${modelName} failure`);
      }
        return modelName === "attendance" ? attendanceRecords : [];
      });
      return result.then(resolve, reject);
    },
  });
  PublicHoliday.find = () => {
    calls.holidays += 1;
    return reportRows("holiday");
  };
  Attendance.find = (filter) => {
    calls.attendance += 1;
    calls.attendanceFilter = filter;
    return reportRows("attendance");
  };
  AttendanceStatusOverride.find = () => {
    calls.overrides += 1;
    return reportRows("override");
  };

  try {
    return await callback(calls);
  } finally {
    for (const [model, method, original] of originals.reverse()) {
      model[method] = original;
    }
  }
}

test("report query schema validates dates, range, pagination, IDs, and timestamps", () => {
  const parse = (query) => attendanceReportQuerySchema.safeParse(query);
  assert.equal(parse(baseQuery).success, true);
  assert.equal(
    parse({ fromDate: baseQuery.fromDate, limit: "25" }).success,
    false,
  );
  assert.equal(
    parse({ ...baseQuery, fromDate: "2026-02-30" }).success,
    false,
  );
  assert.equal(
    parse({ ...baseQuery, fromDate: "2026/11/02" }).success,
    false,
  );
  assert.equal(
    parse({ ...baseQuery, fromDate: "2026-11-09" }).success,
    false,
  );
  assert.equal(
    parse({
      fromDate: "2024-01-01",
      toDate: "2024-12-31",
    }).success,
    true,
  );
  assert.equal(
    parse({ fromDate: "2023-12-31", toDate: "2024-12-31" }).success,
    false,
  );
  assert.equal(parse({ ...baseQuery, employeeId: "bad" }).success, false);
  assert.equal(parse({ ...baseQuery, page: "0" }).success, false);
  assert.equal(parse({ ...baseQuery, page: "1.5" }).success, false);
  assert.equal(
    parse({ ...baseQuery, page: String(Number.MAX_SAFE_INTEGER) }).success,
    false,
  );
  assert.equal(parse({ ...baseQuery, limit: "101" }).success, false);
  assert.equal(parse({ ...baseQuery, limit: "0" }).success, false);
  assert.equal(parse({ ...baseQuery, asOf: "2026-11-04T10:00:00" }).success, false);
  assert.equal(parse({ ...baseQuery, asOf: "2026-02-30T10:00:00Z" }).success, false);
  assert.equal(
    parse({ ...baseQuery, asOf: "2026-11-04T10:00:00+05:30" }).success,
    true,
  );
  assert.equal(parse({ ...baseQuery, extra: "no" }).success, false);
  assert.equal(
    parse({ ...baseQuery, page: ["1", "2"] }).success,
    false,
  );
});

test("report route requires authentication and only allows admin roles", async () => {
  await withModelMocks({}, async () => {
    const unauthenticated = await invokeRoute(baseQuery, { token: null });
    assert.equal(unauthenticated.statusCode, 401);

    const invalidToken = await invokeRoute(baseQuery, { token: "invalid-token" });
    assert.equal(invalidToken.statusCode, 401);

    for (const userType of ["supervisor", "employee", "customer"]) {
      const response = await withUserType(userType);
      assert.equal(response.statusCode, 403, `${userType} must be forbidden`);
    }

    const admin = await invokeRoute(baseQuery);
    assert.equal(admin.statusCode, 200);
  });
  const superAdmin = await withModelMocks(
    {
      user: { _id: adminId, userType: "superAdmin", status: "active" },
    },
    () => invokeRoute(baseQuery),
  );
  assert.equal(superAdmin.statusCode, 200);
});

async function withUserType(userType) {
  return withModelMocks(
    { user: { _id: adminId, userType, status: "active" } },
    () => invokeRoute(baseQuery),
  );
}

test("blocked and inactive authenticated accounts are rejected", async () => {
  for (const status of ["blocked", "inactive"]) {
    const response = await withModelMocks(
      { user: { _id: adminId, userType: "admin", status } },
      () => invokeRoute(baseQuery),
    );
    assert.equal(response.statusCode, 403);
  }
});

test("employee query is projected, paginated, sorted, counted, and includes historical statuses", async () => {
  const employees = [
    makeEmployee(employeeId2, { status: "resigned" }),
    makeEmployee(employeeId1, { status: "on_leave" }),
  ];
  await withModelMocks({ employees }, async (calls) => {
    const response = await invokeRoute({
      ...baseQuery,
      page: "1",
      limit: "1",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(calls.employeeFind.length, 1);
    assert.equal(calls.employeeCount.length, 1);
    assert.deepEqual(calls.employeeFind[0].filter, {});
    assert.strictEqual(calls.employeeCount[0], calls.employeeFind[0].filter);
    assert.equal(calls.employeeFind[0].select, "_id employeeCode joiningDate effectiveExitDate");
    assert.deepEqual(calls.employeeFind[0].sort, { _id: 1 });
    assert.equal(calls.employeeFind[0].skip, 0);
    assert.equal(calls.employeeFind[0].limit, 1);
    assert.equal(response.body.data.pagination.totalEmployees, 2);
    assert.deepEqual(
      response.body.data.employees.map(({ employeeId }) => employeeId),
      [employeeId1],
    );
    assert.equal(response.body.data.employees[0].employeeCode, "EMP-001");
  });
});

test("employee selection includes every current employment status", async () => {
  const statuses = ["active", "inactive", "resigned", "on_leave"];
  const employees = statuses.map((status, index) =>
    makeEmployee((index + 1).toString(16).padStart(24, "0"), { status }),
  );
  await withModelMocks({ employees }, async (calls) => {
    const response = await invokeRoute({
      ...baseQuery,
      limit: "100",
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls.employeeFind[0].filter, {});
    assert.equal(response.body.data.employees.length, statuses.length);
  });
});

test("employee filter uses the exact ID and pagination defaults to 1 and 25", async () => {
  await withModelMocks(
    { employees: [makeEmployee(employeeId2), makeEmployee(employeeId1)] },
    async (calls) => {
      const response = await invokeRoute({
        ...baseQuery,
        employeeId: employeeId2,
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls.employeeFind[0].filter, { _id: employeeId2 });
      assert.deepEqual(calls.employeeCount[0], { _id: employeeId2 });
      assert.equal(calls.employeeFind[0].skip, 0);
      assert.equal(calls.employeeFind[0].limit, 25);
      assert.equal(response.body.data.pagination.page, 1);
      assert.equal(response.body.data.pagination.limit, 25);
      assert.equal(response.body.data.pagination.totalEmployees, 1);
    },
  );
});

test("calculator receives at most 100 employees and response preserves its report details", async () => {
  const employees = Array.from({ length: 105 }, (_, index) =>
    makeEmployee((index + 1).toString(16).padStart(24, "0")),
  );
  await withModelMocks({ employees }, async (calls) => {
    const response = await invokeRoute({
      ...baseQuery,
      limit: "100",
      asOf,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.employees.length, 100);
    assert.equal(calls.attendanceFilter.employeeId.$in.length, 100);
    assert.equal(calls.holidays, 1);
    assert.equal(calls.attendance, 1);
    assert.equal(calls.overrides, 1);
    assert.equal(response.body.data.asOf.toISOString(), asOf);
    assert.equal(response.body.data.employees[0].summary.eligibleWorkingDays, 3);
    assert.equal(response.body.data.employees[0].dailyDetails.length, 3);
  });
});

test("summary and daily details retain calculator output for recorded attendance", async () => {
  const employee = makeEmployee(employeeId1);
  const attendance = {
    employeeId: employeeId1,
    attendanceDate: "2026-11-02",
    checkInAt: new Date("2026-11-02T03:00:00.000Z"),
    checkOutAt: new Date("2026-11-02T10:00:00.000Z"),
    checkOutSource: "employee",
    checkOutRecordedBy: adminId,
  };
  await withModelMocks(
    { employees: [employee], attendanceRecords: [attendance] },
    async () => {
      const response = await invokeRoute({
        fromDate: "2026-11-02",
        toDate: "2026-11-02",
        asOf,
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body.data.employees[0].summary, {
        eligibleWorkingDays: 1,
        presentDays: 1,
        incompleteDays: 0,
        absentDays: 0,
        notRecordedDays: 0,
        attendancePercentage: 100,
        workedDurationMs: 7 * 60 * 60 * 1000,
        finalizedWorkedDurationMs: 7 * 60 * 60 * 1000,
        provisionalWorkedDurationMs: 0,
      });
      assert.deepEqual(response.body.data.employees[0].dailyDetails, [
        {
          attendanceDate: "2026-11-02",
          status: "present",
          calculatedStatus: "present",
          statusOrigin: "recorded",
          checkInAt: attendance.checkInAt,
          checkOutAt: attendance.checkOutAt,
          checkoutState: "checked_out",
          checkOutSource: "employee",
          workedDurationMs: 7 * 60 * 60 * 1000,
          durationIsProvisional: false,
        },
      ]);
    },
  );
});

test("empty page returns pagination and a stable calculation cutoff", async () => {
  await withModelMocks({ employees: [] }, async (calls) => {
    const response = await invokeRoute({
      ...baseQuery,
      page: "2",
      limit: "25",
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data.employees, []);
    assert.equal(response.body.data.pagination.page, 2);
    assert.equal(response.body.data.pagination.totalEmployees, 0);
    assert.equal(response.body.data.pagination.totalPages, 0);
    assert.ok(response.body.data.asOf instanceof Date);
    assert.ok(Number.isFinite(response.body.data.asOf.getTime()));
    assert.equal(calls.holidays, 0);
    assert.equal(calls.attendance, 0);
    assert.equal(calls.overrides, 0);
  });
});

test("omitted asOf uses the calculator result and supplied asOf is passed through", async () => {
  await withModelMocks({}, async () => {
    const defaultResponse = await invokeRoute(baseQuery);
    assert.equal(defaultResponse.statusCode, 200);
    assert.ok(defaultResponse.body.data.asOf instanceof Date);

    const suppliedResponse = await invokeRoute({ ...baseQuery, asOf });
    assert.equal(suppliedResponse.statusCode, 200);
    assert.equal(suppliedResponse.body.data.asOf.toISOString(), asOf);
  });
});

test("employee, calculator, and bulk-query failures return sanitized server errors", async () => {
  const databaseErrorCases = [
    { employeeFindError: new Error("private employee lookup details") },
    { employeeCountError: new Error("private employee count details") },
    { reportQueryError: "holiday" },
    { reportQueryError: "attendance" },
    { reportQueryError: "override" },
  ];
  for (const mockValues of databaseErrorCases) {
    await withModelMocks(mockValues, async () => {
      const response = await invokeRoute(baseQuery);
      assert.equal(response.statusCode, 500);
      assert.equal(response.body.message, "Internal Server Error");
      assert.deepEqual(response.body.errors, []);
      assert.doesNotMatch(JSON.stringify(response.body), /private|stack|database/i);
    });
  }
});

test("invalid stored attendance data returns a sanitized server error", async () => {
  await withModelMocks(
    {
      attendanceRecords: [
        {
          employeeId: employeeId1,
          attendanceDate: "2026-11-02",
          checkInAt: new Date("2026-11-02T03:00:00.000Z"),
          checkOutAt: new Date("2026-11-02T10:00:00.000Z"),
          checkOutSource: "invalid-source",
        },
      ],
    },
    async () => {
      const response = await invokeRoute({
        fromDate: "2026-11-02",
        toDate: "2026-11-02",
        asOf,
      });
      assert.equal(response.statusCode, 500);
      assert.equal(response.body.message, "Internal Server Error");
      assert.deepEqual(response.body.errors, []);
      assert.doesNotMatch(JSON.stringify(response.body), /checkOutSource|stack/i);
    },
  );
});
