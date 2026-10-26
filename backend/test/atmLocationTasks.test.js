import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import ATMLocationRequest from "../src/modules/atms/atmLocationRequest.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import ATMLocationTask from "../src/modules/atms/atmLocationTask.model.js";
import {
  cancelATMLocationTask,
  createBulkATMLocationTasks,
  holdATMLocationTask,
  listMyATMLocationTasks,
  reassignATMLocationTask,
  reopenRejectedATMLocationTask,
  resumeATMLocationTask,
  startATMLocationTask,
} from "../src/modules/atms/atmLocationTask.service.js";
import {
  createATMLocationTasksSchema,
  listATMLocationTasksQuerySchema,
  locationTaskIdParamsSchema,
  reopenATMLocationTaskSchema,
} from "../src/modules/atms/atm.validation.js";
import atmRouter from "../src/modules/atms/atm.routes.js";

const atmId = "64b000000000000000000201";
const employeeId = "64b000000000000000000202";
const employeeUserId = "64b000000000000000000203";
const replacementEmployeeId = "64b000000000000000000204";
const replacementUserId = "64b000000000000000000205";
const adminId = "64b000000000000000000206";
const taskId = "64b000000000000000000207";

const makeTask = (overrides = {}) => ({
  _id: taskId,
  atmId,
  assignedEmployeeId: employeeId,
  taskType: "INITIAL_COLLECTION",
  status: "ASSIGNED",
  active: true,
  createdBy: adminId,
  correctionReason: null,
  locationRequestId: null,
  assignmentHistory: [],
  ...overrides,
});

const makeQuery = (value, onResolve) => ({
  session() {
    return this;
  },
  populate() {
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
    return Promise.resolve(value)
      .then((result) => {
        onResolve?.();
        return result;
      })
      .then(resolve, reject);
  },
});

const matches = (record, filter) => {
  if (!record) return false;
  for (const [key, expected] of Object.entries(filter)) {
    const actual = record[key];
    if (
      expected &&
      typeof expected === "object" &&
      "$in" in expected
    ) {
      if (!expected.$in.includes(actual)) return false;
    } else if (String(actual?._id ?? actual) !== String(expected?._id ?? expected)) {
      return false;
    }
  }
  return true;
};

