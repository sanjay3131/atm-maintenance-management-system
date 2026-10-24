import test from "node:test";
import assert from "node:assert/strict";
import attendanceRouter from "../src/modules/attendance/attendance.routes.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";
import { authorizeRoles } from "../src/middlewares/role.middleware.js";
import { getAdminAttendanceDashboard } from "../src/modules/attendance/attendance.service.js";
import Attendance from "../src/modules/attendance/attendance.model.js";
import AttendanceStatusOverride from "../src/modules/attendance/attendanceStatusOverride.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import User from "../src/modules/users/user.model.js";

const id = (number) => `64b00000000000000000000${number}`;
const admin = { _id: id(9), userType: "admin" };
const today = "2026-10-12";
const checkInAt = new Date("2026-10-12T03:00:00.000Z");
const checkOutAt = new Date("2026-10-12T12:00:00.000Z");

const makeEmployee = (number, overrides = {}) => ({
  _id: id(number),
  employeeCode: `EMP-${number}`,
  status: "active",
  userId: {
    _id: id(number + 20),
    firstName: `Person${number}`,
    lastName: "Example",
    userType: "employee",
    status: "active",
    avatar: { url: `https://images.example/${number}.jpg` },
  },
  ...overrides,
});

const makeAttendance = (employee, checkOut = checkOutAt) => ({
  _id: id(Number(employee._id.slice(-1)) + 40),
  employeeId: employee._id,
  attendanceDate: today,
  checkInAt,
  checkOutAt: checkOut,
  checkInSource: "employee",
  checkOutSource: checkOut ? "employee" : null,
  checkInRecordedBy: employee.userId._id,
  checkOutRecordedBy: checkOut ? employee.userId._id : null,
});

const getDashboardRoute = () =>
  attendanceRouter.stack.find(
    (layer) =>
      layer.route?.path === "/admin/dashboard" &&
      layer.route.methods.get,
  )?.route;

const runMiddleware = (middleware, req) =>
  new Promise((resolve) => {
    Promise.resolve(middleware(req, {}, (error) => resolve(error))).catch(
      resolve,
    );
  });

