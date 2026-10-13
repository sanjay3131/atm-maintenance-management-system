import test from "node:test";
import assert from "node:assert/strict";
import Attendance from "../src/modules/attendance/attendance.model.js";
import AttendanceStatusOverride from "../src/modules/attendance/attendanceStatusOverride.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import attendanceRouter from "../src/modules/attendance/attendance.routes.js";
import {
  attendanceCalendarQuerySchema,
} from "../src/modules/attendance/attendance.validation.js";
import {
  getEmployeeAttendanceCalendar,
} from "../src/modules/attendance/attendance.service.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";

const employeeId = "64b000000000000000000041";

const withMocks = async (
  { employee = { _id: employeeId }, records = [], overrides = [] },
  callback,
) => {
  const originalEmployeeFindById = Employee.findById;
  const originalAttendanceFind = Attendance.find;
  const originalOverrideFind = AttendanceStatusOverride.find;
  const filters = {};

  Employee.findById = (id) => {
    filters.employeeId = id;
    return {
      select: async () => employee,
    };
  };
  Attendance.find = (filter) => {
    filters.records = filter;
    return { select: async () => records };
  };
  AttendanceStatusOverride.find = (filter) => {
    filters.overrides = filter;
    return { select: async () => overrides };
  };

  try {
    await callback(filters);
  } finally {
    Employee.findById = originalEmployeeFindById;
    Attendance.find = originalAttendanceFind;
    AttendanceStatusOverride.find = originalOverrideFind;
  }
};

test("attendance calendar batches a month and applies only explicit overrides", async () => {
  const checkInAt = new Date("2026-10-09T18:45:00.000Z");
  const checkOutAt = new Date("2026-10-10T11:45:00.000Z");
  await withMocks(
    {
      records: [
        {
          attendanceDate: "2026-10-10",
          checkInAt,
          checkOutAt,
        },
        {
          attendanceDate: "2026-10-11",
          checkInAt,
          checkOutAt: null,
        },
      ],
      overrides: [
        { attendanceDate: "2026-10-12", status: "absent" },
        { attendanceDate: "2026-10-10", status: "incomplete" },
      ],
    },
    async (filters) => {
      const calendar = await getEmployeeAttendanceCalendar({
        employeeId,
        month: "2026-10",
        actor: { _id: "64b000000000000000000042", userType: "admin" },
      });
      assert.equal(filters.employeeId, employeeId);
      assert.deepEqual(filters.records, {
        employeeId,
        attendanceDate: { $gte: "2026-10-01", $lte: "2026-10-31" },
      });
      assert.deepEqual(filters.overrides, filters.records);
      assert.equal(calendar.timeZone, "Asia/Kolkata");
      assert.deepEqual(
        calendar.days.map(({ attendanceDate, status, statusOrigin }) => ({
          attendanceDate,
          status,
          statusOrigin,
        })),
        [
          {
            attendanceDate: "2026-10-10",
            status: "incomplete",
            statusOrigin: "admin_override",
          },
          {
            attendanceDate: "2026-10-11",
            status: "incomplete",
            statusOrigin: "recorded",
          },
          {
            attendanceDate: "2026-10-12",
            status: "absent",
            statusOrigin: "admin_override",
          },
        ],
      );
      assert.equal(calendar.days[0].checkInAt, checkInAt);
      assert.equal(calendar.days[0].checkOutAt, checkOutAt);
    },
  );
});

test("attendance calendar does not convert missing records to absent", async () => {
  await withMocks({}, async () => {
    const calendar = await getEmployeeAttendanceCalendar({
      employeeId,
      month: "2026-02",
      actor: { _id: "64b000000000000000000042", userType: "superAdmin" },
    });
    assert.deepEqual(calendar.days, []);
  });
});

test("attendance calendar validates month and employee and requires admin access", async () => {
  assert.equal(attendanceCalendarQuerySchema.safeParse({ month: "2026-02" }).success, true);
  for (const month of ["2026-13", "2026-2", "0000-01", "2026-02-01"]) {
    assert.equal(attendanceCalendarQuerySchema.safeParse({ month }).success, false);
  }

  await withMocks({}, async () => {
    await assert.rejects(
      getEmployeeAttendanceCalendar({
        employeeId: "invalid",
        month: "2026-02",
        actor: { _id: "64b000000000000000000042", userType: "admin" },
      }),
      { statusCode: 400 },
    );
    await assert.rejects(
      getEmployeeAttendanceCalendar({
        employeeId,
        month: "2026-02",
        actor: { _id: "64b000000000000000000042", userType: "employee" },
      }),
      { statusCode: 403 },
    );
  });
});

test("attendance calendar route is authenticated, validated, and admin-only", () => {
  const route = attendanceRouter.stack.find(
    (layer) =>
      layer.route?.path === "/admin/employees/:employeeId/calendar",
  )?.route;
  assert.ok(route);
  assert.equal(route.methods.get, true);
  assert.equal(route.stack[0].handle, verifyAccessToken);
  const authorize = route.stack[1].handle;
  for (const userType of ["admin", "superAdmin"]) {
    let passed = false;
    authorize({ user: { userType } }, {}, () => {
      passed = true;
    });
    assert.equal(passed, true);
  }
  assert.throws(
    () =>
      authorize({ user: { userType: "supervisor" } }, {}, () => {}),
    { statusCode: 403 },
  );
  assert.equal(route.stack.length, 5);
});