async function withMocks(
  {
    atm = { _id: atmId, isDeleted: false, locationConfigured: false },
    employees = [
      {
        _id: employeeId,
        userId: {
          _id: employeeUserId,
          userType: "employee",
          status: "active",
        },
        status: "active",
      },
      {
        _id: replacementEmployeeId,
        userId: {
          _id: replacementUserId,
          userType: "employee",
          status: "active",
        },
        status: "active",
      },
    ],
    tasks = [],
    requests = [],
    duplicateOnCreate = false,
    trackAssignmentReads = false,
  } = {},
  callback,
) {
  const state = {
    atm,
    employees,
    tasks: new Map(tasks.map((task) => [String(task._id), task])),
    requests,
    duplicateOnCreate,
    trackAssignmentReads,
    assignmentReadOrder: [],
    lastTaskFilter: null,
    nextTaskId: 208,
  };
  const originals = [
    [mongoose, "startSession", mongoose.startSession],
    [ATM, "findOne", ATM.findOne],
    [ATM, "bumpLocationWorkflowRevision", ATM.bumpLocationWorkflowRevision],
    [Employee, "findById", Employee.findById],
    [Employee, "findOne", Employee.findOne],
    [ATMLocationTask, "create", ATMLocationTask.create],
    [ATMLocationTask, "findOne", ATMLocationTask.findOne],
    [ATMLocationTask, "findOneAndUpdate", ATMLocationTask.findOneAndUpdate],
    [ATMLocationTask, "find", ATMLocationTask.find],
    [ATMLocationTask, "countDocuments", ATMLocationTask.countDocuments],
    [ATMLocationRequest, "findOne", ATMLocationRequest.findOne],
  ];

  mongoose.startSession = async () => ({
    async withTransaction(operation) {
      const before = new Map(
        [...state.tasks].map(([id, task]) => [id, structuredClone(task)]),
      );
      const revisionBefore = state.atm.locationWorkflowRevision ?? 0;
      try {
        return await operation(this);
      } catch (error) {
        state.tasks = before;
        state.atm.locationWorkflowRevision = revisionBefore;
        throw error;
      }
    },
    async endSession() {},
  });
  ATM.findOne = (filter) => {
    if (state.trackAssignmentReads) state.assignmentReadOrder.push("atm:start");
    return makeQuery(
      String(filter._id) === String(state.atm._id) &&
        filter.isDeleted === false &&
        !state.atm.isDeleted
        ? state.atm
        : null,
      state.trackAssignmentReads
        ? () => state.assignmentReadOrder.push("atm:resolved")
        : undefined,
    );
  };
  ATM.bumpLocationWorkflowRevision = async (id) => {
    if (String(id) !== String(state.atm._id) || state.atm.isDeleted) {
      return false;
    }
    state.atm.locationWorkflowRevision =
      (state.atm.locationWorkflowRevision ?? 0) + 1;
    return true;
  };
  Employee.findById = (id) => {
    if (state.trackAssignmentReads) {
      state.assignmentReadOrder.push("employee:start");
    }
    return makeQuery(
      state.employees.find((employee) => String(employee._id) === String(id)) ?? null,
      state.trackAssignmentReads
        ? () => state.assignmentReadOrder.push("employee:resolved")
        : undefined,
    );
  };
  Employee.findOne = (filter) =>
    makeQuery(
      state.employees.find(
        (employee) =>
          String(employee.userId?._id ?? employee.userId) ===
            String(filter.userId) &&
          employee.status === filter.status,
      ) ?? null,
    );
  ATMLocationTask.findOne = (filter) => {
    const task = [...state.tasks.values()].find((candidate) =>
      matches(candidate, filter),
    );
    return makeQuery(task ?? null);
  };
  ATMLocationRequest.findOne = (filter) =>
    makeQuery(
      state.requests.find(
        (request) =>
          String(request.atmId) === String(filter.atmId) &&
          request.status === filter.status &&
          (filter.locationTaskId === undefined ||
            request.locationTaskId == null),
      ) ?? null,
    );
  ATMLocationTask.create = async ([data]) => {
    if (
      state.duplicateOnCreate ||
      [...state.tasks.values()].some(
        (task) => String(task.atmId) === String(data.atmId) && task.active,
      )
    ) {
      throw Object.assign(new Error("duplicate"), { code: 11000 });
    }
    const generatedId =
      state.tasks.has(taskId)
        ? `64b000000000000000000${String(state.nextTaskId++).padStart(3, "0")}`
        : taskId;
    const task = { _id: generatedId, ...data };
    state.tasks.set(String(task._id), task);
    return [task];
  };
  ATMLocationTask.findOneAndUpdate = async (filter, update) => {
    const task = state.tasks.get(String(filter._id));
    if (!matches(task, filter)) return null;
    Object.assign(task, update.$set ?? {});
    if (update.$push?.assignmentHistory) {
      task.assignmentHistory.push(update.$push.assignmentHistory);
    }
    return task;
  };
  ATMLocationTask.find = (filter) => {
    state.lastTaskFilter = filter;
    return makeQuery(
      [...state.tasks.values()].filter((task) => matches(task, filter)),
    );
  };
  ATMLocationTask.countDocuments = async (filter) =>
    [...state.tasks.values()].filter((task) => matches(task, filter)).length;

  try {
    await callback(state);
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

const initialTaskInput = (overrides = {}) => ({
  atmId,
  employeeId,
  taskType: "INITIAL_COLLECTION",
  ...overrides,
});

test("bulk task schema validates all ATM and employee IDs and task types", () => {
  assert.equal(
    createATMLocationTasksSchema.safeParse({
      tasks: [initialTaskInput()],
    }).success,
    true,
  );
  assert.equal(
    createATMLocationTasksSchema.safeParse({
      tasks: [initialTaskInput({ atmId: "invalid" })],
    }).success,
    false,
  );
  assert.equal(
    createATMLocationTasksSchema.safeParse({
      tasks: [initialTaskInput({ employeeId: "invalid" })],
    }).success,
    false,
  );
  assert.equal(
    createATMLocationTasksSchema.safeParse({
      tasks: [
        initialTaskInput({
          taskType: "LOCATION_CORRECTION",
        }),
      ],
    }).success,
    true,
  );
  assert.equal(
    createATMLocationTasksSchema.safeParse({
      tasks: [
        initialTaskInput({
          taskType: "LOCATION_CORRECTION",
          correctionReason: "Incorrect installation record",
        }),
      ],
    }).success,
    true,
  );
  for (const correctionReason of ["", "   ", 7, {}, "x".repeat(1001)]) {
    assert.equal(
      createATMLocationTasksSchema.safeParse({
        tasks: [
          initialTaskInput({
            taskType: "LOCATION_CORRECTION",
            correctionReason,
          }),
        ],
      }).success,
      false,
    );
  }
  assert.equal(
    locationTaskIdParamsSchema.safeParse({ taskId }).success,
    true,
  );
  assert.equal(
    listATMLocationTasksQuerySchema.safeParse({ status: "ON_HOLD" }).success,
    true,
  );
  assert.equal(
    reopenATMLocationTaskSchema.safeParse({
      employeeId,
      reason: "Reassign after rejection",
    }).success,
    true,
  );
});

test("bulk creation assigns exactly one employee per ATM and preserves initial assignment history", async () => {
  await withMocks({}, async (state) => {
    const tasks = await createBulkATMLocationTasks({
      tasks: [initialTaskInput()],
      adminId,
    });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, "ASSIGNED");
    assert.equal(tasks[0].active, true);
    assert.equal(tasks[0].assignedEmployeeId, employeeId);
    assert.equal(tasks[0].assignmentHistory.length, 1);
    assert.equal(tasks[0].assignmentHistory[0].previousEmployeeId, null);
    assert.equal(tasks[0].assignmentHistory[0].newEmployeeId, employeeId);
    assert.equal(tasks[0].assignmentHistory[0].actedBy, adminId);
    assert.equal("location" in tasks[0], false);
    assert.equal(state.tasks.size, 1);
  });
});

test("correction tasks can be created with or without an optional reason", async () => {
  const configuredATM = {
    _id: atmId,
    isDeleted: false,
    locationConfigured: true,
    location: { type: "Point", coordinates: [77.6, 12.5] },
  };
  for (const correctionReason of [undefined, "Survey confirms a location error"]) {
    await withMocks(
      { atm: configuredATM },
      async () => {
        const correctionTask = initialTaskInput({
          taskType: "LOCATION_CORRECTION",
          ...(correctionReason === undefined ? {} : { correctionReason }),
        });
        const [created] = await createBulkATMLocationTasks({
          tasks: [correctionTask],
          adminId,
        });
        assert.equal(created.taskType, "LOCATION_CORRECTION");
        assert.equal(created.correctionReason, correctionReason ?? null);
      },
    );
  }
});

test("bulk creation rejects missing ATMs, missing or inactive employees atomically", async () => {
  await withMocks(
    {
      employees: [
        {
          _id: employeeId,
          userId: { userType: "employee", status: "active" },
          status: "inactive",
        },
      ],
    },
    async (state) => {
      await assert.rejects(
        createBulkATMLocationTasks({
          tasks: [
            initialTaskInput({
              atmId: "64b000000000000000000299",
            }),
            initialTaskInput({ employeeId: replacementEmployeeId }),
          ],
          adminId,
        }),
        (error) => error.statusCode === 400 && error.errors.length === 2,
      );
      assert.equal(state.tasks.size, 0);
    },
  );
});

test("duplicate ATM entries and concurrent active-task conflicts do not partially create a batch", async () => {
  await withMocks({}, async (state) => {
    await assert.rejects(
      createBulkATMLocationTasks({
        tasks: [initialTaskInput(), initialTaskInput()],
        adminId,
      }),
      { statusCode: 400 },
    );
    assert.equal(state.tasks.size, 0);
    state.duplicateOnCreate = true;
    await assert.rejects(
      createBulkATMLocationTasks({
        tasks: [initialTaskInput()],
        adminId,
      }),
      { statusCode: 409 },
    );
    assert.equal(state.tasks.size, 0);
  });
});

test("pending task-unlinked requests block assignment, including AMC-linked requests", async () => {
  for (const amcId of [null, "64b000000000000000000209"]) {
    await withMocks(
      {
        requests: [
          {
            _id: "64b000000000000000000210",
            atmId,
            status: "PENDING",
            locationTaskId: null,
            amcId,
          },
        ],
      },
      async (state) => {
        await assert.rejects(
          createBulkATMLocationTasks({
            tasks: [initialTaskInput()],
            adminId,
          }),
          (error) =>
            error.statusCode === 400 &&
            error.errors[0].statusCode === 409 &&
            error.errors[0].message ===
              "ATM already has a pending location request",
        );
        assert.equal(state.tasks.size, 0);
        assert.equal(state.atm.locationWorkflowRevision ?? 0, 0);
        assert.equal(state.requests[0].status, "PENDING");
      },
    );
  }
});

test("bulk assignment propagates transient transaction conflicts for driver retry", async () => {
  const transientError = Object.assign(new Error("transaction write conflict"), {
    errorLabels: ["TransientTransactionError"],
  });
  await withMocks({}, async () => {
    ATM.bumpLocationWorkflowRevision = async () => {
      throw transientError;
    };
    await assert.rejects(
      createBulkATMLocationTasks({
        tasks: [initialTaskInput()],
        adminId,
      }),
      (error) => error === transientError,
    );
  });
});

test("an ATM cannot have a second active task, while cancelled and completed tasks release it", async () => {
  await withMocks(
    { tasks: [makeTask()] },
    async (state) => {
      await assert.rejects(
        createBulkATMLocationTasks({
          tasks: [initialTaskInput()],
          adminId,
        }),
        { statusCode: 400 },
      );
      assert.equal(state.tasks.size, 1);
    },
  );

  for (const terminalStatus of ["CANCELLED", "COMPLETED"]) {
    await withMocks(
      {
        tasks: [
          makeTask({
            status: terminalStatus,
            active: false,
          }),
        ],
      },
      async (state) => {
        const created = await createBulkATMLocationTasks({
          tasks: [initialTaskInput()],
          adminId,
        });
        assert.equal(created.length, 1);
        assert.equal(state.tasks.size, 2);
      },
    );
  }

  await withMocks(
    { tasks: [makeTask({ status: "ON_HOLD" })] },
    async (state) => {
      await assert.rejects(
        createBulkATMLocationTasks({
          tasks: [initialTaskInput()],
          adminId,
        }),
        { statusCode: 400 },
      );
      assert.equal(state.tasks.size, 1);
    },
  );

  assert.equal(ATMLocationTask.schema.path("status").enumValues.includes("ON_HOLD"), true);
  const index = ATMLocationTask.schema.indexes().find(
    ([fields, options]) =>
      fields.atmId === 1 && options.unique === true,
  );
  assert.deepEqual(index[1].partialFilterExpression, { active: true });
});

test("bulk assignment completes each transaction read before starting the next and creates the task", async () => {
  await withMocks({ trackAssignmentReads: true }, async (state) => {
    const created = await createBulkATMLocationTasks({
      tasks: [initialTaskInput()],
      adminId,
    });

    assert.deepEqual(state.assignmentReadOrder, [
      "atm:start",
      "atm:resolved",
      "employee:start",
      "employee:resolved",
    ]);
    assert.equal(created.length, 1);
    assert.equal(created[0].atmId, atmId);
    assert.equal(created[0].assignedEmployeeId, employeeId);
    assert.equal(created[0].status, "ASSIGNED");
    assert.equal(created[0].active, true);
    assert.equal(state.atm.locationWorkflowRevision, 1);
    assert.equal(state.tasks.size, 1);
  });
});

test("reassignment records history and old assignee cannot start the task", async () => {
  await withMocks(
    { tasks: [makeTask({ status: "IN_PROGRESS" })] },
    async (state) => {
      const reassigned = await reassignATMLocationTask({
        taskId,
        employeeId: replacementEmployeeId,
        adminId,
        reason: "Coverage change",
      });
      assert.equal(reassigned.assignedEmployeeId, replacementEmployeeId);
      assert.equal(reassigned.status, "ASSIGNED");
      assert.equal(reassigned.assignmentHistory[0].previousEmployeeId, employeeId);
      assert.equal(reassigned.assignmentHistory[0].newEmployeeId, replacementEmployeeId);
      assert.equal(reassigned.assignmentHistory[0].reason, "Coverage change");

      await assert.rejects(
        startATMLocationTask({ taskId, employeeUserId }),
        { statusCode: 409 },
      );
      const started = await startATMLocationTask({
        taskId,
        employeeUserId: replacementUserId,
      });
      assert.equal(started.status, "IN_PROGRESS");
      assert.equal(state.tasks.get(taskId).assignedEmployeeId, replacementEmployeeId);
    },
  );
});

test("reassignment to the current employee is rejected without changing task or history", async () => {
  await withMocks(
    {
      tasks: [
        makeTask({
          status: "IN_PROGRESS",
          assignmentHistory: [
            {
              previousEmployeeId: null,
              newEmployeeId: employeeId,
              actedBy: adminId,
            },
          ],
        }),
      ],
    },
    async (state) => {
      const before = structuredClone(state.tasks.get(taskId));
      await assert.rejects(
        reassignATMLocationTask({
          taskId,
          employeeId,
          adminId,
          reason: "No actual change",
        }),
        { statusCode: 400 },
      );
      assert.deepEqual(state.tasks.get(taskId), before);
    },
  );
});

test("assigned employee can hold and resume only an active task without a proposal", async () => {
  await withMocks(
    { tasks: [makeTask({ status: "IN_PROGRESS" })] },
    async (state) => {
      const held = await holdATMLocationTask({
        taskId,
        employeeUserId,
      });
      assert.equal(held.status, "ON_HOLD");
      assert.equal(held.heldBy, employeeUserId);
      assert.ok(held.heldAt instanceof Date);
      assert.equal(state.tasks.get(taskId).active, true);

      const resumed = await resumeATMLocationTask({
        taskId,
        employeeUserId,
      });
      assert.equal(resumed.status, "IN_PROGRESS");
      assert.equal(resumed.resumedBy, employeeUserId);
      assert.ok(resumed.resumedAt instanceof Date);
      assert.equal(state.tasks.get(taskId).active, true);
    },
  );
});

test("hold and resume reject wrong owners, stale states, and tasks linked to proposals", async () => {
  await withMocks(
    { tasks: [makeTask({ status: "IN_PROGRESS" })] },
    async () => {
      await assert.rejects(
        holdATMLocationTask({
          taskId,
          employeeUserId: replacementUserId,
        }),
        { statusCode: 409 },
      );
      await assert.rejects(
        resumeATMLocationTask({ taskId, employeeUserId }),
        { statusCode: 409 },
      );
    },
  );

  await withMocks(
    {
      tasks: [
        makeTask({
          status: "IN_PROGRESS",
          locationRequestId: "64b000000000000000000209",
        }),
      ],
    },
    async () => {
      await assert.rejects(
        holdATMLocationTask({ taskId, employeeUserId }),
        { statusCode: 409 },
      );
    },
  );

  await withMocks(
    {
      tasks: [
        makeTask({
          status: "ON_HOLD",
          locationRequestId: "64b000000000000000000209",
        }),
      ],
    },
    async () => {
      await assert.rejects(
        resumeATMLocationTask({ taskId, employeeUserId }),
        { statusCode: 409 },
      );
    },
  );
});

test("employees list only tasks bound to their authenticated employee record", async () => {
  await withMocks({}, async (state) => {
    await listMyATMLocationTasks({
      userId: replacementUserId,
      page: 1,
      limit: 20,
    });
    assert.equal(state.lastTaskFilter.assignedEmployeeId, replacementEmployeeId);
    assert.equal(Object.hasOwn(state.lastTaskFilter, "userId"), false);
  });
});

test("rejected tasks require explicit admin reopening or cancellation", async () => {
  await withMocks(
    { tasks: [makeTask({ status: "REJECTED" })] },
    async (state) => {
      await assert.rejects(
        reassignATMLocationTask({
          taskId,
          employeeId: replacementEmployeeId,
          adminId,
        }),
        { statusCode: 409 },
      );
      assert.equal(state.tasks.get(taskId).status, "REJECTED");

      const reopened = await reopenRejectedATMLocationTask({
        taskId,
        employeeId: replacementEmployeeId,
        adminId,
        reason: "Corrected evidence is ready",
      });
      assert.equal(reopened.status, "ASSIGNED");
      assert.equal(reopened.locationRequestId, null);
      assert.equal(reopened.assignmentHistory[0].reason, "Corrected evidence is ready");
      assert.equal(reopened.active, true);
    },
  );
});

test("task routes restrict administrative actions to admins and task start to employees", async () => {
  const adminPaths = new Set([
    "/location-tasks/bulk",
    "/location-tasks/:taskId/reassign",
    "/location-tasks/:taskId/reopen",
    "/location-tasks/:taskId/cancel",
  ]);
  const routes = atmRouter.stack.filter((layer) =>
    adminPaths.has(layer.route?.path),
  );
  assert.equal(routes.length, adminPaths.size);
  for (const route of routes) {
    const roleGuard = route.route.stack[1].handle;
    for (const role of ["employee", "supervisor", "customer"]) {
      assert.throws(
        () => roleGuard({ user: { userType: role } }, {}, () => {}),
        { statusCode: 403 },
      );
    }
    assert.doesNotThrow(() =>
      roleGuard({ user: { userType: "admin" } }, {}, () => {}),
    );
    assert.doesNotThrow(() =>
      roleGuard({ user: { userType: "superAdmin" } }, {}, () => {}),
    );
  }

  const startRoute = atmRouter.stack.find(
    (layer) => layer.route?.path === "/location-tasks/:taskId/start",
  );
  assert.ok(startRoute);
  assert.throws(
    () =>
      startRoute.route.stack[1].handle(
        { user: { userType: "admin" } },
        {},
        () => {},
      ),
    { statusCode: 403 },
  );
});

test("hold and resume routes are employee-only", async () => {
  for (const path of [
    "/location-tasks/:taskId/hold",
    "/location-tasks/:taskId/resume",
  ]) {
    const route = atmRouter.stack.find((layer) => layer.route?.path === path);
    assert.ok(route);
    const roleGuard = route.route.stack[1].handle;
    assert.doesNotThrow(() =>
      roleGuard({ user: { userType: "employee" } }, {}, () => {}),
    );
    for (const role of ["supervisor", "admin", "superAdmin", "customer"]) {
      assert.throws(
        () => roleGuard({ user: { userType: role } }, {}, () => {}),
        { statusCode: 403 },
      );
    }
  }
});

test("only tasks outside review may be cancelled and cancellation frees the ATM", async () => {
  await withMocks(
    { tasks: [makeTask({ status: "PENDING_REVIEW", locationRequestId: "request" })] },
    async (state) => {
      await assert.rejects(
        cancelATMLocationTask({
          taskId,
          adminId,
          reason: "No longer required",
        }),
        { statusCode: 409 },
      );
      assert.equal(state.tasks.get(taskId).active, true);
    },
  );

  await withMocks(
    { tasks: [makeTask()] },
    async (state) => {
      const cancelled = await cancelATMLocationTask({
        taskId,
        adminId,
        reason: "Collection cancelled",
      });
      assert.equal(cancelled.status, "CANCELLED");
      assert.equal(cancelled.active, false);
      assert.equal(cancelled.cancelledBy, adminId);
      assert.equal(cancelled.cancellationReason, "Collection cancelled");
      assert.equal(state.tasks.get(taskId).active, false);
    },
  );
});
