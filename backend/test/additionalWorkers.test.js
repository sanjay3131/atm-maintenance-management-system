import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import {
  createAdditionalWorker,
  deleteAdditionalWorker,
  updateAdditionalWorker,
} from "../src/modules/jobs/additionalWorkers.controller.js";
import {
  additionalWorkersEntryParamsSchema,
  additionalWorkersJobParamsSchema,
  createAdditionalWorkerSchema,
  deleteAdditionalWorkerSchema,
  updateAdditionalWorkerSchema,
} from "../src/modules/jobs/additionalWorkers.validation.js";

const jobId = "64b000000000000000000101";
const workerId = "64b000000000000000000102";
const employeeId = "64b000000000000000000103";
const adminId = "64b000000000000000000104";
const otherEmployeeId = "64b000000000000000000105";

const makeWorker = (updates = {}) => ({
  _id: workerId,
  workerType: "Plumber",
  quantity: 2,
  notes: "Pipe repair",
  createdAt: new Date("2026-10-01T10:00:00.000Z"),
  updatedAt: new Date("2026-10-01T10:00:00.000Z"),
  ...updates,
});

const makeJob = (updates = {}) => ({
  _id: jobId,
  __v: 0,
  assignedEmployeeId: employeeId,
  status: "IN_PROGRESS",
  isDeleted: false,
  additionalWorkers: [],
  ...updates,
});

const makeQuery = (getValue) => ({
  session() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(getValue()).then(resolve, reject);
  },
});

const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
    };
    handler(req, res, reject);
  });

const captureError = async (handler, req) => {
  try {
    await invoke(handler, req);
    assert.fail("Expected request handler to reject");
  } catch (error) {
    return error;
  }
};

const cloneEntry = (entry) => ({ ...entry });

