import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import ATM from "../src/modules/atms/atm.model.js";
import ATMLocationRequest from "../src/modules/atms/atmLocationRequest.model.js";
import ATMLocationTask from "../src/modules/atms/atmLocationTask.model.js";
import Customer from "../src/modules/customers/customer.model.js";
import District from "../src/modules/districts/district.models.js";
import Employee from "../src/modules/employees/employee.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import Region from "../src/modules/region/region.model.js";
import User from "../src/modules/users/user.model.js";
import atmRouter from "../src/modules/atms/atm.routes.js";
import jobRouter from "../src/modules/jobs/jobs.routes.js";
import errorMiddleware from "../src/middlewares/error.middleware.js";

const TEST_ACCESS_SECRET = "integrated-atm-lifecycle-test-secret";

const objectId = () => new mongoose.Types.ObjectId().toString();
const sameId = (left, right) =>
  String(left?._id ?? left) === String(right?._id ?? right);

const makeQuery = (value) => {
  let result = value;
  return {
    populate(path) {
      if (path === "userId" && result && !Array.isArray(result)) {
        const employee = result;
        result = {
          ...employee,
          userId: employee.userIdRecord ?? employee.userId,
        };
      }
      return this;
    },
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
    session() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
};

const makePersistedRecord = (data, extra = {}) => ({
  ...data,
  ...extra,
  async save() {
    return this;
  },
});

function createMemoryPersistence() {
  const ids = {
    admin: objectId(),
    superAdmin: objectId(),
    supervisor: objectId(),
    customerUser: objectId(),
    employeeUser: objectId(),
    otherEmployeeUser: objectId(),
    employee: objectId(),
    otherEmployee: objectId(),
    customer: objectId(),
    bank: objectId(),
    district: objectId(),
  };
  const users = new Map([
    [
      ids.admin,
      {
        _id: ids.admin,
        userType: "admin",
        status: "active",
        firstName: "Test",
        lastName: "Admin",
      },
    ],
    [
      ids.superAdmin,
      {
        _id: ids.superAdmin,
        userType: "superAdmin",
        status: "active",
        firstName: "Test",
        lastName: "SuperAdmin",
      },
    ],
    [
      ids.supervisor,
      {
        _id: ids.supervisor,
        userType: "supervisor",
        status: "active",
      },
    ],
    [
      ids.customerUser,
      {
        _id: ids.customerUser,
        userType: "customer",
        status: "active",
      },
    ],
    [
      ids.employeeUser,
      {
        _id: ids.employeeUser,
        userType: "employee",
        status: "active",
        firstName: "Assigned",
        lastName: "Employee",
      },
    ],
    [
      ids.otherEmployeeUser,
      {
        _id: ids.otherEmployeeUser,
        userType: "employee",
        status: "active",
        firstName: "Other",
        lastName: "Employee",
      },
    ],
  ]);
  const employees = new Map();
  for (const [employeeId, userId] of [
    [ids.employee, ids.employeeUser],
    [ids.otherEmployee, ids.otherEmployeeUser],
  ]) {
    const employee = makePersistedRecord({
      _id: employeeId,
      userId,
      userIdRecord: users.get(userId),
      status: "active",
      assignedAtmIds: [],
      employeeCode: `TEST-${employeeId.slice(-6)}`,
    });
    employees.set(employeeId, employee);
  }

  const customer = makePersistedRecord({
    _id: ids.customer,
    bankName: "Integrated Test Bank",
    isActive: true,
    isDeleted: false,
    atmIds: [],
  });
  const banks = new Map([
    [
      ids.bank,
      {
        _id: ids.bank,
        bankName: "Integrated Test Bank",
        bankCode: `IT${ids.bank.slice(-6)}`,
        isActive: true,
      },
    ],
  ]);
  const district = { _id: ids.district, isActive: true };
  const atms = new Map();
  const jobs = new Map();
  const requests = new Map();
  const locationTasks = new Map();
  const photos = new Map();
  const jobHistory = [];
  let workflowLockTail = Promise.resolve();

  const matchesATM = (atm, filter) => {
    if (!atm) return false;
    if (filter._id && !sameId(atm._id, filter._id)) return false;
    if (filter.isDeleted !== undefined && atm.isDeleted !== filter.isDeleted) {
      return false;
    }
    if (
      filter.locationConfigured === true &&
      atm.locationConfigured !== true
    ) {
      return false;
    }
    if (
      filter.locationConfigured?.$ne === true &&
      atm.locationConfigured === true
    ) {
      return false;
    }
    if (
      filter.locationRequestWindowOpen?.$ne === true &&
      atm.locationRequestWindowOpen === true
    ) {
      return false;
    }
    if (Object.hasOwn(filter, "location.coordinates")) {
      const current = atm.location?.coordinates ?? null;
      if (JSON.stringify(current) !== JSON.stringify(filter["location.coordinates"])) {
        return false;
      }
    }
    if (
      Object.hasOwn(filter, "locationCapturedAt") &&
      (atm.locationCapturedAt ?? null)?.getTime?.() !==
        (filter.locationCapturedAt ?? null)?.getTime?.()
    ) {
      return false;
    }
    if (
      Object.hasOwn(filter, "locationCapturedBy") &&
      !sameId(atm.locationCapturedBy ?? "", filter.locationCapturedBy ?? "")
    ) {
      return false;
    }
    return true;
  };

  const originals = [];
  const replace = (target, key, value) => {
    originals.push([target, key, target[key]]);
    target[key] = value;
  };

  replace(mongoose, "startSession", async () => ({
    async withTransaction(operation) {
      const captureSnapshots = () => ({
        atms: new Map(
          [...atms].map(([id, atm]) => [
            id,
            { ...atm, location: structuredClone(atm.location) },
          ]),
        ),
        requests: new Map(
          [...requests].map(([id, request]) => [id, { ...request }]),
        ),
        tasks: new Map(
          [...locationTasks].map(([id, task]) => [id, { ...task }]),
        ),
        requestIds: new Set(requests.keys()),
        taskIds: new Set(locationTasks.keys()),
      });
      let snapshots = captureSnapshots();
      this.refreshWorkflowSnapshot = () => {
        snapshots = captureSnapshots();
      };
      try {
        return await operation(this);
      } catch (error) {
        for (const [id, snapshot] of snapshots.atms) {
          Object.assign(atms.get(id), snapshot);
        }
        for (const [id, snapshot] of snapshots.requests) {
          Object.assign(requests.get(id), snapshot);
        }
        for (const [id, snapshot] of snapshots.tasks) {
          Object.assign(locationTasks.get(id), snapshot);
        }
        for (const id of requests.keys()) {
          if (!snapshots.requestIds.has(id)) requests.delete(id);
        }
        for (const id of locationTasks.keys()) {
          if (!snapshots.taskIds.has(id)) locationTasks.delete(id);
        }
        throw error;
      } finally {
        this.releaseWorkflowLock?.();
      }
    },
    async endSession() {},
  }));
  replace(User, "findById", (id) => makeQuery(users.get(String(id)) ?? null));
  replace(Employee, "findById", (id) =>
    makeQuery(employees.get(String(id)) ?? null),
  );
  replace(Employee, "findOne", (filter) => {
    const employee =
      [...employees.values()].find((candidate) =>
        sameId(candidate.userId, filter.userId),
      ) ?? null;
    return makeQuery(employee);
  });
  replace(Employee, "find", (filter) =>
    makeQuery(
      [...employees.values()].filter((employee) =>
        (employee.assignedAtmIds ?? []).some((id) =>
          sameId(id, filter.assignedAtmIds),
        ),
      ),
    ),
  );
  replace(District, "findById", (id) =>
    makeQuery(sameId(district._id, id) ? district : null),
  );
  replace(Region, "countDocuments", async () => 0);
  replace(Customer, "findOne", () =>
    makeQuery(customer.isActive && !customer.isDeleted ? customer : null),
  );
  replace(Customer, "updateMany", async () => ({ modifiedCount: 0 }));
  replace(ATM, "create", async (records) => {
    const atm = makePersistedRecord(records[0], {
      _id: objectId(),
      isDeleted: false,
      status: "ACTIVE",
      locationConfigured: false,
      locationCapturedAt: null,
      locationCapturedBy: null,
      locationAccuracy: null,
      locationRequestWindowOpen: false,
      locationRequestApproved: false,
      assignedEmployeeId: [],
      location: undefined,
    });
    atms.set(String(atm._id), atm);
    return [atm];
  });
  replace(ATM, "findOne", (filter = {}) => {
    const found = [...atms.values()].find((atm) =>
      Object.keys(filter).length ? matchesATM(atm, filter) : true,
    );
    return makeQuery(found ?? null);
  });
  replace(ATM, "bumpLocationWorkflowRevision", async (atmId, session) => {
    if (!session.releaseWorkflowLock) {
      const previousLock = workflowLockTail;
      let releaseLock;
      workflowLockTail = new Promise((resolve) => {
        releaseLock = resolve;
      });
      await previousLock;
      session.releaseWorkflowLock = releaseLock;
      session.refreshWorkflowSnapshot?.();
    }
    const atm = atms.get(String(atmId));
    if (!atm || atm.isDeleted) return false;
    atm.locationWorkflowRevision = (atm.locationWorkflowRevision ?? 0) + 1;
    return true;
  });
  replace(ATM, "findById", (id) =>
    makeQuery(atms.get(String(id)) ?? null),
  );
  replace(ATM, "findOneAndUpdate", async (filter, update) => {
    const atm = atms.get(String(filter._id));
    if (!matchesATM(atm, filter)) return null;
    Object.assign(atm, update.$set);
    return atm;
  });
  replace(Job, "countDocuments", async () => jobs.size);
  replace(Job, "create", async (data) => {
    const job = makePersistedRecord(data, {
      _id: objectId(),
      isDeleted: false,
      beforePhotos: [],
      afterPhotos: [],
    });
    jobs.set(String(job._id), job);
    return job;
  });
  replace(Job, "findById", (id) =>
    makeQuery(jobs.get(String(id)) ?? null),
  );
  replace(JobHistory, "create", async (entry) => {
    const persisted = { ...entry, _id: objectId() };
    jobHistory.push(persisted);
    return persisted;
  });
  replace(JobPhoto, "countDocuments", async (filter) => {
    const idsToCount = new Set((filter._id?.$in ?? []).map(String));
    return [...photos.values()].filter(
      (photo) =>
        idsToCount.has(String(photo._id)) &&
        sameId(photo.jobId, filter.jobId) &&
        photo.photoType === filter.photoType &&
        photo.isExpired === false &&
        typeof photo.url === "string" &&
        photo.url.length > 0,
    ).length;
  });
  replace(ATMLocationRequest, "create", async (data) => {
    const requestData = Array.isArray(data) ? data[0] : data;
    const pendingExists = [...requests.values()].some(
      (request) =>
        sameId(request.atmId, requestData.atmId) &&
        request.status === "PENDING",
    );
    if (pendingExists) {
      throw Object.assign(new Error("duplicate pending request"), { code: 11000 });
    }
    const request = {
      ...requestData,
      _id: objectId(),
      submittedAt: new Date(),
    };
    requests.set(String(request._id), request);
    return Array.isArray(data) ? [request] : request;
  });
  const matchesLocationTask = (task, filter) => {
    if (!task) return false;
    return Object.entries(filter).every(([key, expected]) => {
      if (expected && typeof expected === "object" && "$in" in expected) {
        return expected.$in.includes(task[key]);
      }
      return sameId(task[key]?._id ?? task[key], expected?._id ?? expected);
    });
  };
  replace(ATMLocationTask, "findOne", (filter) =>
    makeQuery(
      [...locationTasks.values()].find((task) =>
        matchesLocationTask(task, filter),
      ) ?? null,
    ),
  );
  replace(ATMLocationTask, "create", async (records) => {
    const data = records[0];
    if (
      [...locationTasks.values()].some(
        (task) => sameId(task.atmId, data.atmId) && task.active,
      )
    ) {
      throw Object.assign(new Error("duplicate active location task"), {
        code: 11000,
      });
    }
    const task = {
      ...data,
      _id: objectId(),
      locationRequestId: null,
      assignmentHistory: data.assignmentHistory ?? [],
      active: data.active ?? true,
    };
    locationTasks.set(String(task._id), task);
    return [task];
  });
  replace(ATMLocationTask, "findOneAndUpdate", async (filter, update) => {
    const task = locationTasks.get(String(filter._id));
    if (!matchesLocationTask(task, filter)) return null;
    Object.assign(task, update.$set ?? {});
    if (update.$push?.assignmentHistory) {
      task.assignmentHistory.push(update.$push.assignmentHistory);
    }
    return task;
  });
  replace(ATMLocationTask, "find", (filter) =>
    makeQuery(
      [...locationTasks.values()].filter((task) =>
        matchesLocationTask(task, filter),
      ),
    ),
  );
  replace(ATMLocationTask, "countDocuments", async (filter) =>
    [...locationTasks.values()].filter((task) =>
      matchesLocationTask(task, filter),
    ).length,
  );
  replace(ATMLocationRequest, "find", (filter) =>
    makeQuery(
      [...requests.values()].filter(
        (request) =>
          (!filter.status || request.status === filter.status) &&
          (!filter.atmId || sameId(request.atmId, filter.atmId)) &&
          (!filter.requestedBy || sameId(request.requestedBy, filter.requestedBy)),
      ),
    ),
  );
  replace(ATMLocationRequest, "countDocuments", async (filter) =>
    [...requests.values()].filter(
      (request) =>
        (!filter.status || request.status === filter.status) &&
        (!filter.atmId || sameId(request.atmId, filter.atmId)) &&
        (!filter.requestedBy || sameId(request.requestedBy, filter.requestedBy)),
    ).length,
  );
  replace(ATMLocationRequest, "findById", (id) =>
    makeQuery(requests.get(String(id)) ?? null),
  );
  replace(ATMLocationRequest, "findOne", (filter) =>
    makeQuery(
      [...requests.values()].find(
        (request) =>
          (!filter._id || sameId(request._id, filter._id)) &&
          (!filter.atmId || sameId(request.atmId, filter.atmId)) &&
          (!filter.status || request.status === filter.status) &&
          (filter.locationTaskId === undefined ||
            request.locationTaskId == null),
      ) ?? null,
    ),
  );
  replace(ATMLocationRequest, "findOneAndUpdate", async (filter, update) => {
    const request = requests.get(String(filter._id));
    if (!request || request.status !== filter.status) return null;
    Object.assign(request, update.$set);
    return request;
  });
  replace(ATMLocationRequest, "exists", async (filter) =>
    [...requests.values()].some(
      (request) =>
        sameId(request.atmId, filter.atmId) && request.status === filter.status,
    )
      ? { _id: objectId() }
      : null,
  );

  return {
    ids,
    users,
    employees,
    customer,
    banks,
    district,
    atms,
    jobs,
    requests,
    locationTasks,
    photos,
    jobHistory,
    restore() {
      for (const [target, key, original] of originals.reverse()) {
        target[key] = original;
      }
    },
  };
}

const createTestServer = async (memory) => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/atm", atmRouter);
  app.use("/api/v1/jobs", jobRouter);
  app.use(errorMiddleware);

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const tokenFor = (id) =>
    jwt.sign({ id }, TEST_ACCESS_SECRET, { expiresIn: "5m" });
  const request = async (method, path, userId, body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokenFor(userId)}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  };

  return {
    request,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      memory.restore();
    },
  };
};

