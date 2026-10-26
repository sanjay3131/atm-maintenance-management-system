import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import AMC from "../../src/modules/amc/amc.model.js";
import ATM from "../../src/modules/atms/atm.model.js";
import ATMLocationRequest from "../../src/modules/atms/atmLocationRequest.model.js";
import ATMLocationTask from "../../src/modules/atms/atmLocationTask.model.js";
import Employee from "../../src/modules/employees/employee.model.js";
import User from "../../src/modules/users/user.model.js";
import {
  approveATMlocationRequest,
  rejectATMlocationRequest,
  submitATMlocationRequest,
} from "../../src/modules/atms/atmLocationRequest.service.js";
import { createBulkATMLocationTasks } from "../../src/modules/atms/atmLocationTask.service.js";

const expectedDatabaseName = "atm_location_integration_test";
const testMongoUri = process.env.TEST_MONGODB_URI;

if (!testMongoUri) {
  throw new Error(
    "TEST_MONGODB_URI is required for the opt-in MongoDB integration test",
  );
}

let parsedUri;
try {
  parsedUri = new URL(testMongoUri);
} catch {
  throw new Error("TEST_MONGODB_URI is malformed");
}
const replicaSetOptions = parsedUri.searchParams.getAll("replicaSet");
const allowedOptions = [...parsedUri.searchParams.keys()];
if (
  parsedUri.protocol !== "mongodb:" ||
  !["localhost", "127.0.0.1"].includes(parsedUri.hostname) ||
  parsedUri.username ||
  parsedUri.password ||
  decodeURIComponent(parsedUri.pathname.slice(1)) !== expectedDatabaseName ||
  replicaSetOptions.length !== 1 ||
  replicaSetOptions[0] !== "rs0" ||
  allowedOptions.some((option) => option !== "replicaSet")
) {
  throw new Error(
    "TEST_MONGODB_URI must target the local atm_location_integration_test database with replicaSet=rs0 and no credentials",
  );
}

const registeredModels = [
  AMC,
  ATM,
  ATMLocationRequest,
  ATMLocationTask,
  Employee,
  User,
];
const ownedIds = new Map(registeredModels.map((model) => [model, []]));
const remember = (model, document) => {
  ownedIds.get(model).push(document._id);
  return document;
};

const createUser = async (userType, suffix) =>
  remember(
    User,
    await User.create({
      firstName: `Mongo ${userType}`,
      lastName: "Integration",
      email: `${userType}-${suffix}@integration.invalid`,
      password: "test-only-password",
      phoneNumber: `test-${userType}-${suffix}`,
      userType,
      status: "active",
    }),
  );

const createATM = async ({ createdBy, configured = false } = {}) =>
  remember(
    ATM,
    await ATM.create({
      atmId: `MONGO-IT-${new mongoose.Types.ObjectId().toString()}`,
      customer: new mongoose.Types.ObjectId(),
      bankId: new mongoose.Types.ObjectId(),
      districtId: new mongoose.Types.ObjectId(),
      locationName: "Mongo integration ATM",
      address: "Isolated test fixture",
      installationType: "ONSITE",
      createdBy,
      locationConfigured: configured,
      ...(configured
        ? {
            location: { type: "Point", coordinates: [77.6, 12.5] },
            locationCapturedAt: new Date("2026-01-01T00:00:00.000Z"),
          }
        : {}),
    }),
  );

const makeTaskInput = (atm, employee, taskType = "INITIAL_COLLECTION") => ({
  atmId: String(atm._id),
  employeeId: String(employee._id),
  taskType,
});

const makeProposal = (atm, requester, updates = {}) => ({
  atmId: String(atm._id),
  requester: { _id: requester._id, userType: requester.userType },
  latitude: 12.5,
  longitude: 77.6,
  inputSource: "MANUAL",
  ...updates,
});