async function withMocks(
  {
    job = makeJob(),
    history = [],
    failHistory = false,
  } = {},
  callback,
) {
  const originals = [
    [mongoose, "startSession", mongoose.startSession],
    [Job, "findById", Job.findById],
    [Job, "updateOne", Job.updateOne],
    [JobHistory, "create", JobHistory.create],
  ];
  let auditShouldFail = failHistory;
  const store = job;
  const sessions = [];
  const createSession = () => {
    const session = {
      ended: false,
      transactionCount: 0,
      mutationApplied: false,
      async withTransaction(operation) {
        this.transactionCount += 1;
        const previousJob = {
          ...store,
          additionalWorkers: (store.additionalWorkers ?? []).map(cloneEntry),
        };
        const previousHistory = history.slice();
        try {
          return await operation(this);
        } catch (error) {
          if (this.mutationApplied) {
            Object.assign(store, previousJob);
            history.splice(0, history.length, ...previousHistory);
            this.mutationApplied = false;
          }
          throw error;
        }
      },
      async endSession() {
        this.ended = true;
      },
    };
    sessions.push(session);
    return session;
  };

  mongoose.startSession = async () => createSession();
  Job.findById = () =>
    makeQuery(() => ({
      ...store,
      additionalWorkers: (store.additionalWorkers ?? []).map(cloneEntry),
    }));
  Job.updateOne = async (filter, update, options) => {
    assert.ok(sessions.includes(options.session));
    const versionMatches = filter.$or
      ? filter.$or.some((candidate) =>
          candidate.__v?.$exists === false
            ? store.__v === undefined
            : store.__v === candidate.__v,
        )
      : store.__v === filter.__v;
    const isAdminFilter = filter.assignedEmployeeId === undefined;
    const authorizedState =
      isAdminFilter ||
      (String(filter.assignedEmployeeId) === String(store.assignedEmployeeId) &&
        filter.status === store.status);
    const targetWorkerId = filter["additionalWorkers._id"];
    const targetExists =
      targetWorkerId === undefined ||
      (store.additionalWorkers ?? []).some(
        (entry) => String(entry._id) === String(targetWorkerId),
      );
    const limitMatches =
      !filter.$expr ||
      (store.additionalWorkers ?? []).length < 20;
    const matches =
      String(filter._id) === String(store._id) &&
      versionMatches &&
      filter.isDeleted?.$ne === true &&
      !store.isDeleted &&
      authorizedState &&
      targetExists &&
      limitMatches;
    if (!matches) return { matchedCount: 0 };

    options.session.mutationApplied = true;
    if (update.$push?.additionalWorkers) {
      store.additionalWorkers.push(cloneEntry(update.$push.additionalWorkers));
    }
    if (update.$set) {
      for (const [path, value] of Object.entries(update.$set)) {
        if (path.startsWith("additionalWorkers.$.")) {
          const field = path.slice("additionalWorkers.$.".length);
          const target = store.additionalWorkers.find(
            (entry) => String(entry._id) === String(targetWorkerId),
          );
          target[field] = value;
        } else {
          store[path] = value;
        }
      }
    }
    if (update.$pull?.additionalWorkers) {
      store.additionalWorkers = store.additionalWorkers.filter(
        (entry) =>
          String(entry._id) !==
          String(update.$pull.additionalWorkers._id),
      );
    }
    if (update.$inc?.__v) {
      store.__v = (store.__v ?? 0) + update.$inc.__v;
    }
    return { matchedCount: 1 };
  };
  JobHistory.create = async (documents, options) => {
    assert.ok(sessions.includes(options.session));
    if (auditShouldFail) throw new Error("audit write failed");
    history.push(...documents);
    return documents;
  };

  try {
    return await callback({
      job: store,
      history,
      sessions,
      failAudit() {
        auditShouldFail = true;
      },
    });
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
}

const makeRequest = ({
  role = "employee",
  actorId = employeeId,
  status,
  assignedEmployeeId,
  workers,
  version = 0,
  worker = workerId,
  body = {},
} = {}) => ({
  params: { id: jobId, ...(worker ? { workerId: worker } : {}) },
  body,
  headers: {},
  ip: "127.0.0.1",
  user: { _id: actorId, userType: role },
  ...(status ? { status } : {}),
  ...(assignedEmployeeId ? { assignedEmployeeId } : {}),
  ...(workers ? { workers } : {}),
  version,
});

test("additional worker request schemas enforce lengths, integer quantities, and strict fields", () => {
  const parsed = createAdditionalWorkerSchema.parse({
    workerType: "  Electrician  ",
    quantity: 2,
    notes: "  wiring  ",
    expectedVersion: 4,
  });
  assert.deepEqual(parsed, {
    workerType: "Electrician",
    quantity: 2,
    notes: "wiring",
    expectedVersion: 4,
  });

  for (const body of [
    { workerType: " ", quantity: 1, expectedVersion: 0 },
    { workerType: "x".repeat(81), quantity: 1, expectedVersion: 0 },
    { workerType: "Painter", quantity: 0, expectedVersion: 0 },
    { workerType: "Painter", quantity: -1, expectedVersion: 0 },
    { workerType: "Painter", quantity: 1.5, expectedVersion: 0 },
    { workerType: "Painter", quantity: 1, notes: "x".repeat(301), expectedVersion: 0 },
    { workerType: "Painter", quantity: 1, actorId: employeeId, expectedVersion: 0 },
    { workerType: "Painter", quantity: 1, unitPrice: 10, expectedVersion: 0 },
  ]) {
    assert.equal(createAdditionalWorkerSchema.safeParse(body).success, false);
  }

  assert.equal(
    updateAdditionalWorkerSchema.safeParse({ expectedVersion: 0 }).success,
    false,
  );
  assert.equal(
    updateAdditionalWorkerSchema.safeParse({
      notes: "",
      expectedVersion: 0,
    }).success,
    true,
  );
  assert.equal(
    deleteAdditionalWorkerSchema.safeParse({ expectedVersion: 0 }).success,
    true,
  );
  assert.equal(
    additionalWorkersJobParamsSchema.safeParse({ id: jobId }).success,
    true,
  );
  assert.equal(
    additionalWorkersEntryParamsSchema.safeParse({
      id: jobId,
      workerId,
    }).success,
    true,
  );
});

test("Job embeds timestamped, identified worker records with a 20-entry schema limit", async () => {
  const workerSchema = Job.schema.path("additionalWorkers").schema;
  assert.ok(workerSchema.path("_id"));
  assert.equal(workerSchema.path("workerType").options.trim, true);
  assert.equal(workerSchema.path("workerType").options.maxlength, 80);
  assert.equal(workerSchema.path("quantity").options.validate, Number.isInteger);
  assert.equal(workerSchema.path("notes").options.maxlength, 300);
  assert.ok(Job.schema.path("additionalWorkers").options.validate);
  assert.equal(workerSchema.options.timestamps, true);
  assert.equal("unitCostSnapshot" in workerSchema.paths, false);
  assert.equal("lineCostSnapshot" in workerSchema.paths, false);
});

test("assigned employee can add an additional worker with server-generated identity and audit", async () => {
  await withMocks({}, async ({ job, history, sessions }) => {
    const result = await invoke(
      createAdditionalWorker,
      makeRequest({
        body: createAdditionalWorkerSchema.parse({
          workerType: "  Plumber ",
          quantity: 2,
          expectedVersion: 0,
        }),
      }),
    );
    const savedWorker = job.additionalWorkers[0];
    assert.equal(result.status, 201);
    assert.equal(savedWorker.workerType, "Plumber");
    assert.equal(savedWorker.quantity, 2);
    assert.ok(mongoose.isValidObjectId(savedWorker._id));
    assert.ok(savedWorker.createdAt instanceof Date);
    assert.ok(savedWorker.updatedAt instanceof Date);
    assert.equal(result.body.data.version, 1);
    assert.equal(history.length, 1);
    assert.equal(history[0].action, "additional_worker_added");
    assert.equal(history[0].performedBy, employeeId);
    assert.equal(history[0].details.actorRole, "employee");
    assert.equal(String(history[0].details.workerEntryId), String(savedWorker._id));
    assert.deepEqual(history[0].details.after.workerType, "Plumber");
    assert.equal(sessions[0].transactionCount, 1);
    assert.equal(sessions[0].ended, true);
  });
});

test("employee cannot add, edit, or delete workers on an unassigned job", async () => {
  for (const [handler, request] of [
    [
      createAdditionalWorker,
      makeRequest({
        actorId: otherEmployeeId,
        body: { workerType: "Plumber", quantity: 1, expectedVersion: 0 },
      }),
    ],
    [
      updateAdditionalWorker,
      makeRequest({
        actorId: otherEmployeeId,
        body: { quantity: 3, expectedVersion: 0 },
      }),
    ],
    [
      deleteAdditionalWorker,
      makeRequest({
        actorId: otherEmployeeId,
        body: { expectedVersion: 0 },
      }),
    ],
  ]) {
    await withMocks(
      { job: makeJob({ additionalWorkers: [makeWorker()] }) },
      async ({ history }) => {
        const error = await captureError(handler, request);
        assert.equal(error.statusCode, 403);
        assert.equal(history.length, 0);
      },
    );
  }
});

test("employee cannot add, edit, or delete workers after IN_PROGRESS", async () => {
  for (const handler of [
    createAdditionalWorker,
    updateAdditionalWorker,
    deleteAdditionalWorker,
  ]) {
    const body =
      handler === createAdditionalWorker
        ? { workerType: "Painter", quantity: 1, expectedVersion: 0 }
        : { expectedVersion: 0, ...(handler === updateAdditionalWorker ? { quantity: 3 } : {}) };
    await withMocks(
      {
        job: makeJob({
          status: "COMPLETED",
          additionalWorkers: [makeWorker()],
        }),
      },
      async ({ history }) => {
        const error = await captureError(
          handler,
          makeRequest({ body }),
        );
        assert.equal(error.statusCode, 400);
        assert.match(error.message, /status is COMPLETED/);
        assert.equal(history.length, 0);
      },
    );
  }
});

test("admin and superAdmin can add, edit, and delete entries at every Job status", async () => {
  for (const [role, actorId] of [
    ["admin", adminId],
    ["superAdmin", adminId],
  ]) {
    for (const status of [
      "PENDING",
      "ASSIGNED",
      "ACCEPTED",
      "IN_PROGRESS",
      "ON_HOLD",
      "COMPLETED",
      "VERIFIED",
      "APPROVED",
      "CLOSED",
      "CANCELLED",
      "REJECTED",
    ]) {
      await withMocks(
        {
          job: makeJob({
            status,
            additionalWorkers: [makeWorker()],
          }),
        },
        async ({ job, history }) => {
          const created = await invoke(
            createAdditionalWorker,
            makeRequest({
              role,
              actorId,
              body: {
                workerType: "Electrician",
                quantity: 1,
                expectedVersion: 0,
              },
            }),
          );
          assert.equal(created.status, 201);
          const currentVersion = created.body.data.version;

          const updated = await invoke(
            updateAdditionalWorker,
            makeRequest({
              role,
              actorId,
              body: {
                notes: "Corrected by admin",
                expectedVersion: currentVersion,
              },
            }),
          );
          assert.equal(updated.status, 200);
          const updatedVersion = updated.body.data.version;

          const removed = await invoke(
            deleteAdditionalWorker,
            makeRequest({
              role,
              actorId,
              body: { expectedVersion: updatedVersion },
            }),
          );
          assert.equal(removed.status, 200);
          assert.equal(job.additionalWorkers.length, 1);
          assert.deepEqual(
            history.map((entry) => entry.action),
            [
              "additional_worker_added",
              "additional_worker_updated",
              "additional_worker_removed",
            ],
          );
          assert.ok(history.every((entry) => entry.details.actorRole === role));
          assert.equal(history[1].details.before.notes, "Pipe repair");
          assert.equal(history[1].details.after.notes, "Corrected by admin");
          assert.ok(history[2].details.before);
        },
      );
    }
  }
});

test("editing or deleting a nonexistent worker returns 404", async () => {
  for (const handler of [updateAdditionalWorker, deleteAdditionalWorker]) {
    await withMocks({}, async ({ history }) => {
      const error = await captureError(
        handler,
        makeRequest({
          worker: "64b000000000000000000199",
          body:
            handler === updateAdditionalWorker
              ? { quantity: 3, expectedVersion: 0 }
              : { expectedVersion: 0 },
        }),
      );
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Additional worker not found");
      assert.equal(history.length, 0);
    });
  }
});

test("every operation records the appropriate actor, worker identity, and before/after values", async () => {
  await withMocks(
    { job: makeJob({ additionalWorkers: [makeWorker()] }) },
    async ({ history }) => {
      await invoke(
        updateAdditionalWorker,
        makeRequest({
          body: { quantity: 4, expectedVersion: 0 },
        }),
      );
      await invoke(
        deleteAdditionalWorker,
        makeRequest({
          version: 1,
          body: { expectedVersion: 1 },
        }),
      );
      assert.deepEqual(
        history.map((entry) => entry.action),
        ["additional_worker_updated", "additional_worker_removed"],
      );
      assert.equal(history[0].performedBy, employeeId);
      assert.equal(history[0].details.actorRole, "employee");
      assert.equal(String(history[0].details.workerEntryId), workerId);
      assert.equal(history[0].details.before.quantity, 2);
      assert.equal(history[0].details.after.quantity, 4);
      assert.equal(history[1].details.before.quantity, 4);
      assert.ok(history.every((entry) => entry.performedAt instanceof Date));
    },
  );
});

test("audit failure rolls back the worker mutation within the transaction", async () => {
  await withMocks({ failHistory: true }, async ({ job, history, sessions }) => {
    const error = await captureError(
      createAdditionalWorker,
      makeRequest({
        body: { workerType: "Carpenter", quantity: 1, expectedVersion: 0 },
      }),
    );
    assert.match(error.message, /audit write failed/);
    assert.equal(job.additionalWorkers.length, 0);
    assert.equal(job.__v, 0);
    assert.equal(history.length, 0);
    assert.equal(sessions[0].ended, true);
  });
});

test("the 20-entry limit rejects additional entries and is guarded atomically", async () => {
  const fullWorkers = Array.from({ length: 20 }, (_, index) =>
    makeWorker({
      _id: new mongoose.Types.ObjectId(),
      workerType: `Worker ${index}`,
    }),
  );
  await withMocks(
    { job: makeJob({ additionalWorkers: fullWorkers }) },
    async ({ job, history }) => {
      const error = await captureError(
        createAdditionalWorker,
        makeRequest({
          body: { workerType: "Painter", quantity: 1, expectedVersion: 0 },
        }),
      );
      assert.equal(error.statusCode, 400);
      assert.equal(job.additionalWorkers.length, 20);
      assert.equal(history.length, 0);
    },
  );

  const entries = Array.from({ length: 19 }, (_, index) =>
    makeWorker({
      _id: new mongoose.Types.ObjectId(),
      workerType: `Worker ${index}`,
    }),
  );
  await withMocks(
    { job: makeJob({ __v: 7, additionalWorkers: entries }) },
    async ({ job, history }) => {
      const requests = [0, 1].map(() =>
        invoke(
          createAdditionalWorker,
          makeRequest({
            body: { workerType: "Painter", quantity: 1, expectedVersion: 7 },
          }),
        ),
      );
      const outcomes = await Promise.allSettled(requests);
      assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
      const rejected = outcomes.find((result) => result.status === "rejected");
      assert.equal(rejected.reason.statusCode, 409);
      assert.equal(job.additionalWorkers.length, 20);
      assert.equal(history.length, 1);
    },
  );
});

test("stale worker edits return a conflict instead of overwriting newer values", async () => {
  await withMocks(
    {
      job: makeJob({
        __v: 3,
        additionalWorkers: [makeWorker({ quantity: 5 })],
      }),
    },
    async ({ job, history }) => {
      const error = await captureError(
        updateAdditionalWorker,
        makeRequest({
          body: { quantity: 1, expectedVersion: 2 },
        }),
      );
      assert.equal(error.statusCode, 409);
      assert.equal(job.additionalWorkers[0].quantity, 5);
      assert.equal(history.length, 0);
    },
  );
});

test("legacy jobs without a version key use logical version zero and become fenced", async () => {
  const legacyJob = makeJob();
  delete legacyJob.__v;
  await withMocks({ job: legacyJob }, async ({ job }) => {
    const result = await invoke(
      createAdditionalWorker,
      makeRequest({
        body: { workerType: "Painter", quantity: 1, expectedVersion: 0 },
      }),
    );
    assert.equal(result.body.data.version, 1);
    assert.equal(job.__v, 1);
  });
});
