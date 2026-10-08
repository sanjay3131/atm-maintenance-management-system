import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { authorizeRoles } from "../src/middlewares/role.middleware.js";
import ATM from "../src/modules/atms/atm.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import Item from "../src/modules/items/item.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import JobMaterialUsage from "../src/modules/jobs/jobMaterialUsage.model.js";
import {
  createJobMaterialUsage,
  getJobMaterialUsage,
} from "../src/modules/jobs/jobMaterialUsage.controller.js";
import { updateItem } from "../src/modules/items/item.controller.js";
import { createJobMaterialUsageSchema } from "../src/modules/jobs/jobMaterialUsage.validation.js";
import {
  holdJob,
  reassignJob,
  verifyJob,
} from "../src/modules/jobs/jobs.controller.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";

const jobId = "64b000000000000000000081";
const itemId = "64b000000000000000000082";
const userId = "64b000000000000000000083";
const employeeId = "64b000000000000000000084";
const adminId = "64b000000000000000000085";
const otherUserId = "64b000000000000000000086";
const atmId = "64b000000000000000000087";

const makeJob = (updates = {}) => ({
  _id: jobId,
  atmId,
  assignedEmployeeId: userId,
  status: "IN_PROGRESS",
  isDeleted: false,
  reassignmentHistory: [],
  beforePhotos: [],
  afterPhotos: [],
  async save() {
    return this;
  },
  ...updates,
});

const makeItem = (updates = {}) => ({
  _id: itemId,
  itemName: "Air filter",
  unit: "piece",
  currentUnitCost: 12.345,
  isActive: true,
  ...updates,
});

