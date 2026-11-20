import test from "node:test";
import assert from "node:assert/strict";
import { authorizeRoles } from "../src/middlewares/role.middleware.js";
import ATM from "../src/modules/atms/atm.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import Notification from "../src/modules/notification/notification.model.js";
import User from "../src/modules/users/user.model.js";
import {
  acceptJob,
  completeJob,
  holdJob,
  reassignJob,
  startJob,
} from "../src/modules/jobs/jobs.controller.js";

const jobId = "64b000000000000000000091";
const atmId = "64b000000000000000000092";
const employeeId = "64b000000000000000000093";
const employeeUserId = "64b000000000000000000094";
const nextEmployeeId = "64b000000000000000000095";
const nextEmployeeUserId = "64b000000000000000000096";
const adminId = "64b000000000000000000097";
const superAdminId = "64b000000000000000000098";

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

const makeQuery = (value) => ({
  populate() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const snapshotJob = (job) =>
  Object.fromEntries(
    [
      "status",
      "assignedEmployeeId",
      "acceptedAt",
      "startedAt",
      "completedAt",
      "employeeGpsAtCompletion",
      "gpsDistance",
      "gpsValidated",
      "employeeRemarks",
      "beforePhotos",
      "afterPhotos",
      "updatedBy",
    ].map((key) => [
      key,
      Array.isArray(job[key])
        ? [...job[key]]
        : job[key] && typeof job[key] === "object"
          ? { ...job[key] }
          : job[key],
    ]),
  );

const makeJob = (status) => ({
  _id: jobId,
  atmId,
  assignedEmployeeId: employeeUserId,
  assignedBy: adminId,
  status,
  isDeleted: false,
  acceptedAt: new Date("2026-10-01T09:00:00.000Z"),
  startedAt: new Date("2026-10-01T09:30:00.000Z"),
  completedAt: new Date("2026-10-01T10:00:00.000Z"),
  employeeGpsAtCompletion: {
    latitude: 12.5,
    longitude: 77.5,
    accuracy: 3,
    timestamp: new Date("2026-10-01T10:00:00.000Z"),
  },
  gpsDistance: 4,
  gpsValidated: true,
  employeeRemarks: "Existing remarks",
  beforePhotos: ["before-1", "before-2", "before-3"],
  afterPhotos: ["after-1", "after-2", "after-3"],
  reassignmentHistory: [],
  saveCalls: 0,
  async save() {
    this.saveCalls += 1;
    return this;
  },
});

const makeEmployee = (status, linkedUserStatus = "active", userId = employeeUserId) => ({
  _id: userId === employeeUserId ? employeeId : nextEmployeeId,
  status,
  userId: {
    _id: userId,
    status: linkedUserStatus,
    userType: "employee",
  },
});

const employeeRequest = (status) => ({
  params: { id: jobId },
  body:
    status === "IN_PROGRESS"
      ? { gps: { latitude: 0, longitude: 0, accuracy: 5 } }
      : {},
  user: { _id: employeeUserId, userType: "employee" },
  headers: {},
});

async function withLifecycleMocks(
  { status, employeeStatus = "active", userStatus = "active" },
  callback,
) {
  const job = makeJob(status);
  const atm = {
    _id: atmId,
    locationConfigured: true,
    location: { coordinates: [0, 0] },
    assignedEmployeeId: [employeeId],
  };
  const historyEntries = [];
  const employeeLookups = [];
  const notifications = [];
  const employee = makeEmployee(employeeStatus, userStatus);
  const originals = [
    [Job, "findById", Job.findById],
    [JobHistory, "create", JobHistory.create],
    [JobPhoto, "countDocuments", JobPhoto.countDocuments],
    [ATM, "findById", ATM.findById],
    [Employee, "find", Employee.find],
    [Employee, "findOne", Employee.findOne],
    [User, "find", User.find],
    [Notification, "create", Notification.create],
  ];

  Job.findById = () => makeQuery(job);
  JobHistory.create = async (entry) => {
    historyEntries.push(entry);
    return entry;
  };
  JobPhoto.countDocuments = async (filter) =>
    filter.photoType === "before" ? 3 : 3;
  ATM.findById = async () => atm;
  Employee.find = (filter) => ({
    select() {
      return this;
    },
    lean: async () => {
      const employees = [
        employee,
        makeEmployee("active", "active", nextEmployeeUserId),
      ];
      return employees.filter((candidate) =>
        (filter.$or ?? []).some((condition) => {
          const [field, matcher] = Object.entries(condition)[0];
          return matcher.$in.some((id) =>
            field === "_id"
              ? String(id) === String(candidate._id)
              : String(id) === String(candidate.userId?._id ?? candidate.userId),
          );
        }),
      );
    },
  });
  Employee.findOne = (filter) => {
    employeeLookups.push(filter);
    const found =
      filter.userId === employeeUserId &&
      (!filter.status || filter.status === employeeStatus)
        ? employee
        : null;
    return {
      populate: async () => found,
      select() {
        return this;
      },
      lean: async () =>
        found && found.status === "active" && userStatus === "active"
          ? { userId: employeeUserId }
          : null,
    };
  };
  User.find = (filter) => ({
    select() {
      return this;
    },
    lean: async () =>
      [
        { _id: adminId, userType: "admin", status: "active" },
        { _id: superAdminId, userType: "superAdmin", status: "active" },
        { _id: employeeUserId, userType: "employee", status: userStatus },
        { _id: nextEmployeeUserId, userType: "employee", status: "active" },
      ].filter(
        (user) =>
          user.status === filter.status &&
          (!filter.userType || filter.userType.$in.includes(user.userType)) &&
          (!filter._id ||
            filter._id.$in.some((id) => String(id) === String(user._id))),
      ),
  });
  Notification.create = async (input) => {
    notifications.push(input);
    return { ...input, _id: String(notifications.length) };
  };

  try {
    await callback({ job, historyEntries, employeeLookups, notifications });
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
}

test("active Employee with active User can accept an assigned Job", async () => {
  await withLifecycleMocks(
    { status: "ASSIGNED" },
    async ({ job, historyEntries, employeeLookups, notifications }) => {
      const result = await invoke(acceptJob, employeeRequest("ASSIGNED"));

      assert.equal(result.error, undefined);
      assert.equal(result.statusCode, 200);
      assert.equal(job.status, "ACCEPTED");
      assert.equal(job.assignedEmployeeId, employeeUserId);
      assert.ok(job.acceptedAt instanceof Date);
      assert.equal(historyEntries.length, 1);
      assert.equal(notifications.length, 0);
    },
  );
});

test("employee start and resume update realtime state without Admin notifications", async () => {
  for (const status of ["ACCEPTED", "ON_HOLD"]) {
    await withLifecycleMocks(
      { status },
      async ({ job, historyEntries, notifications }) => {
        const result = await invoke(startJob, employeeRequest(status));

        assert.equal(result.error, undefined);
        assert.equal(result.statusCode, 200);
        assert.equal(job.status, "IN_PROGRESS");
        assert.equal(historyEntries.length, 1);
        assert.equal(notifications.length, 0);
      },
    );
  }
});

test("employee hold updates realtime state without an Admin notification", async () => {
  await withLifecycleMocks(
    { status: "IN_PROGRESS" },
    async ({ job, historyEntries, notifications }) => {
      const result = await invoke(holdJob, {
        ...employeeRequest("IN_PROGRESS"),
        body: { reason: "Waiting for access" },
      });

      assert.equal(result.error, undefined);
      assert.equal(result.statusCode, 200);
      assert.equal(job.status, "ON_HOLD");
      assert.equal(historyEntries.length, 1);
      assert.equal(notifications.length, 0);
    },
  );
});

test("employee completion creates one notification per active Admin and Super Admin", async () => {
  await withLifecycleMocks(
    { status: "IN_PROGRESS" },
    async ({ job, historyEntries, notifications }) => {
      const result = await invoke(completeJob, employeeRequest("IN_PROGRESS"));

      assert.equal(result.error, undefined);
      assert.equal(result.statusCode, 200);
      assert.equal(job.status, "COMPLETED");
      assert.equal(historyEntries.length, 1);
      assert.equal(notifications.length, 2);
      assert.deepEqual(
        notifications.map(({ userId }) => String(userId)).sort(),
        [adminId, superAdminId].sort(),
      );
      assert.ok(
        notifications.every(
          ({ data, dedupeKey }) =>
            data.action === "completed" &&
            dedupeKey.startsWith(`job:${jobId}:completed:`),
        ),
      );
    },
  );
});

for (const employeeStatus of ["inactive", "on_leave", "resigned"]) {
  test(`non-active ${employeeStatus} Employee cannot accept an assigned Job with active User`, async () => {
    await withLifecycleMocks(
      { status: "ASSIGNED", employeeStatus, userStatus: "active" },
      async ({ job, historyEntries }) => {
        const before = snapshotJob(job);
        const result = await invoke(acceptJob, employeeRequest("ASSIGNED"));

        assert.equal(result.error?.statusCode, 400);
        assert.deepEqual(snapshotJob(job), before);
        assert.equal(job.saveCalls, 0);
        assert.deepEqual(historyEntries, []);
      },
    );
  });

  test(`non-active ${employeeStatus} Employee cannot start an accepted Job`, async () => {
    await withLifecycleMocks(
      { status: "ACCEPTED", employeeStatus, userStatus: "active" },
      async ({ job, historyEntries }) => {
        const before = snapshotJob(job);
        const result = await invoke(startJob, employeeRequest("ACCEPTED"));

        assert.equal(result.error?.statusCode, 400);
        assert.deepEqual(snapshotJob(job), before);
        assert.equal(job.saveCalls, 0);
        assert.deepEqual(historyEntries, []);
      },
    );
  });

  test(`non-active ${employeeStatus} Employee cannot resume an on-hold Job`, async () => {
    await withLifecycleMocks(
      { status: "ON_HOLD", employeeStatus, userStatus: "active" },
      async ({ job, historyEntries }) => {
        const before = snapshotJob(job);
        const result = await invoke(startJob, employeeRequest("ON_HOLD"));

        assert.equal(result.error?.statusCode, 400);
        assert.deepEqual(snapshotJob(job), before);
        assert.equal(job.saveCalls, 0);
        assert.deepEqual(historyEntries, []);
      },
    );
  });

  test(`non-active ${employeeStatus} Employee cannot complete an in-progress Job`, async () => {
    await withLifecycleMocks(
      { status: "IN_PROGRESS", employeeStatus, userStatus: "active" },
      async ({ job, historyEntries }) => {
        const before = snapshotJob(job);
        const result = await invoke(completeJob, employeeRequest("IN_PROGRESS"));

        assert.equal(result.error?.statusCode, 400);
        assert.deepEqual(snapshotJob(job), before);
        assert.equal(job.saveCalls, 0);
        assert.deepEqual(historyEntries, []);
      },
    );
  });
}

test("existing ownership and lifecycle status restrictions still reject actions", async (t) => {
  const cases = [
    {
      name: "another User cannot accept the assignment",
      status: "ASSIGNED",
      handler: acceptJob,
      request: {
        ...employeeRequest("ASSIGNED"),
        user: { _id: nextEmployeeUserId, userType: "employee" },
      },
      expectedStatus: 403,
    },
    {
      name: "Employee cannot accept outside ASSIGNED",
      status: "ON_HOLD",
      handler: acceptJob,
      request: employeeRequest("ON_HOLD"),
      expectedStatus: 400,
    },
    {
      name: "Employee cannot start outside ACCEPTED or ON_HOLD",
      status: "ASSIGNED",
      handler: startJob,
      request: employeeRequest("ASSIGNED"),
      expectedStatus: 400,
    },
    {
      name: "Employee cannot complete outside IN_PROGRESS",
      status: "ACCEPTED",
      handler: completeJob,
      request: employeeRequest("IN_PROGRESS"),
      expectedStatus: 400,
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      await withLifecycleMocks(
        { status: entry.status },
        async ({ job, historyEntries }) => {
          const before = snapshotJob(job);
          const result = await invoke(entry.handler, entry.request);

          assert.equal(result.error?.statusCode, entry.expectedStatus);
          assert.deepEqual(snapshotJob(job), before);
          assert.equal(job.saveCalls, 0);
          assert.deepEqual(historyEntries, []);
        },
      );
    });
  }
});

test("Employee lifecycle routes remain employee-only; Admin actions remain Admin/SuperAdmin-only", () => {
  for (const action of ["accept", "start", "complete"]) {
    assert.doesNotThrow(() =>
      authorizeRoles("employee")(
        { user: { userType: "employee" } },
        {},
        () => {},
      ),
      `${action} should authorize Employees`,
    );
    for (const userType of ["admin", "superAdmin"]) {
      assert.throws(
        () =>
          authorizeRoles("employee")(
            { user: { userType } },
            {},
            () => {},
          ),
        { statusCode: 403 },
      );
    }
  }

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

test("Admin can reassign a Job away from a non-active incumbent to an active Employee", async (t) => {
  for (const userType of ["admin", "superAdmin"]) {
    await t.test(userType, async () => {
      const job = makeJob("ASSIGNED");
      job.status = "ACCEPTED";
      const atm = {
        _id: atmId,
        isDeleted: false,
        assignedEmployeeId: [employeeId, nextEmployeeId],
      };
      const historyEntries = [];
      const notifications = [];
      const originals = [
        [Job, "findById", Job.findById],
        [JobHistory, "create", JobHistory.create],
        [ATM, "findById", ATM.findById],
        [Employee, "find", Employee.find],
        [Employee, "findOne", Employee.findOne],
        [User, "find", User.find],
        [Notification, "create", Notification.create],
      ];
      Job.findById = () => makeQuery(job);
      JobHistory.create = async (entry) => {
        historyEntries.push(entry);
        return entry;
      };
      ATM.findById = async () => atm;
      Employee.find = () => ({
        select() {
          return this;
        },
        lean: async () => [],
      });
      Employee.findOne = (filter) => {
        const found =
          filter.userId === nextEmployeeUserId
            ? makeEmployee("active", "active", nextEmployeeUserId)
            : null;
        return {
          populate: async () => found,
          select() {
            return this;
          },
          lean: async () =>
            found ? { userId: nextEmployeeUserId } : null,
        };
      };
      User.find = (filter) => ({
        select() {
          return this;
        },
        lean: async () =>
          [
            { _id: adminId, userType: "admin", status: "active" },
            { _id: nextEmployeeUserId, userType: "employee", status: "active" },
          ].filter(
            (user) =>
              user.status === filter.status &&
              (!filter.userType ||
                filter.userType.$in.includes(user.userType)) &&
              (!filter._id ||
                filter._id.$in.some((id) => String(id) === String(user._id))),
          ),
      });
      Notification.create = async (input) => {
        notifications.push(input);
        return { ...input, _id: String(notifications.length) };
      };

      try {
        const result = await invoke(reassignJob, {
          params: { id: jobId },
          body: {
            employeeId: nextEmployeeUserId,
            reason: "Reassign from non-active employee",
          },
          user: { _id: adminId, userType },
          headers: {},
        });

        assert.equal(result.error, undefined);
        assert.equal(result.statusCode, 200);
        assert.equal(job.status, "ASSIGNED");
        assert.equal(job.assignedEmployeeId, nextEmployeeUserId);
        assert.equal(job.reassignmentHistory[0].fromEmployee, employeeUserId);
        assert.equal(job.reassignmentHistory[0].toEmployee, nextEmployeeUserId);
        assert.equal(historyEntries.length, 1);
        assert.equal(historyEntries[0].action, "reassigned");
        assert.equal(notifications.length, 1);
        assert.equal(String(notifications[0].userId), nextEmployeeUserId);
      } finally {
        for (const [target, key, original] of originals.reverse()) {
          target[key] = original;
        }
      }
    });
  }
});
