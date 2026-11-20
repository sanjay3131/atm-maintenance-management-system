import test from "node:test";
import assert from "node:assert/strict";
import Employee from "../src/modules/employees/employee.model.js";
import User from "../src/modules/users/user.model.js";
import Notification from "../src/modules/notification/notification.model.js";
import { createWorkflowNotificationsSafely } from "../src/modules/notification/notification.service.js";
import {
  resolveActiveNotificationAdminRecipients,
  resolveAssignedJobEmployeeNotificationRecipients,
  resolveAssignedLocationTaskEmployeeNotificationRecipients,
  resolveLocationRequestEmployeeNotificationRecipients,
} from "../src/realtime/recipient-resolver.js";

const ids = {
  admin: "64b000000000000000000401",
  superAdmin: "64b000000000000000000402",
  inactiveAdmin: "64b000000000000000000403",
  employee: "64b000000000000000000404",
  otherEmployee: "64b000000000000000000405",
  employeeRecord: "64b000000000000000000406",
  job: "64b000000000000000000407",
  inactiveEmployee: "64b000000000000000000408",
};

const queryFor = (value) => ({
  select() {
    return this;
  },
  lean() {
    return Promise.resolve(value);
  },
});

const withStubs = async (stubs, callback) => {
  const originals = [];
  for (const [model, methods] of stubs) {
    for (const [method, implementation] of Object.entries(methods)) {
      originals.push([model, method, model[method]]);
      model[method] = implementation;
    }
  }
  try {
    await callback();
  } finally {
    for (const [model, method, original] of originals.reverse()) {
      model[method] = original;
    }
  }
};

const userRecords = [
  { _id: ids.admin, userType: "admin", status: "active" },
  { _id: ids.superAdmin, userType: "superAdmin", status: "active" },
  { _id: ids.inactiveAdmin, userType: "admin", status: "inactive" },
  { _id: ids.employee, userType: "employee", status: "active" },
  { _id: ids.otherEmployee, userType: "employee", status: "active" },
  { _id: ids.inactiveEmployee, userType: "employee", status: "inactive" },
];

const findUsers = (filter) =>
  queryFor(
    userRecords.filter(
      (user) =>
        user.status === filter.status &&
        filter.userType.$in.includes(user.userType) &&
        (!filter._id || filter._id.$in.some((id) => String(id) === user._id)),
    ),
  );

const notificationStore = () => {
  const docs = [];
  let nextId = 0;
  return {
    docs,
    async create(input) {
      if (
        input.dedupeKey &&
        docs.some(
          (existing) =>
            existing.userId === String(input.userId) &&
            existing.dedupeKey === input.dedupeKey,
        )
      ) {
        throw Object.assign(new Error("Duplicate notification"), { code: 11000 });
      }
      const doc = {
        _id: `notification-${++nextId}`,
        createdAt: new Date(),
        ...input,
        userId: String(input.userId),
      };
      docs.push(doc);
      return doc;
    },
  };
};

test("notification admin recipients are active admins and exclude the actor", async () => {
  await withStubs([[User, { find: findUsers }]], async () => {
    assert.deepEqual(
      await resolveActiveNotificationAdminRecipients(ids.admin),
      [ids.superAdmin],
    );
  });
});

test("assigned job and location task recipients resolve only active employees", async () => {
  await withStubs(
    [
      [User, { find: findUsers }],
      [
        Employee,
        {
          findOne(filter) {
            if (
              filter.status !== "active" ||
              (filter.userId &&
                ![ids.employee, ids.inactiveEmployee].includes(
                  String(filter.userId),
                )) ||
              (filter._id && String(filter._id) !== ids.employeeRecord)
            ) {
              return queryFor(null);
            }
            const userId = String(filter.userId ?? ids.employee);
            return queryFor({
              userId,
              _id: ids.employeeRecord,
            });
          },
        },
      ],
    ],
    async () => {
      assert.deepEqual(
        await resolveAssignedJobEmployeeNotificationRecipients({
          assignedEmployeeId: ids.employee,
        }),
        [ids.employee],
      );
      assert.deepEqual(
        await resolveAssignedLocationTaskEmployeeNotificationRecipients({
          assignedEmployeeId: ids.employeeRecord,
        }),
        [ids.employee],
      );
      assert.deepEqual(
        await resolveAssignedJobEmployeeNotificationRecipients({
          assignedEmployeeId: ids.inactiveEmployee,
        }),
        [],
      );
    },
  );
});

test("location request recipients require the active requesting employee", async () => {
  await withStubs(
    [
      [User, { find: findUsers }],
      [
        Employee,
        {
          findOne(filter) {
            const matches =
              filter.status === "active" &&
              String(filter._id) === ids.employeeRecord &&
              String(filter.userId) === ids.employee;
            return queryFor(
              matches
                ? { _id: ids.employeeRecord, userId: ids.employee }
                : null,
            );
          },
        },
      ],
    ],
    async () => {
      const request = {
        requesterRole: "employee",
        requesterEmployeeId: ids.employeeRecord,
        requestedBy: ids.employee,
      };
      assert.deepEqual(
        await resolveLocationRequestEmployeeNotificationRecipients(
          request,
          ids.employee,
        ),
        [],
      );
      assert.deepEqual(
        await resolveLocationRequestEmployeeNotificationRecipients(request),
        [ids.employee],
      );
      assert.deepEqual(
        await resolveLocationRequestEmployeeNotificationRecipients({
          ...request,
          requesterRole: "admin",
        }),
        [],
      );
    },
  );
});

test("workflow notification persistence is idempotent and isolates recipient failures", async () => {
  const store = notificationStore();
  const originalError = console.error;
  console.error = () => {};
  const create = async (input) => {
    if (String(input.userId) === ids.admin) {
      throw new Error("storage unavailable");
    }
    return store.create(input);
  };
  try {
    await withStubs([[Notification, { create }]], async () => {
      const notification = {
        resolveRecipients: async () => [ids.admin, ids.superAdmin],
        context: `job ${ids.job} started`,
        title: "Job started",
        message: "An employee started a job.",
        data: { entityType: "job", jobId: ids.job, action: "started" },
        dedupeKey: `job:${ids.job}:started:1`,
      };

      await createWorkflowNotificationsSafely(notification);
      await createWorkflowNotificationsSafely(notification);

      assert.equal(store.docs.length, 1);
      assert.equal(store.docs[0].userId, ids.superAdmin);
      assert.equal(store.docs[0].dedupeKey, notification.dedupeKey);
    });
  } finally {
    console.error = originalError;
  }
});