const makeUsage = (data) => ({
  ...data,
  _id: "64b000000000000000000088",
  createdAt: new Date("2026-10-08T10:00:00.000Z"),
  updatedAt: new Date("2026-10-08T10:00:00.000Z"),
  toObject() {
    return { ...this };
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

const makeQuery = (value) => ({
  session() {
    return this;
  },
  populate() {
    return this;
  },
  sort(sort) {
    this.sortOrder = sort;
    return this;
  },
  lean() {
    return Promise.resolve(value);
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

async function withCreateMocks(
  { job = makeJob(), item = makeItem(), beforeJobUpdate },
  callback,
) {
  const originals = [
    [mongoose, "startSession", mongoose.startSession],
    [Job, "updateOne", Job.updateOne],
    [Job, "findById", Job.findById],
    [Item, "findById", Item.findById],
    [JobMaterialUsage, "create", JobMaterialUsage.create],
  ];
  const session = {
    transactionCount: 0,
    ended: false,
    async withTransaction(operation) {
      this.transactionCount += 1;
      return operation(this);
    },
    async endSession() {
      this.ended = true;
    },
  };
  let createdUsage;

  mongoose.startSession = async () => session;
  Job.findById = () => makeQuery(job);
  Job.updateOne = async (filter, update, options) => {
    assert.deepEqual(filter, {
      _id: jobId,
      assignedEmployeeId: userId,
      status: "IN_PROGRESS",
      isDeleted: false,
    });
    assert.deepEqual(update, { $inc: { materialUsageRevision: 1 } });
    assert.equal(options.session, session);
    await beforeJobUpdate?.(job);
    const matches =
      job &&
      !job.isDeleted &&
      job.status === "IN_PROGRESS" &&
      String(job.assignedEmployeeId) === userId;
    if (matches) {
      job.materialUsageRevision = (job.materialUsageRevision ?? 0) + 1;
    }
    return { matchedCount: matches ? 1 : 0 };
  };
  Item.findById = (id) => {
    assert.equal(id, itemId);
    return makeQuery(item);
  };
  JobMaterialUsage.create = async (documents, options) => {
    assert.equal(options.session, session);
    assert.equal(documents.length, 1);
    createdUsage = makeUsage(documents[0]);
    return [createdUsage];
  };

  try {
    await callback({ job, item, createdUsage: () => createdUsage, session });
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
}

async function withOverrides(overrides, callback) {
  const originals = overrides.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    return await callback();
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
}

const request = (user = { _id: userId, userType: "employee" }, body = {
  itemId,
  quantity: 2,
}) => ({
  params: { id: jobId },
  body,
  query: {},
  user,
  headers: {},
});

test("material usage schema accepts positive quantities and rejects prices and invalid IDs", () => {
  assert.deepEqual(
    createJobMaterialUsageSchema.parse({ itemId, quantity: 0.25 }),
    { itemId, quantity: 0.25 },
  );
  for (const body of [
    { itemId, quantity: 0 },
    { itemId, quantity: -1 },
    { itemId, quantity: Infinity },
    { itemId, quantity: 1, unitCost: 0 },
    { itemId, quantity: 1, lineCostSnapshot: 0 },
    { itemId: "invalid", quantity: 1 },
  ]) {
    assert.equal(createJobMaterialUsageSchema.safeParse(body).success, false);
  }
});

test("usage schema snapshots are immutable and allow repeated same-item entries", () => {
  const usageSchema = JobMaterialUsage.schema;
  for (const field of [
    "itemNameSnapshot",
    "quantity",
    "unitSnapshot",
    "unitCostSnapshot",
    "lineCostSnapshot",
    "recordedBy",
  ]) {
    assert.equal(usageSchema.path(field).options.immutable, true);
  }
  assert.equal(
    usageSchema.indexes().some(
      ([keys]) => keys.jobId === 1 && keys.itemId === 1,
    ),
    false,
  );
});

test("material usage routes' role convention permits employee writes and admin reads only", () => {
  for (const role of ["admin", "superAdmin"]) {
    assert.throws(
      () =>
        authorizeRoles("employee")(
          { user: { userType: role } },
          {},
          () => {},
        ),
      { statusCode: 403 },
    );
    assert.doesNotThrow(() =>
      authorizeRoles("admin", "superAdmin", "employee")(
        { user: { userType: role } },
        {},
        () => {},
      ),
    );
  }
  assert.doesNotThrow(() =>
    authorizeRoles("employee")(
      { user: { userType: "employee" } },
      {},
      () => {},
    ),
  );
});

test("assigned employee can record material usage using server-derived immutable costs", async () => {
  await withCreateMocks({}, async ({ createdUsage, session, job }) => {
    const result = await invoke(createJobMaterialUsage, request());
    const savedUsage = createdUsage();
    assert.equal(result.status, 201);
    assert.deepEqual(
      {
        jobId: savedUsage.jobId,
        itemId: savedUsage.itemId,
        itemNameSnapshot: savedUsage.itemNameSnapshot,
        quantity: savedUsage.quantity,
        unitSnapshot: savedUsage.unitSnapshot,
        unitCostSnapshot: savedUsage.unitCostSnapshot,
        lineCostSnapshot: savedUsage.lineCostSnapshot,
        recordedBy: savedUsage.recordedBy,
      },
      {
        jobId,
        itemId,
        itemNameSnapshot: "Air filter",
        quantity: 2,
        unitSnapshot: "piece",
        unitCostSnapshot: 12.345,
        lineCostSnapshot: 24.69,
        recordedBy: userId,
      },
    );
    assert.equal("unitCostSnapshot" in result.body.data, false);
    assert.equal("lineCostSnapshot" in result.body.data, false);
    assert.equal(session.transactionCount, 1);
    assert.equal(session.ended, true);
    assert.equal(job.materialUsageRevision, 1);
  });
});

test("cost calculation rounds to two decimal places using nearest-cent rounding", async () => {
  await withCreateMocks(
    { item: makeItem({ currentUnitCost: 0.335 }) },
    async ({ createdUsage }) => {
    await invoke(
      createJobMaterialUsage,
      request({ _id: userId, userType: "employee" }, { itemId, quantity: 1 }),
    );
    assert.equal(createdUsage().lineCostSnapshot, 0.34);
    },
  );
});

test("usage creation rejects deleted/missing Jobs, other assignees, and non-IN_PROGRESS status", async (t) => {
  const cases = [
    ["missing Job", null, 404],
    ["deleted Job", makeJob({ isDeleted: true }), 404],
    ["other assignee", makeJob({ assignedEmployeeId: otherUserId }), 403],
    ["not in progress", makeJob({ status: "ON_HOLD" }), 400],
  ];

  for (const [name, job, statusCode] of cases) {
    await t.test(name, async () => {
      await withCreateMocks({ job }, async ({ createdUsage }) => {
        const error = await captureError(createJobMaterialUsage, request());
        assert.equal(error.statusCode, statusCode);
        assert.equal(createdUsage(), undefined);
      });
    });
  }
});

test("usage is not inserted when reassignment wins before the atomic Job check", async () => {
  const originals = [
    [ATM, "findById", ATM.findById],
    [Employee, "findOne", Employee.findOne],
    [JobHistory, "create", JobHistory.create],
  ];
  ATM.findById = async () => ({ assignedEmployeeId: [employeeId] });
  Employee.findOne = () => ({
    populate: async () => ({
      _id: employeeId,
      status: "active",
      userId: { status: "active", userType: "employee" },
    }),
  });
  JobHistory.create = async () => ({});

  try {
    await withCreateMocks(
      {
        job: makeJob(),
        beforeJobUpdate: async () => {
          const result = await invoke(reassignJob, {
            params: { id: jobId },
            body: { employeeId: otherUserId, reason: "Reassignment race test" },
            user: { _id: adminId, userType: "admin" },
            headers: {},
          });
          assert.equal(result.status, 200);
        },
      },
      async ({ createdUsage, job }) => {
        const error = await captureError(createJobMaterialUsage, request());
        assert.equal(error.statusCode, 403, error.message);
        assert.equal(job.assignedEmployeeId, otherUserId);
        assert.equal(createdUsage(), undefined);
      },
    );
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
});

test("usage is not inserted when a Job status transition wins before the atomic check", async () => {
  await withOverrides(
    [[JobHistory, "create", async () => ({})]],
    () =>
      withCreateMocks(
        {
          beforeJobUpdate: async () => {
            const result = await invoke(holdJob, {
              params: { id: jobId },
              body: {},
              user: { _id: userId, userType: "employee" },
              headers: {},
            });
            assert.equal(result.status, 200);
          },
        },
        async ({ createdUsage, job }) => {
          const error = await captureError(createJobMaterialUsage, request());
          assert.equal(job.status, "ON_HOLD");
          assert.equal(error.statusCode, 400, error.message);
          assert.equal(createdUsage(), undefined);
        },
      ),
  );
});

test("usage is not inserted when Job deletion wins before the atomic check", async () => {
  await withCreateMocks(
    {
      beforeJobUpdate: async (job) => {
        job.isDeleted = true;
      },
    },
    async ({ createdUsage, job }) => {
      const error = await captureError(createJobMaterialUsage, request());
      assert.equal(error.statusCode, 404);
      assert.equal(job.isDeleted, true);
      assert.equal(createdUsage(), undefined);
    },
  );
});

test("usage creation rejects missing or inactive Items and non-finite costs", async (t) => {
  for (const [name, item, expectedStatus] of [
    ["missing Item", null, 404],
    ["inactive Item", makeItem({ isActive: false }), 404],
    ["invalid stored cost", makeItem({ currentUnitCost: Infinity }), 400],
  ]) {
    await t.test(name, async () => {
      await withCreateMocks({ item }, async ({ createdUsage }) => {
        const error = await captureError(createJobMaterialUsage, request());
        assert.equal(error.statusCode, expectedStatus);
        assert.equal(createdUsage(), undefined);
      });
    });
  }
});

test("employees see all Job usage but never costs; admins see immutable cost snapshots", async () => {
  const originalJobFindById = Job.findById;
  const originalUsageFind = JobMaterialUsage.find;
  const originalItemFindById = Item.findById;
  const job = makeJob();
  const item = {
    _id: itemId,
    itemName: "Air filter",
    unit: "piece",
    currentUnitCost: 12.345,
    isActive: true,
    async save() {
      return this;
    },
  };
  const entry = makeUsage({
    jobId,
    itemId,
    itemNameSnapshot: "Air filter",
    quantity: 2,
    unitSnapshot: "piece",
    unitCostSnapshot: 12.345,
    lineCostSnapshot: 24.69,
    recordedBy: otherUserId,
  });
  let sortOrder;

  Job.findById = async () => job;
  Item.findById = async () => item;
  JobMaterialUsage.find = (filter) => {
    assert.deepEqual(filter, { jobId });
    return {
      sort(sort) {
        sortOrder = sort;
        return { lean: async () => [entry] };
      },
    };
  };

  try {
    const employeeResult = await invoke(
      getJobMaterialUsage,
      request(),
    );
    assert.equal(employeeResult.status, 200);
    assert.equal("unitCostSnapshot" in employeeResult.body.data[0], false);
    assert.equal("lineCostSnapshot" in employeeResult.body.data[0], false);
    assert.equal(employeeResult.body.data[0].itemNameSnapshot, "Air filter");
    assert.deepEqual(sortOrder, { createdAt: 1, _id: 1 });

    const adminResult = await invoke(
      getJobMaterialUsage,
      request({ _id: adminId, userType: "admin" }),
    );
    assert.equal(adminResult.body.data[0].unitCostSnapshot, 12.345);
    assert.equal(adminResult.body.data[0].lineCostSnapshot, 24.69);

    await invoke(updateItem, {
      params: { id: itemId },
      body: { currentUnitCost: 99 },
      user: { _id: adminId },
    });
    assert.equal(item.currentUnitCost, 99);
    assert.equal(adminResult.body.data[0].unitCostSnapshot, 12.345);
    assert.equal(adminResult.body.data[0].lineCostSnapshot, 24.69);
  } finally {
    Job.findById = originalJobFindById;
    JobMaterialUsage.find = originalUsageFind;
    Item.findById = originalItemFindById;
  }
});

test("former assignee cannot read usage entries", async () => {
  const originalJobFindById = Job.findById;
  const originalUsageFind = JobMaterialUsage.find;
  Job.findById = async () => makeJob();
  JobMaterialUsage.find = () => assert.fail("Must not read usage entries");

  try {
    const error = await captureError(
      getJobMaterialUsage,
      request({ _id: otherUserId, userType: "employee" }),
    );
    assert.equal(error.statusCode, 403);
  } finally {
    Job.findById = originalJobFindById;
    JobMaterialUsage.find = originalUsageFind;
  }
});

test("ordinary reassignment preserves existing usage records", async () => {
  const originals = [
    [Job, "findById", Job.findById],
    [ATM, "findById", ATM.findById],
    [Employee, "findOne", Employee.findOne],
    [JobHistory, "create", JobHistory.create],
  ];
  const usageEntries = [makeUsage({ itemNameSnapshot: "Previously used filter" })];
  const job = makeJob({ assignedEmployeeId: otherUserId });
  let materialMutationCalls = 0;
  const originalMaterialMutators = [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findByIdAndUpdate",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
    "findByIdAndDelete",
  ].map((method) => {
    const original = JobMaterialUsage[method];
    JobMaterialUsage[method] = () => {
      materialMutationCalls += 1;
      return Promise.resolve();
    };
    return [method, original];
  });
  let findByIdCount = 0;
  Job.findById = () => {
    findByIdCount += 1;
    return findByIdCount === 1 ? Promise.resolve(job) : makeQuery(job);
  };
  ATM.findById = async () => ({ assignedEmployeeId: [employeeId] });
  Employee.findOne = () => ({
    populate: async () => ({
      _id: employeeId,
      status: "active",
      userId: { status: "active", userType: "employee" },
    }),
  });
  JobHistory.create = async () => ({});

  try {
    const result = await invoke(reassignJob, {
      params: { id: jobId },
      body: { employeeId: userId, reason: "Operational reassignment" },
      user: { _id: adminId, userType: "admin" },
      headers: {},
    });
    assert.equal(result.status, 200);
    assert.equal(job.assignedEmployeeId, userId);
    assert.equal(usageEntries[0].itemNameSnapshot, "Previously used filter");
    assert.equal(materialMutationCalls, 0);
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
    for (const [method, original] of originalMaterialMutators) {
      JobMaterialUsage[method] = original;
    }
  }
});

test("rejection/rework preserves existing usage records and snapshots", async () => {
  const originals = [
    [Job, "findById", Job.findById],
    [JobHistory, "create", JobHistory.create],
    [JobPhoto, "countDocuments", JobPhoto.countDocuments],
    [Employee, "findOne", Employee.findOne],
  ];
  const usageEntries = [
    makeUsage({
      itemNameSnapshot: "Previously used filter",
      unitCostSnapshot: 12.345,
      lineCostSnapshot: 24.69,
    }),
  ];
  let materialMutationCalls = 0;
  const originalMaterialMutators = [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findByIdAndUpdate",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
    "findByIdAndDelete",
  ].map((method) => {
    const original = JobMaterialUsage[method];
    JobMaterialUsage[method] = () => {
      materialMutationCalls += 1;
      return Promise.resolve();
    };
    return [method, original];
  });
  const job = makeJob({
    status: "COMPLETED",
    beforePhotos: ["b1", "b2", "b3"],
    afterPhotos: ["a1", "a2", "a3"],
  });
  let findByIdCount = 0;
  Job.findById = () => {
    findByIdCount += 1;
    return findByIdCount === 1 ? Promise.resolve(job) : makeQuery(job);
  };
  JobHistory.create = async () => ({});
  JobPhoto.countDocuments = async () => 3;
  Employee.findOne = () => ({
    populate: async () => ({
      _id: employeeId,
      status: "active",
      userId: { status: "active", userType: "employee" },
    }),
  });

  try {
    const result = await invoke(verifyJob, {
      params: { id: jobId },
      body: { action: "reject", remarks: "Please redo the work" },
      user: { _id: adminId, userType: "admin" },
      headers: {},
    });
    assert.equal(result.status, 200);
    assert.equal(job.status, "ASSIGNED");
    assert.equal(usageEntries[0].unitCostSnapshot, 12.345);
    assert.equal(usageEntries[0].lineCostSnapshot, 24.69);
    assert.equal(materialMutationCalls, 0);
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
    for (const [method, original] of originalMaterialMutators) {
      JobMaterialUsage[method] = original;
    }
  }
});