test("integrated ATM lifecycle runs through authenticated HTTP routes", async (t) => {
  const previousSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
  const memory = createMemoryPersistence();
  const server = await createTestServer(memory);
  t.after(async () => {
    await server.close();
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = previousSecret;
  });

  const { ids } = memory;
  const adminRequest = (method, path, body) =>
    server.request(method, path, ids.admin, body);
  const employeeRequest = (method, path, body) =>
    server.request(method, path, ids.employeeUser, body);
  const otherEmployeeRequest = (method, path, body) =>
    server.request(method, path, ids.otherEmployeeUser, body);
  const superAdminRequest = (method, path, body) =>
    server.request(method, path, ids.superAdmin, body);
  const supervisorRequest = (method, path, body) =>
    server.request(method, path, ids.supervisor, body);
  const customerRequest = (method, path, body) =>
    server.request(method, path, ids.customerUser, body);

  const createATMResponse = await adminRequest("POST", "/api/v1/atm/createATM", {
    bankId: ids.bank,
    customerId: ids.customer,
    districtId: ids.district,
    regionId: null,
    locationName: "Integrated lifecycle test ATM",
    address: "Test-only address",
    installationType: "ONSITE",
  });
  assert.equal(createATMResponse.status, 201);
  const atmId = createATMResponse.body.data._id;
  const atm = memory.atms.get(atmId);
  assert.ok(atm);
  assert.equal(String(atm.bankId), ids.bank);
  assert.equal(String(atm.customer), ids.customer);
  assert.ok(memory.banks.has(String(atm.bankId)));
  assert.equal(atm.locationConfigured, false);
  assert.equal(atm.location, undefined);

  const assignmentResponse = await adminRequest(
    "PATCH",
    `/api/v1/atm/assignEmployee/${atmId}`,
    { employeeId: ids.employee },
  );
  assert.equal(
    assignmentResponse.status,
    200,
    JSON.stringify(assignmentResponse.body),
  );
  assert.ok(atm.assignedEmployeeId.some((id) => sameId(id, ids.employee)));
  assert.ok(
    memory.employees
      .get(ids.employee)
      .assignedAtmIds.some((id) => sameId(id, atmId)),
  );

  const createJobResponse = await adminRequest("POST", "/api/v1/jobs", {
    title: "Integrated lifecycle maintenance",
    description: "Automated route-level lifecycle test",
    atmId,
    workType: "maintenance",
    priority: "medium",
  });
  assert.equal(createJobResponse.status, 201);
  const jobId = createJobResponse.body.data._id;
  const job = memory.jobs.get(jobId);
  assert.ok(job);
  assert.equal(String(job.atmId), atmId);
  assert.equal(job.status, "PENDING");

  const assignJobResponse = await adminRequest(
    "PUT",
    `/api/v1/jobs/${jobId}/assign`,
    { employeeId: ids.employeeUser },
  );
  assert.equal(assignJobResponse.status, 200);
  assert.equal(String(job.assignedEmployeeId), ids.employeeUser);
  assert.equal(job.status, "ASSIGNED");

  const otherAcceptResponse = await otherEmployeeRequest(
    "PUT",
    `/api/v1/jobs/${jobId}/accept`,
  );
  assert.equal(otherAcceptResponse.status, 403);
  const otherAlterResponse = await otherEmployeeRequest(
    "PUT",
    `/api/v1/jobs/${jobId}`,
    { status: "COMPLETED" },
  );
  assert.equal(otherAlterResponse.status, 403);
  assert.equal(job.status, "ASSIGNED");

  const acceptResponse = await employeeRequest(
    "PUT",
    `/api/v1/jobs/${jobId}/accept`,
  );
  assert.equal(acceptResponse.status, 200);
  assert.equal(job.status, "ACCEPTED");
  assert.ok(job.acceptedAt instanceof Date);

  const proposedGPS = {
    latitude: 10.958404,
    longitude: 78.109983,
    accuracy: 50,
    inputSource: "GPS",
  };
  const rejectedAccuracies = [50.1, 381];
  for (const accuracy of rejectedAccuracies) {
    const rejected = await employeeRequest(
      "POST",
      "/api/v1/atm/location-requests",
      { atmId, ...proposedGPS, accuracy },
    );
    assert.equal(rejected.status, 400);
    assert.equal(
      [...memory.requests.values()].filter(
        (request) => sameId(request.atmId, atmId) && request.status === "PENDING",
      ).length,
      0,
    );
    assert.equal(atm.locationConfigured, false);
    assert.equal(atm.location, undefined);
  }

  const locationResponse = await employeeRequest(
    "POST",
    "/api/v1/atm/location-requests",
    { atmId, ...proposedGPS },
  );
  assert.equal(locationResponse.status, 201);
  const locationRequestId = locationResponse.body.data._id;
  const locationRequest = memory.requests.get(locationRequestId);
  assert.equal(locationRequest.requestType, "INITIAL_CONFIGURATION");
  assert.equal(locationRequest.status, "PENDING");
  assert.equal(locationRequest.accuracy, 50);
  assert.deepEqual(locationRequest.officialLocationSnapshot.coordinates, null);
  assert.equal(atm.locationConfigured, false);
  assert.equal(atm.location, undefined);

  const pendingList = await adminRequest(
    "GET",
    `/api/v1/atm/location-requests?status=PENDING&atmId=${atmId}`,
  );
  assert.equal(pendingList.status, 200);
  assert.equal(pendingList.body.data.requests.length, 1);
  assert.equal(pendingList.body.data.requests[0]._id, locationRequestId);

  const unauthorizedApproval = await employeeRequest(
    "POST",
    `/api/v1/atm/location-requests/${locationRequestId}/approve`,
  );
  assert.equal(unauthorizedApproval.status, 403);
  assert.equal(locationRequest.status, "PENDING");

  const approvalResponse = await adminRequest(
    "POST",
    `/api/v1/atm/location-requests/${locationRequestId}/approve`,
  );
  assert.equal(approvalResponse.status, 200);
  assert.equal(locationRequest.status, "APPROVED");
  assert.equal(String(locationRequest.reviewedBy), ids.admin);
  assert.ok(locationRequest.reviewedAt instanceof Date);
  assert.equal(atm.locationConfigured, true);
  assert.deepEqual(atm.location, {
    type: "Point",
    coordinates: [proposedGPS.longitude, proposedGPS.latitude],
  });
  assert.equal(atm.locationAccuracy, proposedGPS.accuracy);
  assert.equal(String(atm.locationCapturedBy), ids.admin);
  assert.equal(atm.locationCapturedAt, locationRequest.reviewedAt);
  assert.equal(atm.locationRequestApproved, true);

  const duplicateApproval = await adminRequest(
    "POST",
    `/api/v1/atm/location-requests/${locationRequestId}/approve`,
  );
  assert.equal(duplicateApproval.status, 409);
  assert.equal(locationRequest.status, "APPROVED");

  const officialCoordinatesBeforeAdminProposal = structuredClone(atm.location);
  const adminProposal = await adminRequest(
    "POST",
    "/api/v1/atm/location-requests",
    {
      atmId,
      latitude: proposedGPS.latitude + 0.00003,
      longitude: proposedGPS.longitude,
      inputSource: "MANUAL",
      requestedBy: ids.superAdmin,
      requesterRole: "superAdmin",
    },
  );
  assert.equal(adminProposal.status, 201, JSON.stringify(adminProposal.body));
  const adminSubmittedRequest = memory.requests.get(adminProposal.body.data._id);
  assert.equal(String(adminSubmittedRequest.requestedBy), ids.admin);
  assert.equal(adminSubmittedRequest.requesterRole, "admin");
  assert.deepEqual(
    adminSubmittedRequest.officialLocationSnapshot.coordinates,
    officialCoordinatesBeforeAdminProposal.coordinates,
  );
  assert.equal(adminSubmittedRequest.proposedLatitude, proposedGPS.latitude + 0.00003);
  assert.equal(adminSubmittedRequest.proposedLongitude, proposedGPS.longitude);
  assert.ok(adminSubmittedRequest.submittedAt instanceof Date);

  const unauthorizedRejection = await employeeRequest(
    "POST",
    `/api/v1/atm/location-requests/${adminSubmittedRequest._id}/reject`,
    { reason: "Employee cannot review" },
  );
  assert.equal(unauthorizedRejection.status, 403);
  const selfApproval = await adminRequest(
    "POST",
    `/api/v1/atm/location-requests/${adminSubmittedRequest._id}/approve`,
  );
  assert.equal(selfApproval.status, 403);
  const selfRejection = await adminRequest(
    "POST",
    `/api/v1/atm/location-requests/${adminSubmittedRequest._id}/reject`,
    { reason: "Cannot review my own proposal" },
  );
  assert.equal(selfRejection.status, 403);
  assert.equal(adminSubmittedRequest.status, "PENDING");
  assert.deepEqual(atm.location, officialCoordinatesBeforeAdminProposal);

  const independentApproval = await superAdminRequest(
    "POST",
    `/api/v1/atm/location-requests/${adminSubmittedRequest._id}/approve`,
  );
  assert.equal(independentApproval.status, 200);
  assert.equal(adminSubmittedRequest.status, "APPROVED");
  assert.equal(String(adminSubmittedRequest.reviewedBy), ids.superAdmin);
  assert.equal(independentApproval.body.data.reviewedBy, ids.superAdmin);
  assert.ok(adminSubmittedRequest.reviewedAt instanceof Date);
  assert.equal(independentApproval.body.data.status, "APPROVED");
  assert.equal(independentApproval.body.data.requestedBy, ids.admin);
  assert.equal(independentApproval.body.data.rejectionReason, null);
  assert.deepEqual(
    independentApproval.body.data.officialLocationSnapshot.coordinates,
    officialCoordinatesBeforeAdminProposal.coordinates,
  );
  assert.deepEqual(atm.location, {
    type: "Point",
    coordinates: [
      proposedGPS.longitude,
      proposedGPS.latitude + 0.00003,
    ],
  });

  const startResponse = await employeeRequest(
    "PUT",
    `/api/v1/jobs/${jobId}/start`,
  );
  assert.equal(startResponse.status, 200);
  assert.equal(job.status, "IN_PROGRESS");
  assert.ok(job.startedAt instanceof Date);

  const evidenceFailure = await employeeRequest(
    "PUT",
    `/api/v1/jobs/${jobId}/complete`,
    {
      gps: { ...proposedGPS, accuracy: 381 },
    },
  );
  assert.equal(evidenceFailure.status, 400);
  assert.equal(job.status, "IN_PROGRESS");
  assert.equal(job.completedAt, undefined);

  for (const photoType of ["before", "after"]) {
    const photoIds = Array.from({ length: 3 }, () => objectId());
    job[`${photoType}Photos`] = photoIds;
    for (const photoId of photoIds) {
      memory.photos.set(photoId, {
        _id: photoId,
        jobId,
        photoType,
        isExpired: false,
        url: `https://test.invalid/${photoId}.jpg`,
      });
    }
  }

  const wrongEmployeeCompletion = await otherEmployeeRequest(
    "PUT",
    `/api/v1/jobs/${jobId}/complete`,
    {
      gps: { ...proposedGPS, accuracy: 381 },
    },
  );
  assert.equal(wrongEmployeeCompletion.status, 403);
  assert.equal(job.status, "IN_PROGRESS");
  assert.equal(job.completedAt, undefined);

  const failedProximity = await employeeRequest(
    "PUT",
    `/api/v1/jobs/${jobId}/complete`,
    {
      gps: {
        latitude: proposedGPS.latitude + 0.01,
        longitude: proposedGPS.longitude,
        accuracy: 381,
      },
    },
  );
  assert.equal(failedProximity.status, 403);
  assert.equal(job.status, "IN_PROGRESS");
  assert.equal(job.completedAt, undefined);
  assert.equal(job.gpsValidated, undefined);

  const completionResponse = await employeeRequest(
    "PUT",
    `/api/v1/jobs/${jobId}/complete`,
    { gps: proposedGPS, remarks: "Lifecycle test completed" },
  );
  assert.equal(completionResponse.status, 200);
  assert.equal(job.status, "COMPLETED");
  assert.ok(job.completedAt instanceof Date);
  assert.equal(job.gpsValidated, true);
  assert.equal(job.employeeGpsAtCompletion.accuracy, proposedGPS.accuracy);
  assert.equal(job.employeeRemarks, "Lifecycle test completed");
  assert.equal(
    memory.photos.size,
    6,
    "all required evidence fixture records remain persisted",
  );
  assert.ok(
    memory.jobHistory.some(
      (entry) =>
        sameId(entry.jobId, jobId) && entry.toStatus === "COMPLETED",
    ),
  );
  assert.ok(
    memory.jobHistory.some(
      (entry) =>
        sameId(entry.jobId, jobId) &&
        entry.toStatus === "COMPLETED" &&
        entry.performedAt instanceof Date,
    ),
  );

  await t.test(
    "authenticated location-task routes enforce roles, assignment, review, and correction integrity",
    async () => {
      const secondATMResponse = await adminRequest(
        "POST",
        "/api/v1/atm/createATM",
        {
          bankId: ids.bank,
          customerId: ids.customer,
          districtId: ids.district,
          regionId: null,
          locationName: "Integrated location-task initial ATM",
          address: "Test-only location-task address",
          installationType: "ONSITE",
        },
      );
      assert.equal(secondATMResponse.status, 201);
      const secondATMId = secondATMResponse.body.data._id;
      const conflictATMResponse = await adminRequest(
        "POST",
        "/api/v1/atm/createATM",
        {
          bankId: ids.bank,
          customerId: ids.customer,
          districtId: ids.district,
          regionId: null,
          locationName: "Integrated location-task conflict ATM",
          address: "Test-only conflict address",
          installationType: "ONSITE",
        },
      );
      assert.equal(conflictATMResponse.status, 201);
      const conflictATMId = conflictATMResponse.body.data._id;

      const pendingStandaloneRequest = await adminRequest(
        "POST",
        "/api/v1/atm/location-requests",
        {
          atmId: conflictATMId,
          latitude: proposedGPS.latitude,
          longitude: proposedGPS.longitude,
          inputSource: "MANUAL",
        },
      );
      assert.equal(pendingStandaloneRequest.status, 201);
      const blockedTaskAssignment = await adminRequest(
        "POST",
        "/api/v1/atm/location-tasks/bulk",
        {
          tasks: [
            {
              atmId: conflictATMId,
              employeeId: ids.otherEmployee,
              taskType: "INITIAL_COLLECTION",
            },
          ],
        },
      );
      assert.equal(blockedTaskAssignment.status, 400);
      assert.equal(blockedTaskAssignment.body.errors[0].statusCode, 409);
      assert.equal(
        [...memory.locationTasks.values()].some((task) =>
          sameId(task.atmId, conflictATMId),
        ),
        false,
      );
      assert.equal(
        memory.requests.get(String(pendingStandaloneRequest.body.data._id))
          .status,
        "PENDING",
      );
      assert.equal(
        memory.atms.get(String(conflictATMId)).locationConfigured,
        false,
      );

      const rejectStandaloneRequest = await superAdminRequest(
        "POST",
        `/api/v1/atm/location-requests/${pendingStandaloneRequest.body.data._id}/reject`,
        { reason: "Test-only request rejection" },
      );
      assert.equal(rejectStandaloneRequest.status, 200);
      const assignConflictATM = await adminRequest(
        "POST",
        "/api/v1/atm/location-tasks/bulk",
        {
          tasks: [
            {
              atmId: conflictATMId,
              employeeId: ids.otherEmployee,
              taskType: "INITIAL_COLLECTION",
            },
          ],
        },
      );
      assert.equal(assignConflictATM.status, 201);
      const blockedStandaloneRequest = await adminRequest(
        "POST",
        "/api/v1/atm/location-requests",
        {
          atmId: conflictATMId,
          latitude: proposedGPS.latitude,
          longitude: proposedGPS.longitude,
          inputSource: "MANUAL",
        },
      );
      assert.equal(blockedStandaloneRequest.status, 409);
      assert.equal(
        [...memory.requests.values()].filter(
          (request) =>
            sameId(request.atmId, conflictATMId) &&
            request.status === "PENDING",
        ).length,
        0,
      );
      assert.equal(
        memory.atms.get(String(conflictATMId)).locationConfigured,
        false,
      );

      const raceATMResponse = await adminRequest(
        "POST",
        "/api/v1/atm/createATM",
        {
          bankId: ids.bank,
          customerId: ids.customer,
          districtId: ids.district,
          regionId: null,
          locationName: "Integrated location-task race ATM",
          address: "Test-only race address",
          installationType: "ONSITE",
        },
      );
      assert.equal(raceATMResponse.status, 201);
      const raceATMId = raceATMResponse.body.data._id;
      const competingOperations = await Promise.all([
        adminRequest("POST", "/api/v1/atm/location-requests", {
          atmId: raceATMId,
          latitude: proposedGPS.latitude,
          longitude: proposedGPS.longitude,
          inputSource: "MANUAL",
        }),
        adminRequest("POST", "/api/v1/atm/location-tasks/bulk", {
          tasks: [
            {
              atmId: raceATMId,
              employeeId: ids.otherEmployee,
              taskType: "INITIAL_COLLECTION",
            },
          ],
        }),
      ]);
      assert.equal(
        competingOperations.filter((result) => result.status === 201).length,
        1,
      );
      assert.ok(
        competingOperations.every((result) =>
          [201, 400, 409].includes(result.status),
        ),
      );
      const raceHasPendingRequest = [...memory.requests.values()].some(
        (request) =>
          sameId(request.atmId, raceATMId) && request.status === "PENDING",
      );
      const raceHasActiveTask = [...memory.locationTasks.values()].some(
        (task) => sameId(task.atmId, raceATMId) && task.active,
      );
      assert.equal(raceHasPendingRequest && raceHasActiveTask, false);
      assert.equal(
        memory.atms.get(String(raceATMId)).locationConfigured,
        false,
      );
      if (raceHasPendingRequest) {
        const racedRequest = [...memory.requests.values()].find(
          (request) =>
            sameId(request.atmId, raceATMId) &&
            request.status === "PENDING",
        );
        const rejected = await superAdminRequest(
          "POST",
          `/api/v1/atm/location-requests/${racedRequest._id}/reject`,
          { reason: "Test-only race cleanup" },
        );
        assert.equal(rejected.status, 200);
      }
      if (raceHasActiveTask) {
        const racedTask = [...memory.locationTasks.values()].find(
          (task) => sameId(task.atmId, raceATMId) && task.active,
        );
        const cancelled = await adminRequest(
          "POST",
          `/api/v1/atm/location-tasks/${racedTask._id}/cancel`,
          { reason: "Test-only race cleanup" },
        );
        assert.equal(cancelled.status, 200);
      }

      const bulkBody = {
        tasks: [
          {
            atmId,
            employeeId: ids.employee,
            taskType: "LOCATION_CORRECTION",
          },
          {
            atmId: secondATMId,
            employeeId: ids.otherEmployee,
            taskType: "INITIAL_COLLECTION",
          },
        ],
      };
      const bulkCreate = await adminRequest(
        "POST",
        "/api/v1/atm/location-tasks/bulk",
        bulkBody,
      );
      assert.equal(bulkCreate.status, 201, JSON.stringify(bulkCreate.body));
      assert.equal(bulkCreate.body.data.tasks.length, 2);
      const correctionTask = [...memory.locationTasks.values()].find((task) =>
        sameId(task.atmId, atmId),
      );
      const initialTask = [...memory.locationTasks.values()].find((task) =>
        sameId(task.atmId, secondATMId),
      );
      assert.ok(correctionTask);
      assert.ok(initialTask);
      assert.equal(correctionTask.correctionReason, null);
      assert.equal(correctionTask.status, "ASSIGNED");

      const invalidTaskPayload = await adminRequest(
        "POST",
        "/api/v1/atm/location-tasks/bulk",
        {
          tasks: [
            {
              atmId: "invalid",
              employeeId: ids.employee,
              taskType: "INITIAL_COLLECTION",
            },
          ],
        },
      );
      assert.equal(invalidTaskPayload.status, 400);
      const malformedReason = await adminRequest(
        "POST",
        "/api/v1/atm/location-tasks/bulk",
        {
          tasks: [
            {
              atmId,
              employeeId: ids.employee,
              taskType: "LOCATION_CORRECTION",
              correctionReason: 5,
            },
          ],
        },
      );
      assert.equal(malformedReason.status, 400);
      assert.equal(memory.locationTasks.size, 3);

      for (const deniedRequest of [
        supervisorRequest(
          "POST",
          "/api/v1/atm/location-tasks/bulk",
          bulkBody,
        ),
        customerRequest(
          "POST",
          "/api/v1/atm/location-tasks/bulk",
          bulkBody,
        ),
        employeeRequest(
          "POST",
          "/api/v1/atm/location-tasks/bulk",
          bulkBody,
        ),
        supervisorRequest("GET", "/api/v1/atm/location-tasks"),
        customerRequest("GET", "/api/v1/atm/location-tasks"),
        supervisorRequest(
          "PATCH",
          `/api/v1/atm/location-tasks/${correctionTask._id}/reassign`,
        ),
        customerRequest(
          "PATCH",
          `/api/v1/atm/location-tasks/${correctionTask._id}/reassign`,
        ),
        employeeRequest(
          "PATCH",
          `/api/v1/atm/location-tasks/${correctionTask._id}/reassign`,
        ),
        supervisorRequest(
          "POST",
          `/api/v1/atm/location-tasks/${correctionTask._id}/reopen`,
        ),
        customerRequest(
          "POST",
          `/api/v1/atm/location-tasks/${correctionTask._id}/cancel`,
        ),
      ]) {
        assert.equal((await deniedRequest).status, 403);
      }
      assert.equal(
        (
          await superAdminRequest(
            "GET",
            "/api/v1/atm/location-tasks?status=ASSIGNED",
          )
        ).status,
        200,
      );

      const employeeTaskList = await employeeRequest(
        "GET",
        `/api/v1/atm/location-tasks?assignedEmployeeId=${ids.otherEmployee}`,
      );
      assert.equal(employeeTaskList.status, 200);
      assert.deepEqual(
        employeeTaskList.body.data.tasks.map((task) => String(task._id)),
        [String(correctionTask._id)],
      );

      const wrongStart = await otherEmployeeRequest(
        "POST",
        `/api/v1/atm/location-tasks/${correctionTask._id}/start`,
      );
      assert.equal(wrongStart.status, 409);
      const rightStart = await employeeRequest(
        "POST",
        `/api/v1/atm/location-tasks/${correctionTask._id}/start`,
      );
      assert.equal(rightStart.status, 200);
      assert.equal(correctionTask.status, "IN_PROGRESS");

      const initialWrongStart = await employeeRequest(
        "POST",
        `/api/v1/atm/location-tasks/${initialTask._id}/start`,
      );
      assert.equal(initialWrongStart.status, 409);
      assert.equal(
        (
          await supervisorRequest(
            "POST",
            `/api/v1/atm/location-tasks/${initialTask._id}/start`,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await customerRequest(
            "POST",
            `/api/v1/atm/location-tasks/${initialTask._id}/start`,
          )
        ).status,
        403,
      );
      const initialRightStart = await otherEmployeeRequest(
        "POST",
        `/api/v1/atm/location-tasks/${initialTask._id}/start`,
      );
      assert.equal(initialRightStart.status, 200);

      const reassignment = await adminRequest(
        "PATCH",
        `/api/v1/atm/location-tasks/${correctionTask._id}/reassign`,
        { employeeId: ids.otherEmployee, reason: "Coverage change" },
      );
      assert.equal(reassignment.status, 200);
      assert.equal(
        String(correctionTask.assignedEmployeeId),
        String(ids.otherEmployee),
      );
      assert.equal(correctionTask.assignmentHistory.length, 2);

      const oldAssigneeSubmission = await employeeRequest(
        "POST",
        "/api/v1/atm/location-requests",
        {
          atmId,
          locationTaskId: correctionTask._id,
          latitude: proposedGPS.latitude,
          longitude: proposedGPS.longitude,
          accuracy: 0,
          inputSource: "GPS",
        },
      );
      assert.equal(oldAssigneeSubmission.status, 403);

      const sameAssigneeReassignment = await adminRequest(
        "PATCH",
        `/api/v1/atm/location-tasks/${correctionTask._id}/reassign`,
        { employeeId: ids.otherEmployee, reason: "No change" },
      );
      assert.equal(sameAssigneeReassignment.status, 400);
      assert.equal(correctionTask.assignmentHistory.length, 2);

      const currentAssigneeStart = await otherEmployeeRequest(
        "POST",
        `/api/v1/atm/location-tasks/${correctionTask._id}/start`,
      );
      assert.equal(currentAssigneeStart.status, 200);
      assert.equal(correctionTask.status, "IN_PROGRESS");
      assert.equal(correctionTask.locationRequestId, null);
      assert.equal(String(correctionTask.assignedEmployeeId), String(ids.otherEmployee));

      const invalidTaskGPSRequests = [
        { accuracy: undefined },
        { accuracy: null },
        { accuracy: "5" },
        { accuracy: -1 },
        { accuracy: 50.01 },
      ];
      for (const accuracyInput of invalidTaskGPSRequests) {
        const invalidGPS = await otherEmployeeRequest(
          "POST",
          "/api/v1/atm/location-requests",
          {
            atmId,
            locationTaskId: correctionTask._id,
            latitude: proposedGPS.latitude,
            longitude: proposedGPS.longitude,
            inputSource: "GPS",
            ...accuracyInput,
          },
        );
        assert.equal(invalidGPS.status, 400);
      }
      const genericMissingAccuracy = await otherEmployeeRequest(
        "POST",
        "/api/v1/atm/location-requests",
        {
          atmId,
          latitude: proposedGPS.latitude,
          longitude: proposedGPS.longitude,
          inputSource: "GPS",
        },
      );
      assert.equal(genericMissingAccuracy.status, 400);

      const confirmedBeforeTaskProposal = structuredClone(atm.location);
      const taskProposal = await otherEmployeeRequest(
        "POST",
        "/api/v1/atm/location-requests",
        {
          atmId,
          locationTaskId: correctionTask._id,
          latitude: proposedGPS.latitude + 0.0001,
          longitude: proposedGPS.longitude,
          accuracy: 0,
          inputSource: "GPS",
        },
      );
      assert.equal(taskProposal.status, 201, JSON.stringify(taskProposal.body));
      assert.equal(correctionTask.status, "PENDING_REVIEW");
      assert.equal(
        String(correctionTask.locationRequestId),
        String(taskProposal.body.data._id),
      );
      assert.equal(correctionTask.active, true);
      assert.deepEqual(atm.location, confirmedBeforeTaskProposal);

      const taskApproval = await superAdminRequest(
        "POST",
        `/api/v1/atm/location-requests/${taskProposal.body.data._id}/approve`,
      );
      assert.equal(taskApproval.status, 200);
      assert.equal(correctionTask.status, "COMPLETED");
      assert.equal(correctionTask.active, false);
      assert.ok(correctionTask.completedAt instanceof Date);
      const confirmedAfterApproval = structuredClone(atm.location);

      const rejectedCorrectionCreation = await superAdminRequest(
        "POST",
        "/api/v1/atm/location-tasks/bulk",
        {
          tasks: [
            {
              atmId,
              employeeId: ids.employee,
              taskType: "LOCATION_CORRECTION",
            },
          ],
        },
      );
      assert.equal(rejectedCorrectionCreation.status, 201);
      const rejectedCorrectionTask = [...memory.locationTasks.values()].find(
        (task) =>
          sameId(task.atmId, atmId) &&
          sameId(task._id, rejectedCorrectionCreation.body.data.tasks[0]._id),
      );
      const startRejectedCorrection = await employeeRequest(
        "POST",
        `/api/v1/atm/location-tasks/${rejectedCorrectionTask._id}/start`,
      );
      assert.equal(startRejectedCorrection.status, 200);
      const rejectedCorrectionProposal = await employeeRequest(
        "POST",
        "/api/v1/atm/location-requests",
        {
          atmId,
          locationTaskId: rejectedCorrectionTask._id,
          latitude: proposedGPS.latitude + 0.0002,
          longitude: proposedGPS.longitude,
          inputSource: "MANUAL",
        },
      );
      assert.equal(rejectedCorrectionProposal.status, 201);
      assert.equal(
        rejectedCorrectionProposal.body.data.inputSource,
        "MANUAL",
      );
      assert.equal(rejectedCorrectionProposal.body.data.accuracy, null);
      const rejectCorrection = await adminRequest(
        "POST",
        `/api/v1/atm/location-requests/${rejectedCorrectionProposal.body.data._id}/reject`,
        { reason: "Correction proposal not verified" },
      );
      assert.equal(rejectCorrection.status, 200);
      assert.equal(rejectedCorrectionTask.status, "REJECTED");
      assert.equal(rejectedCorrectionTask.active, true);
      assert.deepEqual(atm.location, confirmedAfterApproval);

      const reopenRejected = await superAdminRequest(
        "POST",
        `/api/v1/atm/location-tasks/${rejectedCorrectionTask._id}/reopen`,
        {
          employeeId: ids.otherEmployee,
          reason: "Rechecking field evidence",
        },
      );
      assert.equal(reopenRejected.status, 200);
      assert.equal(rejectedCorrectionTask.status, "ASSIGNED");
      const cancelReopened = await adminRequest(
        "POST",
        `/api/v1/atm/location-tasks/${rejectedCorrectionTask._id}/cancel`,
        { reason: "Verification no longer needed" },
      );
      assert.equal(cancelReopened.status, 200);
      assert.equal(rejectedCorrectionTask.status, "CANCELLED");
      assert.equal(rejectedCorrectionTask.active, false);

      const superAdminCancel = await superAdminRequest(
        "POST",
        `/api/v1/atm/location-tasks/${initialTask._id}/cancel`,
        { reason: "Test cleanup" },
      );
      assert.equal(superAdminCancel.status, 200);
      assert.equal(initialTask.status, "CANCELLED");
    },
  );

  await t.test("a stale location proposal cannot overwrite a newer canonical location", async () => {
    const reopen = await adminRequest(
      "POST",
      `/api/v1/atm/${atmId}/location-requests/reopen`,
    );
    assert.equal(reopen.status, 200);
    const nextProposal = await employeeRequest(
      "POST",
      "/api/v1/atm/location-requests",
      {
        atmId,
        latitude: proposedGPS.latitude + 0.001,
        longitude: proposedGPS.longitude,
        accuracy: 40,
        inputSource: "GPS",
      },
    );
    assert.equal(nextProposal.status, 201);
    const rejectedRequestId = nextProposal.body.data._id;
    const canonicalLocationBeforeRejection = structuredClone(atm.location);
    const rejectedRequestResponse = await adminRequest(
      "POST",
      `/api/v1/atm/location-requests/${rejectedRequestId}/reject`,
      { reason: "Test-only rejected proposal" },
    );
    assert.equal(rejectedRequestResponse.status, 200);
    assert.equal(
      memory.requests.get(rejectedRequestId).status,
      "REJECTED",
    );
    const rejectedAudit = memory.requests.get(rejectedRequestId);
    assert.equal(String(rejectedAudit.requestedBy), ids.employeeUser);
    assert.equal(String(rejectedAudit.reviewedBy), ids.admin);
    assert.ok(rejectedAudit.submittedAt instanceof Date);
    assert.ok(rejectedAudit.reviewedAt instanceof Date);
    assert.equal(rejectedAudit.rejectionReason, "Test-only rejected proposal");
    assert.deepEqual(
      rejectedAudit.officialLocationSnapshot.coordinates,
      canonicalLocationBeforeRejection.coordinates,
    );
    assert.deepEqual(atm.location, canonicalLocationBeforeRejection);

    assert.equal(atm.locationRequestWindowOpen, true);
    const staleProposal = await employeeRequest(
      "POST",
      "/api/v1/atm/location-requests",
      {
        atmId,
        latitude: proposedGPS.latitude + 0.002,
        longitude: proposedGPS.longitude,
        accuracy: 40,
        inputSource: "GPS",
      },
    );
    assert.equal(staleProposal.status, 201);
    const staleRequestId = staleProposal.body.data._id;
    const previousLocation = structuredClone(atm.location);
    atm.location = {
      type: "Point",
      coordinates: [proposedGPS.longitude + 0.001, proposedGPS.latitude],
    };
    atm.locationCapturedAt = new Date(Date.now() + 1000);
    const staleApproval = await adminRequest(
      "POST",
      `/api/v1/atm/location-requests/${staleRequestId}/approve`,
    );
    assert.equal(staleApproval.status, 409);
    assert.equal(memory.requests.get(staleRequestId).status, "PENDING");
    assert.deepEqual(atm.location, {
      type: "Point",
      coordinates: [proposedGPS.longitude + 0.001, proposedGPS.latitude],
    });
    atm.location = previousLocation;
    atm.locationCapturedAt = locationRequest.reviewedAt;
  });

  await t.test("missing evidence and unconfigured location never complete a job", async () => {
    const createJobResponse = await adminRequest("POST", "/api/v1/jobs", {
      title: "Incomplete lifecycle failure-path test",
      description: "Test-only job for completion guards",
      atmId,
      workType: "inspection",
      priority: "low",
    });
    assert.equal(createJobResponse.status, 201);
    const incompleteJobId = createJobResponse.body.data._id;
    const incompleteJob = memory.jobs.get(incompleteJobId);

    const assign = await adminRequest(
      "PUT",
      `/api/v1/jobs/${incompleteJobId}/assign`,
      { employeeId: ids.employeeUser },
    );
    assert.equal(assign.status, 200);
    const accept = await employeeRequest(
      "PUT",
      `/api/v1/jobs/${incompleteJobId}/accept`,
    );
    assert.equal(accept.status, 200);
    const start = await employeeRequest(
      "PUT",
      `/api/v1/jobs/${incompleteJobId}/start`,
    );
    assert.equal(start.status, 200);

    const gpsAtATM = {
      latitude: proposedGPS.latitude,
      longitude: proposedGPS.longitude,
      accuracy: 381,
    };
    const missingEvidence = await employeeRequest(
      "PUT",
      `/api/v1/jobs/${incompleteJobId}/complete`,
      { gps: gpsAtATM },
    );
    assert.equal(missingEvidence.status, 400);
    assert.match(missingEvidence.body.message, /before photos are required/);
    assert.equal(incompleteJob.status, "IN_PROGRESS");
    assert.equal(incompleteJob.completedAt, undefined);

    for (const photoType of ["before", "after"]) {
      const photoIds = Array.from({ length: 3 }, () => objectId());
      incompleteJob[`${photoType}Photos`] = photoIds;
      for (const photoId of photoIds) {
        memory.photos.set(photoId, {
          _id: photoId,
          jobId: incompleteJobId,
          photoType,
          isExpired: false,
          url: `https://test.invalid/${photoId}.jpg`,
        });
      }
    }

    const canonicalSnapshot = {
      locationConfigured: atm.locationConfigured,
      location: structuredClone(atm.location),
      locationCapturedAt: atm.locationCapturedAt,
      locationCapturedBy: atm.locationCapturedBy,
      locationAccuracy: atm.locationAccuracy,
    };
    atm.locationConfigured = false;
    atm.location = undefined;
    try {
      const unconfiguredLocation = await employeeRequest(
        "PUT",
        `/api/v1/jobs/${incompleteJobId}/complete`,
        { gps: gpsAtATM },
      );
      assert.equal(unconfiguredLocation.status, 400);
      assert.match(unconfiguredLocation.body.message, /location is not configured/i);
      assert.equal(incompleteJob.status, "IN_PROGRESS");
      assert.equal(incompleteJob.completedAt, undefined);
      assert.equal(incompleteJob.gpsValidated, undefined);
    } finally {
      Object.assign(atm, canonicalSnapshot);
    }
  });
});