async function withMocks(
  { employees = [], records = [], overrides = [], supervisors = [] },
  callback,
) {
  const originals = [
    [Employee, "find", Employee.find],
    [User, "find", User.find],
    [Attendance, "find", Attendance.find],
    [AttendanceStatusOverride, "find", AttendanceStatusOverride.find],
  ];
  const query = (items) => ({
    select() {
      return Promise.resolve(items);
    },
    populate() {
      return Promise.resolve(items);
    },
  });
  Employee.find = (filter) => {
    assert.deepEqual(filter, { status: "active" });
    return {
      select(fields) {
        assert.equal(fields, "employeeCode status userId");
        return {
          populate(options) {
            assert.equal(options.path, "userId");
            assert.equal(
              options.select,
              "firstName lastName userType status avatar.url",
            );
            return Promise.resolve(
              employees.filter((employee) => employee.status === filter.status),
            );
          },
        };
      },
    };
  };
  User.find = (filter) => {
    assert.deepEqual(filter, { userType: "supervisor" });
    return {
      select(fields) {
        assert.equal(fields, "_id firstName lastName status avatar.url");
        return Promise.resolve(supervisors);
      },
    };
  };
  Attendance.find = (filter) => {
    assert.equal(filter.attendanceDate, today);
    const subjectField = filter.supervisorUserId
      ? "supervisorUserId"
      : "employeeId";
    const subjectIds = new Set(filter[subjectField].$in.map(String));
    return query(
      records.filter(
        (record) => subjectIds.has(String(record[subjectField])),
      ),
    );
  };
  AttendanceStatusOverride.find = (filter) => {
    assert.equal(filter.attendanceDate, today);
    const employeeIds = new Set(filter.employeeId.$in.map(String));
    return query(
      overrides.filter(
        (override) => employeeIds.has(String(override.employeeId)),
      ),
    );
  };

  try {
    await callback();
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
}

test("Admin dashboard defaults to today's Asia/Kolkata business date", async () => {
  await withMocks({ employees: [], records: [], overrides: [] }, async () => {
    const result = await getAdminAttendanceDashboard(
      admin,
      {},
      new Date("2026-10-11T19:00:00.000Z"),
    );
    assert.equal(result.date, today);
    assert.equal(result.timeZone, "Asia/Kolkata");
    assert.deepEqual(result.summary.employees, {
      total: 0,
      present: 0,
      absent: 0,
      incomplete: 0,
      unrecorded: 0,
    });
    assert.deepEqual(result.summary.supervisors, {
      total: 0,
      present: 0,
      absent: 0,
      incomplete: 0,
      unrecorded: 0,
    });
  });
});

test("dashboard excludes inactive Employees from rows and summary counts", async () => {
  const activeEmployee = makeEmployee(1);
  const inactiveEmployee = makeEmployee(2, { status: "inactive" });

  await withMocks(
    {
      employees: [activeEmployee, inactiveEmployee],
      records: [makeAttendance(activeEmployee), makeAttendance(inactiveEmployee)],
      overrides: [
        {
          employeeId: inactiveEmployee._id,
          attendanceDate: today,
          status: "absent",
        },
      ],
    },
    async () => {
      const result = await getAdminAttendanceDashboard(
        admin,
        { date: today },
        new Date("2026-10-12T12:00:00.000Z"),
      );

      assert.deepEqual(
        result.records.map((row) => row.employee.id),
        [activeEmployee._id],
      );
      assert.deepEqual(result.summary.employees, {
        total: 1,
        present: 1,
        absent: 0,
        incomplete: 0,
        unrecorded: 0,
      });
    },
  );
});

test("dashboard computes status precedence and summary independently of list filters", async () => {
  const completed = makeEmployee(1);
  const incomplete = makeEmployee(2);
  const markedAbsent = makeEmployee(3);
  const unrecorded = makeEmployee(4);
  const supervisor = makeEmployee(5, {
    userId: {
      _id: id(25),
      firstName: "Sam",
      lastName: "Supervisor",
      userType: "supervisor",
      status: "active",
      avatar: {},
    },
  });
  const records = [
    makeAttendance(completed),
    makeAttendance(incomplete, null),
    makeAttendance(markedAbsent),
  ];
  const overrides = [
    {
      employeeId: markedAbsent._id,
      attendanceDate: today,
      status: "absent",
    },
  ];

  await withMocks(
    {
      employees: [completed, incomplete, markedAbsent, unrecorded, supervisor],
      records,
      overrides,
    },
    async () => {
      const result = await getAdminAttendanceDashboard(
        admin,
        {
          date: today,
          search: "Person",
          role: "employee",
          status: "absent",
          page: 1,
          limit: 20,
        },
        new Date("2026-10-12T12:00:00.000Z"),
      );
      assert.deepEqual(result.summary.employees, {
        total: 4,
        present: 1,
        absent: 1,
        incomplete: 1,
        unrecorded: 1,
      });
      assert.equal(result.records.length, 1);
      assert.equal(result.records[0].employee.id, markedAbsent._id);
      assert.equal(result.records[0].attendance.effectiveStatus, "absent");
      assert.equal(
        result.records[0].attendance.statusOrigin,
        "admin_override",
      );
      assert.equal(result.records[0].attendance.actualCheckInAt, checkInAt);
      assert.equal(result.records[0].attendance.actualCheckOutAt, checkOutAt);
      assert.equal("audit" in result.records[0], false);
      assert.equal("reason" in result.records[0].attendance, false);
    },
  );
});

test("dashboard distinguishes incomplete, recorded, and unrecorded attendance", async () => {
  const incomplete = makeEmployee(1);
  const unrecorded = makeEmployee(2);
  await withMocks(
    {
      employees: [incomplete, unrecorded],
      records: [makeAttendance(incomplete, null)],
      overrides: [],
    },
    async () => {
      const result = await getAdminAttendanceDashboard(
        admin,
        { date: today },
        new Date("2026-10-12T12:00:00.000Z"),
      );
      const incompleteRow = result.records.find(
        (row) => row.employee.id === incomplete._id,
      );
      const unrecordedRow = result.records.find(
        (row) => row.employee.id === unrecorded._id,
      );
      assert.equal(incompleteRow.attendance.effectiveStatus, "incomplete");
      assert.equal(incompleteRow.attendance.statusOrigin, "recorded");
      assert.equal(unrecordedRow.attendance.effectiveStatus, "unrecorded");
      assert.equal(unrecordedRow.attendance.statusOrigin, "no_record");
      assert.equal(unrecordedRow.attendance.id, null);
    },
  );
});

test("dashboard scopes each role and supports search and pagination", async () => {
  const first = makeEmployee(1);
  const second = makeEmployee(2, { employeeCode: "TARGET-2" });
  const supervisor = makeEmployee(3, {
    userId: {
      _id: id(23),
      firstName: "Target",
      lastName: "Supervisor",
      userType: "supervisor",
      status: "inactive",
      avatar: {},
    },
  });
  await withMocks(
    {
      employees: [first, second, supervisor],
      supervisors: [
        {
          _id: id(29),
          firstName: "Target",
          lastName: "Supervisor",
          userType: "supervisor",
          status: "active",
          avatar: {},
        },
      ],
      records: [],
      overrides: [],
    },
    async () => {
      const byCode = await getAdminAttendanceDashboard(
        admin,
        { date: today, search: "target-2", role: "all" },
        new Date("2026-10-12T12:00:00.000Z"),
      );
      assert.equal(byCode.pagination.total, 1);
      assert.equal(byCode.records[0].employee.id, second._id);
      assert.equal(byCode.records[0].employee.role, "employee");

      const byName = await getAdminAttendanceDashboard(
        admin,
        { date: today, search: "supervisor", role: "supervisor" },
        new Date("2026-10-12T12:00:00.000Z"),
      );
      assert.equal(byName.pagination.total, 1);
      assert.equal(byName.records.length, 1);
      assert.equal(byName.records[0].employee.role, "supervisor");
      assert.equal(byName.summary.employees.total, 2);
      assert.equal(byName.summary.supervisors.total, 1);

      const paged = await getAdminAttendanceDashboard(
        admin,
        { date: today, page: 2, limit: 1, role: "employee" },
        new Date("2026-10-12T12:00:00.000Z"),
      );
      assert.equal(paged.records.length, 1);
      assert.equal(paged.pagination.total, 2);
      assert.equal(paged.pagination.totalPages, 2);
    },
  );
});

test("Admin dashboard exposes supervisor records separately without employee overrides", async () => {
  const supervisor = {
    _id: id(31),
    firstName: "Casey",
    lastName: "Supervisor",
    userType: "supervisor",
    status: "active",
    avatar: { url: "https://images.example/supervisor.jpg" },
  };
  const attendance = {
    _id: id(41),
    supervisorUserId: supervisor._id,
    attendanceDate: today,
    checkInAt,
    checkOutAt,
    checkInSource: "supervisor",
    checkOutSource: "supervisor",
  };
  await withMocks(
    { supervisors: [supervisor], records: [attendance] },
    async () => {
      const result = await getAdminAttendanceDashboard(
        admin,
        { date: today, role: "supervisor" },
        new Date("2026-10-12T12:00:00.000Z"),
      );
      assert.equal(result.records.length, 1);
      assert.deepEqual(result.records[0].employee, {
        id: supervisor._id,
        employeeCode: null,
        name: "Casey Supervisor",
        role: "supervisor",
        avatarUrl: supervisor.avatar.url,
        employeeStatus: null,
        userStatus: "active",
      });
      assert.equal(result.records[0].attendance.id, attendance._id);
      assert.equal(result.records[0].attendance.effectiveStatus, "present");
      assert.deepEqual(result.summary.supervisors, {
        total: 1,
        present: 1,
        absent: 0,
        incomplete: 0,
        unrecorded: 0,
      });
      assert.equal(result.summary.employees.total, 0);
    },
  );
});

test("dashboard projects safe identity fields and handles missing User references", async () => {
  const linked = makeEmployee(1);
  const unlinked = makeEmployee(2, { userId: null });
  const orphanAttendance = makeAttendance(makeEmployee(8));
  await withMocks(
    {
      employees: [linked, unlinked],
      records: [orphanAttendance],
      overrides: [],
    },
    async () => {
      const result = await getAdminAttendanceDashboard(
        admin,
        { date: today },
        new Date("2026-10-12T12:00:00.000Z"),
      );
      const linkedRow = result.records.find(
        (row) => row.employee.id === linked._id,
      );
      const missingUserRow = result.records.find(
        (row) => row.employee.id === unlinked._id,
      );
      assert.deepEqual(Object.keys(linkedRow.employee).sort(), [
        "avatarUrl",
        "employeeCode",
        "employeeStatus",
        "id",
        "name",
        "role",
        "userStatus",
      ]);
      assert.equal(linkedRow.employee.avatarUrl, "https://images.example/1.jpg");
      assert.equal(missingUserRow.employee.name, "Unknown employee");
      assert.equal(missingUserRow.employee.role, "employee");
      assert.equal(missingUserRow.employee.avatarUrl, null);
      assert.equal(missingUserRow.employee.userStatus, null);
      assert.equal(result.records.length, 2);
      assert.equal(result.pagination.total, 2);
    },
  );
});

test("dashboard tolerates an Employee whose linked User no longer exists", async () => {
  const danglingUserEmployee = makeEmployee(1, { userId: null });

  await withMocks(
    { employees: [danglingUserEmployee], records: [], overrides: [] },
    async () => {
      const result = await getAdminAttendanceDashboard(
        admin,
        { date: today },
        new Date("2026-10-12T12:00:00.000Z"),
      );

      assert.equal(result.records.length, 1);
      assert.equal(result.records[0].employee.id, danglingUserEmployee._id);
      assert.equal(result.records[0].employee.name, "Unknown employee");
      assert.equal(result.records[0].employee.avatarUrl, null);
      assert.equal(result.records[0].employee.userStatus, null);
      assert.equal(result.summary.employees.total, 1);
    },
  );
});

test("dashboard service denies non-admin roles and rejects invalid date/query values", async () => {
  await withMocks({ employees: [], records: [], overrides: [] }, async () => {
    for (const userType of ["employee", "supervisor", "customer"]) {
      await assert.rejects(
        getAdminAttendanceDashboard(
          { _id: id(8), userType },
          { date: today },
        ),
        (error) => error.statusCode === 403,
      );
    }
    for (const filters of [
      { date: "2026-02-30" },
      { date: today, role: "customer" },
      { date: today, status: "late" },
      { date: today, page: "0" },
      { date: today, limit: "101" },
      { date: today, secret: "unexpected" },
    ]) {
      await assert.rejects(
        getAdminAttendanceDashboard(admin, filters),
        (error) => error.statusCode === 400,
      );
    }
  });
});

test("dashboard endpoint requires authentication and Admin/superAdmin authorization", async () => {
  const route = getDashboardRoute();
  assert.ok(route);
  assert.equal(route.stack[0].handle, verifyAccessToken);
  for (const role of ["admin", "superAdmin"]) {
    assert.doesNotThrow(() =>
      route.stack[1].handle({ user: { userType: role } }, {}, () => {}),
    );
  }
  for (const role of ["employee", "supervisor", "customer"]) {
    assert.throws(
      () =>
        route.stack[1].handle({ user: { userType: role } }, {}, () => {}),
      { statusCode: 403 },
    );
  }
  assert.equal(route.stack.length, 4);
  const req = { query: {} };
  const validationError = await runMiddleware(route.stack[2].handle, req);
  assert.equal(validationError, undefined);
  assert.deepEqual(req.validatedQuery, {
    role: "all",
    status: "all",
    page: 1,
    limit: 20,
  });

  const supervisorFilterRequest = {
    query: { role: "supervisor" },
  };
  const supervisorFilterError = await runMiddleware(
    route.stack[2].handle,
    supervisorFilterRequest,
  );
  assert.equal(supervisorFilterError, undefined);
  assert.equal(supervisorFilterRequest.validatedQuery.role, "supervisor");
});
