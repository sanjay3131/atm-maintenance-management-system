import test from "node:test";
import assert from "node:assert/strict";
import Employee from "../src/modules/employees/employee.model.js";
import User from "../src/modules/users/user.model.js";
import Attendance from "../src/modules/attendance/attendance.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import AMC from "../src/modules/amc/amc.model.js";
import ATM from "../src/modules/atms/atm.model.js";
import {
  getSupervisorDashboard,
  getSupervisorEmployeeDetails,
} from "../src/modules/supervisor/supervisor.controller.js";
import {
  supervisorJobQuerySchema,
  supervisorEmployeeParamsSchema,
  supervisorJobParamsSchema,
} from "../src/modules/supervisor/supervisor.validation.js";
import supervisorRoutes from "../src/modules/supervisor/supervisor.routes.js";

const supervisorId = "64b000000000000000000001";
const otherSupervisorId = "64b000000000000000000002";
const userId = "64b000000000000000000003";
const employeeId = "64b000000000000000000004";
const atmId = "64b000000000000000000005";

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

const query = (value) => ({
  select() {
    return this;
  },
  sort() {
    return this;
  },
  skip() {
    return this;
  },
  limit() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

test("supervisor employee detail verifies live assignment and both ATM assignment references", async () => {
  const originals = [Employee.findOne, User.findOne, ATM.find];
  const employee = {
    _id: employeeId,
    userId,
    employeeCode: "EMP-1",
    assignedAtmIds: [atmId],
  };
  const atm = {
    _id: atmId,
    atmId: "ATM-001",
    locationName: "Branch",
    address: "Main road",
    status: "ACTIVE",
  };
  let atmFilter;
  Employee.findOne = (filter) =>
    query(filter.supervisorId === supervisorId ? employee : null);
  User.findOne = () => query({ _id: userId, userType: "employee" });
  ATM.find = (filter) => {
    atmFilter = filter;
    return query([atm]);
  };

  try {
    const result = await invoke(getSupervisorEmployeeDetails, {
      validatedParams: { employeeId },
      user: { _id: supervisorId, userType: "supervisor" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.employee.name, null);
    assert.equal(result.body.data.assignedAtms[0]._id, atmId);
    assert.deepEqual(atmFilter, {
      _id: { $in: [atmId] },
      assignedEmployeeId: employeeId,
      isDeleted: false,
    });

    await assert.rejects(
      invoke(getSupervisorEmployeeDetails, {
        validatedParams: { employeeId },
        user: { _id: otherSupervisorId, userType: "supervisor" },
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    Employee.findOne = originals[0];
    User.findOne = originals[1];
    ATM.find = originals[2];
  }
});

test("supervisor dashboard aggregates only current direct reports and persisted statuses", async () => {
  const originals = [
    Employee.find,
    User.find,
    Attendance.find,
    Job.aggregate,
    Job.countDocuments,
    AMC.aggregate,
  ];
  const otherEmployeeId = "64b000000000000000000006";
  const reports = [
    { _id: employeeId, userId },
    { _id: otherEmployeeId, userId: "64b000000000000000000007" },
  ];
  const assignedUsers = reports.map((employee) => ({
    _id: employee.userId,
    userType: "employee",
    firstName: "Assigned",
    lastName: "Person",
  }));
  let employeeFilter;
  let attendanceFilter;
  const jobPipelines = [];
  let amcPipeline;
  Employee.find = (filter) => {
    employeeFilter = filter;
    return query(reports);
  };
  User.find = () => query(assignedUsers);
  Attendance.find = (filter) => {
    attendanceFilter = filter;
    return query([{ employeeId, checkInAt: new Date(), checkOutAt: null }]);
  };
  Job.aggregate = (pipeline) => {
    jobPipelines.push(pipeline);
    return Promise.resolve(
      pipeline.some((stage) => stage.$group)
        ? [
            { _id: "PENDING", count: 2 },
            { _id: "IN_PROGRESS", count: 1 },
            { _id: "COMPLETED", count: 5 },
          ]
        : [
            {
              _id: "64b000000000000000000008",
              jobId: "JOB-1",
              action: "status_changed",
              toStatus: "COMPLETED",
              occurredAt: new Date(),
            },
          ],
    );
  };
  AMC.aggregate = (pipeline) => {
    amcPipeline = pipeline;
    return Promise.resolve([
      { _id: "PENDING", count: 3 },
      { _id: "COMPLETED", count: 2 },
    ]);
  };
  Job.countDocuments = (filter) => {
    assert.equal(
      filter.assignedEmployeeId.$in.map(String).includes(userId),
      true,
    );
    assert.equal(filter.assignedEmployeeId.$in.includes(otherSupervisorId), false);
    return Promise.resolve(4);
  };

  try {
    const result = await invoke(getSupervisorDashboard, {
      validatedQuery: { date: "2026-04-12" },
      user: { _id: supervisorId, userType: "supervisor" },
    });
    assert.deepEqual(employeeFilter, { supervisorId });
    assert.deepEqual(attendanceFilter, {
      employeeId: { $in: [employeeId, otherEmployeeId] },
      attendanceDate: "2026-04-12",
    });
    const jobStatusPipeline = jobPipelines.find((pipeline) =>
      pipeline.some((stage) => stage.$group),
    );
    const activityPipeline = jobPipelines.find((pipeline) =>
      pipeline.some((stage) => stage.$lookup),
    );
    assert.deepEqual(jobStatusPipeline[0].$match.assignedEmployeeId.$in, assignedUsers.map(({ _id }) => _id));
    assert.deepEqual(activityPipeline[0].$match.assignedEmployeeId.$in, assignedUsers.map(({ _id }) => _id));
    assert.deepEqual(amcPipeline[0].$match.employeeId.$in, assignedUsers.map(({ _id }) => _id));
    assert.equal(result.body.data.jobs.byStatus.PENDING, 2);
    assert.equal(result.body.data.jobs.byStatus.IN_PROGRESS, 1);
    assert.equal(result.body.data.jobs.byStatus.COMPLETED, 5);
    assert.equal(result.body.data.jobs.overdue, 4);
    assert.equal(result.body.data.attendance.records, 1);
  } finally {
    Employee.find = originals[0];
    User.find = originals[1];
    Attendance.find = originals[2];
    Job.aggregate = originals[3];
    Job.countDocuments = originals[4];
    AMC.aggregate = originals[5];
  }
});

test("supervisor read route IDs reject malformed ObjectIds", () => {
  assert.equal(
    supervisorEmployeeParamsSchema.safeParse({ employeeId: "bad-id" }).success,
    false,
  );
  assert.equal(
    supervisorJobParamsSchema.safeParse({ jobId: "bad-id" }).success,
    false,
  );
  assert.equal(
    supervisorJobQuerySchema.safeParse({ status: "NOT_A_JOB_STATUS" }).success,
    false,
  );
});

test("supervisor APIs reject unauthenticated requests and non-supervisor roles", async () => {
  const [authenticate, authorize] = supervisorRoutes.stack.slice(0, 2).map((layer) => layer.handle);
  const runMiddleware = (middleware, req) =>
    new Promise((resolve, reject) => {
      try {
        middleware(req, {}, (error) => (error ? reject(error) : resolve()));
      } catch (error) {
        reject(error);
      }
    });

  await assert.rejects(
    runMiddleware(authenticate, { headers: {} }),
    (error) => error.statusCode === 401,
  );
  await assert.rejects(
    runMiddleware(authorize, { user: { userType: "employee" } }),
    (error) => error.statusCode === 403,
  );
});