const assertNoConflictingWorkflow = async (atmId) => {
  const [pendingRequest, activeTask] = await Promise.all([
    ATMLocationRequest.exists({
      atmId,
      status: "PENDING",
      locationTaskId: null,
    }),
    ATMLocationTask.exists({ atmId, active: true }),
  ]);
  assert.equal(
    Boolean(pendingRequest && activeTask),
    false,
    "an ATM must not have both a pending unlinked request and an active task",
  );
  return { pendingRequest, activeTask };
};

test("location request/task invariants use real MongoDB transactions", async (t) => {
  await mongoose.connect(testMongoUri, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: false,
    autoCreate: false,
  });
  t.after(async () => {
    for (const model of [
      ATMLocationRequest,
      ATMLocationTask,
      AMC,
      Employee,
      ATM,
      User,
    ]) {
      const ids = ownedIds.get(model);
      if (ids.length) await model.deleteMany({ _id: { $in: ids } });
    }
    await mongoose.disconnect();
  });

  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  assert.equal(hello.setName, "rs0", "MongoDB must be a replica set");
  assert.equal(hello.isWritablePrimary, true, "replica-set primary is required");
  assert.notEqual(
    hello.logicalSessionTimeoutMinutes,
    undefined,
    "MongoDB sessions must be supported",
  );

  const existingCollections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const expectedCollections = new Set(
    registeredModels.map((model) => model.collection.collectionName),
  );
  assert.ok(
    existingCollections.every(({ name }) => expectedCollections.has(name)),
    "the dedicated test database contains an unexpected collection",
  );
  for (const { name } of existingCollections) {
    assert.equal(
      await mongoose.connection.db.collection(name).countDocuments(),
      0,
      "the dedicated test database must contain no documents before this suite runs",
    );
  }

  for (const model of registeredModels) await model.init();

  const suffix = new mongoose.Types.ObjectId().toString();
  const admin = await createUser("admin", suffix);
  const superAdmin = await createUser("superAdmin", suffix);
  const employeeUser = await createUser("employee", suffix);
  const employee = remember(
    Employee,
    await Employee.create({
      userId: employeeUser._id,
      employeeCode: `MONGO-IT-${suffix}`,
      designation: "Field technician",
      department: "Maintenance",
      joiningDate: new Date("2026-01-01T00:00:00.000Z"),
      employmentType: "full-time",
      status: "active",
      createdBy: admin._id,
    }),
  );

  await t.test("pending standalone request blocks task assignment", async () => {
    const atm = await createATM({ createdBy: admin._id });
    const request = remember(
      ATMLocationRequest,
      await submitATMlocationRequest(makeProposal(atm, admin)),
    );

    await assert.rejects(
      createBulkATMLocationTasks({
        tasks: [makeTaskInput(atm, employee)],
        adminId: admin._id,
      }),
      (error) =>
        error.statusCode === 400 &&
        error.errors?.[0]?.statusCode === 409,
    );
    assert.equal(
      await ATMLocationTask.countDocuments({ atmId: atm._id, active: true }),
      0,
    );
    assert.equal(
      (await ATMLocationRequest.findById(request._id)).status,
      "PENDING",
    );
    assert.equal(atm.locationConfigured, false);
    await assertNoConflictingWorkflow(atm._id);
  });

  await t.test("active task blocks standalone request submission", async () => {
    const atm = await createATM({ createdBy: admin._id });
    const [task] = await createBulkATMLocationTasks({
      tasks: [makeTaskInput(atm, employee)],
      adminId: admin._id,
    });
    remember(ATMLocationTask, task);

    await assert.rejects(
      submitATMlocationRequest(makeProposal(atm, admin)),
      { statusCode: 409 },
    );
    assert.equal(
      await ATMLocationRequest.countDocuments({
        atmId: atm._id,
        status: "PENDING",
        locationTaskId: null,
      }),
      0,
    );
    assert.equal(atm.locationConfigured, false);
    await assertNoConflictingWorkflow(atm._id);
  });

  await t.test("pending AMC-linked request keeps its ownership and blocks assignment", async () => {
    const atm = await createATM({ createdBy: admin._id });
    const amc = remember(
      AMC,
      await AMC.create({
        amcId: `MONGO-IT-AMC-${suffix}`,
        atmId: atm._id,
        employeeId: employeeUser._id,
        month: 1,
        year: 2026,
        status: "IN_PROGRESS",
        deadlineDate: new Date("2026-01-20T00:00:00.000Z"),
        createdBy: admin._id,
      }),
    );
    const request = remember(
      ATMLocationRequest,
      await submitATMlocationRequest(
        makeProposal(atm, employeeUser, { amcId: String(amc._id) }),
      ),
    );
    assert.equal(String(request.amcId), String(amc._id));
    assert.equal(String(request.requestedBy), String(employeeUser._id));
    assert.equal(String(request.requesterEmployeeId), String(employee._id));

    await assert.rejects(
      createBulkATMLocationTasks({
        tasks: [makeTaskInput(atm, employee)],
        adminId: admin._id,
      }),
      (error) =>
        error.statusCode === 400 &&
        error.errors?.[0]?.statusCode === 409,
    );
    assert.equal(
      (await ATMLocationRequest.findById(request._id)).status,
      "PENDING",
    );
    await assertNoConflictingWorkflow(atm._id);
  });

  await t.test("concurrent assignment and request serialize through a real retry", async () => {
    const atm = await createATM({ createdBy: admin._id });
    const originalStartSession = mongoose.startSession;
    let firstCallbacks = 0;
    let callbackAttempts = 0;
    let releaseBarrier;
    const barrier = new Promise((resolve) => {
      releaseBarrier = resolve;
    });

    mongoose.startSession = async function (...args) {
      const session = await originalStartSession.apply(this, args);
      const withTransaction = session.withTransaction.bind(session);
      let firstCallback = true;
      session.withTransaction = (callback, ...transactionArgs) =>
        withTransaction(
          async (...callbackArgs) => {
            callbackAttempts += 1;
            if (firstCallback) {
              firstCallback = false;
              firstCallbacks += 1;
              if (firstCallbacks === 2) releaseBarrier();
              await barrier;
            }
            return callback(...callbackArgs);
          },
          ...transactionArgs,
        );
      return session;
    };

    let results;
    try {
      results = await Promise.allSettled([
        submitATMlocationRequest(makeProposal(atm, admin)),
        createBulkATMLocationTasks({
          tasks: [makeTaskInput(atm, employee)],
          adminId: admin._id,
        }),
      ]);
    } finally {
      mongoose.startSession = originalStartSession;
    }

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      if (Array.isArray(result.value)) {
        for (const task of result.value) remember(ATMLocationTask, task);
      } else {
        remember(ATMLocationRequest, result.value);
      }
    }

    assert.equal(firstCallbacks, 2);
    assert.ok(
      callbackAttempts >= 3,
      `expected a MongoDB transaction retry; observed ${callbackAttempts} callback attempts`,
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );

    const state = await assertNoConflictingWorkflow(atm._id);
    assert.equal(Boolean(state.pendingRequest) !== Boolean(state.activeTask), true);
    assert.equal(atm.locationConfigured, false);
    if (state.pendingRequest) {
      const request = await ATMLocationRequest.findOne({
        atmId: atm._id,
        status: "PENDING",
        locationTaskId: null,
      });
      remember(ATMLocationRequest, request);
    }
    if (state.activeTask) {
      const task = await ATMLocationTask.findOne({ atmId: atm._id, active: true });
      remember(ATMLocationTask, task);
    }
  });

  await t.test("a real task insert is rolled back on a later transaction error", async () => {
    const originalCoordinates = [77.61, 12.51];
    const atms = await Promise.all([
      createATM({ createdBy: admin._id, configured: true }),
      createATM({ createdBy: admin._id, configured: true }),
    ]);
    for (const atm of atms) {
      atm.location.coordinates = [...originalCoordinates];
      await atm.save();
    }

    const originalCreate = ATMLocationTask.create;
    let createCalls = 0;
    ATMLocationTask.create = async function (...args) {
      createCalls += 1;
      if (createCalls === 2) {
        throw new Error("intentional integration rollback probe");
      }
      return originalCreate.apply(this, args);
    };
    try {
      await assert.rejects(
        createBulkATMLocationTasks({
          tasks: atms.map((atm) =>
            makeTaskInput(atm, employee, "LOCATION_CORRECTION"),
          ),
          adminId: admin._id,
        }),
        /intentional integration rollback probe/,
      );
    } finally {
      ATMLocationTask.create = originalCreate;
    }

    assert.equal(createCalls, 2);
    assert.equal(await ATMLocationTask.countDocuments({ atmId: { $in: atms.map((atm) => atm._id) } }), 0);
    for (const atm of atms) {
      const persisted = await ATM.collection.findOne({ _id: atm._id });
      assert.deepEqual(persisted.location.coordinates, originalCoordinates);
      assert.equal(persisted.locationConfigured, true);
      assert.equal(persisted.locationWorkflowRevision ?? 0, 0);
    }
  });

  await t.test("legacy conflict cannot approve or mutate official coordinates", async () => {
    const originalCoordinates = [77.62, 12.52];
    const atm = await createATM({ createdBy: admin._id, configured: true });
    atm.location.coordinates = [...originalCoordinates];
    await atm.save();
    const request = remember(
      ATMLocationRequest,
      await submitATMlocationRequest(
        makeProposal(atm, admin, { latitude: 12.6, longitude: 77.7 }),
      ),
    );
    const legacyTask = remember(
      ATMLocationTask,
      await ATMLocationTask.create({
        atmId: atm._id,
        assignedEmployeeId: employee._id,
        taskType: "LOCATION_CORRECTION",
        status: "ASSIGNED",
        active: true,
        createdBy: admin._id,
      }),
    );
    assert.ok(legacyTask);

    await assert.rejects(
      approveATMlocationRequest({
        requestId: String(request._id),
        reviewerId: superAdmin._id,
      }),
      { statusCode: 409 },
    );
    assert.equal(
      (await ATMLocationRequest.findById(request._id)).status,
      "PENDING",
    );
    const persistedATM = await ATM.findById(atm._id).select("+locationWorkflowRevision");
    assert.deepEqual(persistedATM.location.coordinates, originalCoordinates);
    assert.equal(persistedATM.locationConfigured, true);
    assert.ok(
      await ATMLocationRequest.exists({
        _id: request._id,
        status: "PENDING",
      }),
    );
    assert.ok(
      await ATMLocationTask.exists({
        _id: legacyTask._id,
        active: true,
      }),
    );
  });

  await t.test("approval stores longitude then latitude and rejection preserves official coordinates", async () => {
    const approvalATM = await createATM({ createdBy: admin._id });
    const pendingApproval = remember(
      ATMLocationRequest,
      await submitATMlocationRequest(
        makeProposal(approvalATM, admin, {
          latitude: 12.75,
          longitude: 77.85,
        }),
      ),
    );
    await approveATMlocationRequest({
      requestId: String(pendingApproval._id),
      reviewerId: superAdmin._id,
    });
    const approvedATM = await ATM.findById(approvalATM._id);
    assert.deepEqual(approvedATM.location.coordinates, [77.85, 12.75]);

    const correctionATM = await createATM({
      createdBy: admin._id,
      configured: true,
    });
    const originalCoordinates = [...correctionATM.location.coordinates];
    const pendingRejection = remember(
      ATMLocationRequest,
      await submitATMlocationRequest(
        makeProposal(correctionATM, admin, {
          latitude: 12.8,
          longitude: 77.9,
        }),
      ),
    );
    await rejectATMlocationRequest({
      requestId: String(pendingRejection._id),
      reviewerId: superAdmin._id,
      reason: "Integration test rejection",
    });
    const rejectedATM = await ATM.findById(correctionATM._id);
    assert.deepEqual(rejectedATM.location.coordinates, originalCoordinates);
    assert.equal(rejectedATM.locationConfigured, true);
  });
});
