import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AMC from "../src/modules/amc/amc.model.js";
import ATM from "../src/modules/atms/atm.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import {
  approveATMlocationRequest,
  listATMlocationRequests,
  rejectATMlocationRequest,
  reopenATMlocationRequests,
  submitATMlocationRequest,
} from "../src/modules/atms/atmLocationRequest.service.js";
import ATMLocationRequest from "../src/modules/atms/atmLocationRequest.model.js";
import {
  rejectATMLocationRequestSchema,
  submitATMLocationRequestSchema,
} from "../src/modules/atms/atm.validation.js";
import { completeJobSchema } from "../src/modules/jobs/jobs.validation.js";
import atmRouter from "../src/modules/atms/atm.routes.js";

const atmId = "64b000000000000000000101";
const employeeRecordId = "64b000000000000000000102";
const employeeUserId = "64b000000000000000000103";
const adminId = "64b000000000000000000104";
const amcId = "64b000000000000000000105";
const requestId = "64b000000000000000000106";

const makeATM = (updates = {}) => ({
  _id: atmId,
  isDeleted: false,
  locationConfigured: false,
  location: undefined,
  locationCapturedAt: null,
  locationCapturedBy: null,
  locationAccuracy: null,
  locationRequestReopenedAt: null,
  locationRequestReopenedBy: null,
  locationRequestWindowOpen: false,
  locationRequestApproved: false,
  locationRequestReopenHistory: [],
  updatedBy: null,
  assignedEmployeeId: [employeeRecordId],
  ...updates,
});

test("employee-owned request history is scoped to the requester and selected ATM", async () => {
  const otherATMId = "64b000000000000000000109";
  await withHarness(
    {
      requests: [
        makeRequest({ requestedBy: employeeUserId }),
        makeRequest({
          _id: "64b000000000000000000110",
          requestedBy: "64b000000000000000000111",
        }),
        makeRequest({
          _id: "64b000000000000000000112",
          atmId: otherATMId,
          requestedBy: employeeUserId,
        }),
      ],
    },
    async () => {
      const result = await listATMlocationRequests({
        page: 1,
        limit: 100,
        atmId,
        requesterId: employeeUserId,
      });
      assert.equal(result.requests.length, 1);
      assert.equal(result.requests[0].requestedBy, employeeUserId);
      assert.equal(result.requests[0].atmId, atmId);
    },
  );
});

const makeRequest = (updates = {}) => ({
  _id: requestId,
  atmId,
  requestType: "INITIAL_CONFIGURATION",
  requestedBy: employeeUserId,
  requesterRole: "employee",
  requesterEmployeeId: employeeRecordId,
  amcId: null,
  proposedLatitude: 12.5,
  proposedLongitude: 77.6,
  accuracy: 8,
  inputSource: "GPS",
  submittedAt: new Date("2026-10-21T08:00:00.000Z"),
  officialLocationSnapshot: {
    locationConfigured: false,
    coordinates: null,
    locationCapturedAt: null,
    locationCapturedBy: null,
  },
  status: "PENDING",
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  ...updates,
});

const makeSession = (state) => ({
  async withTransaction(operation) {
    const atmBefore = { ...state.atm };
    const requestsBefore = new Map(
      [...state.requests].map(([id, request]) => [id, { ...request }]),
    );
    try {
      await operation(this);
    } catch (error) {
      Object.assign(state.atm, atmBefore);
      state.requests.clear();
      for (const [id, request] of requestsBefore) {
        state.requests.set(id, request);
      }
      throw error;
    }
  },
  async endSession() {},
});

async function withHarness(
  { atm = makeATM(), employees, amcs, requests = [], failATMWrite = false } = {},
  callback,
) {
  const state = {
    atm,
    employees:
      employees ??
      [
        {
          _id: employeeRecordId,
          userId: employeeUserId,
          status: "active",
          assignedAtmIds: [atmId],
        },
      ],
    amcs: amcs ?? [],
    requests: new Map(requests.map((request) => [String(request._id), request])),
    failATMWrite,
    nextRequestId: 200,
  };

  const originals = [
    [mongoose, "startSession", mongoose.startSession],
    [ATM, "findOne", ATM.findOne],
    [ATM, "findOneAndUpdate", ATM.findOneAndUpdate],
    [Employee, "findOne", Employee.findOne],
    [AMC, "findOne", AMC.findOne],
    [ATMLocationRequest, "create", ATMLocationRequest.create],
    [ATMLocationRequest, "exists", ATMLocationRequest.exists],
    [ATMLocationRequest, "findOneAndUpdate", ATMLocationRequest.findOneAndUpdate],
    [ATMLocationRequest, "find", ATMLocationRequest.find],
    [ATMLocationRequest, "countDocuments", ATMLocationRequest.countDocuments],
  ];

  mongoose.startSession = async () => makeSession(state);
  ATM.findOne = async ({ _id, isDeleted }) =>
    String(_id) === String(state.atm._id) &&
    (!isDeleted || state.atm.isDeleted === isDeleted)
      ? state.atm
      : null;
  ATM.findOneAndUpdate = async (filter, update) => {
    if (state.failATMWrite) throw new Error("ATM update failed");
    if (String(filter._id) !== String(state.atm._id)) return null;
    if (filter.isDeleted !== false || state.atm.isDeleted) return null;
    if (filter.locationConfigured === true && !state.atm.locationConfigured) {
      return null;
    }
    if (
      filter.locationRequestWindowOpen?.$ne === true &&
      state.atm.locationRequestWindowOpen === true
    ) {
      return null;
    }
    if (
      filter.locationConfigured?.$ne === true &&
      state.atm.locationConfigured === true
    ) {
      return null;
    }
    const hasCoordinatesFilter = Object.prototype.hasOwnProperty.call(
      filter,
      "location.coordinates",
    );
    const expectedCoordinates = filter["location.coordinates"];
    const currentCoordinates = state.atm.location?.coordinates ?? null;
    if (
      hasCoordinatesFilter &&
      JSON.stringify(expectedCoordinates) !== JSON.stringify(currentCoordinates)
    ) {
      return null;
    }
    if (
      Object.prototype.hasOwnProperty.call(filter, "locationCapturedAt") &&
      (filter.locationCapturedAt ?? null)?.getTime?.() !==
      (state.atm.locationCapturedAt ?? null)?.getTime?.()
    ) {
      return null;
    }
    if (
      Object.prototype.hasOwnProperty.call(filter, "locationCapturedBy") &&
      String(filter.locationCapturedBy ?? "") !==
      String(state.atm.locationCapturedBy ?? "")
    ) {
      return null;
    }
    Object.assign(state.atm, update.$set);
    if (update.$push?.locationRequestReopenHistory) {
      state.atm.locationRequestReopenHistory.push(
        update.$push.locationRequestReopenHistory,
      );
    }
    return state.atm;
  };
  Employee.findOne = async (filter) =>
    state.employees.find(
      (employee) =>
        String(employee.userId) === String(filter.userId) &&
        employee.status === filter.status,
    ) ?? null;
  AMC.findOne = async (filter) =>
    state.amcs.find(
      (amc) =>
        String(amc._id) === String(filter._id) &&
        String(amc.atmId) === String(filter.atmId) &&
        String(amc.employeeId) === String(filter.employeeId ?? amc.employeeId) &&
        amc.isDeleted === false &&
        (!filter.status || filter.status.$in.includes(amc.status)),
    ) ?? null;
  ATMLocationRequest.create = async (data) => {
    if (
      [...state.requests.values()].some(
        (request) =>
          String(request.atmId) === String(data.atmId) &&
          request.status === "PENDING",
      )
    ) {
      throw { code: 11000 };
    }
    const request = {
      _id: `64b000000000000000000${String(state.nextRequestId++).padStart(3, "0")}`,
      submittedAt: new Date(),
      ...data,
    };
    state.requests.set(String(request._id), request);
    return request;
  };
  ATMLocationRequest.findOneAndUpdate = async (filter, update) => {
    const request = state.requests.get(String(filter._id));
    if (!request || request.status !== filter.status) return null;
    Object.assign(request, update.$set);
    return request;
  };
  ATMLocationRequest.exists = async ({ atmId: requestATMId, status }) =>
    [...state.requests.values()].some(
      (request) =>
        String(request.atmId) === String(requestATMId) &&
        request.status === status,
    )
      ? { _id: "existing-request" }
      : null;
  ATMLocationRequest.find = (filter) => {
    const matches = [...state.requests.values()].filter(
      (request) =>
        (!filter.status || request.status === filter.status) &&
        (!filter.atmId || String(request.atmId) === String(filter.atmId)) &&
        (!filter.requestedBy ||
          String(request.requestedBy) === String(filter.requestedBy)),
    );
    const query = {
      sort() {
        return this;
      },
      skip() {
        return this;
      },
      limit() {
        return this;
      },
      populate() {
        return this;
      },
      then(resolve, reject) {
        return Promise.resolve(matches).then(resolve, reject);
      },
    };
    return query;
  };
  ATMLocationRequest.countDocuments = async (filter) =>
    [...state.requests.values()].filter(
      (request) =>
        (!filter.status || request.status === filter.status) &&
        (!filter.atmId || String(request.atmId) === String(filter.atmId)) &&
        (!filter.requestedBy ||
          String(request.requestedBy) === String(filter.requestedBy)),
    ).length;

  try {
    await callback(state);
  } finally {
    for (const [target, key, original] of originals) {
      target[key] = original;
    }
  }
}

const employee = { _id: employeeUserId, userType: "employee" };
const admin = { _id: adminId, userType: "admin" };
const proposal = (updates = {}) => ({
  atmId,
  latitude: 12.5,
  longitude: 77.6,
  accuracy: 8,
  inputSource: "GPS",
  ...updates,
});

const runMiddleware = (middleware, userType) =>
  new Promise((resolve, reject) => {
    try {
      middleware(
        { user: { userType } },
        {},
        (error) => resolve(error ?? null),
      );
    } catch (error) {
      reject(error);
    }
  });

test("request schema rejects invalid coordinates and accuracy", () => {
  const valid = proposal();
  assert.equal(submitATMLocationRequestSchema.safeParse(valid).success, true);
  assert.equal(
    submitATMLocationRequestSchema.safeParse({
      ...valid,
      accuracy: 50,
    }).success,
    true,
  );
  for (const invalid of [
    { ...valid, latitude: -90.01 },
    { ...valid, latitude: Number.NaN },
    { ...valid, latitude: Number.POSITIVE_INFINITY },
    { ...valid, longitude: 180.01 },
    { ...valid, longitude: Number.NEGATIVE_INFINITY },
    { ...valid, accuracy: -0.1 },
    { ...valid, accuracy: 50.1 },
    { ...valid, accuracy: 381 },
    { ...valid, accuracy: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(submitATMLocationRequestSchema.safeParse(invalid).success, false);
  }
  assert.equal(
    completeJobSchema.safeParse({
      gps: { latitude: 12.5, longitude: 77.6, accuracy: 381 },
    }).success,
    true,
  );
  assert.equal(
    rejectATMLocationRequestSchema.safeParse({ reason: "   " }).success,
    false,
  );
});

test("valid employee submission stores an unverified proposal without changing official ATM data", async () => {
  await withHarness(
    {
      amcs: [
        {
          _id: amcId,
          atmId,
          employeeId: employeeUserId,
          status: "IN_PROGRESS",
          isDeleted: false,
        },
      ],
    },
    async (state) => {
    const before = {
      location: state.atm.location,
      locationConfigured: state.atm.locationConfigured,
      locationCapturedAt: state.atm.locationCapturedAt,
      locationCapturedBy: state.atm.locationCapturedBy,
      locationAccuracy: state.atm.locationAccuracy,
    };
    const request = await submitATMlocationRequest({
      ...proposal({ amcId }),
      requester: employee,
      },
    );

    assert.equal(request.requestType, "INITIAL_CONFIGURATION");
    assert.equal(request.requesterRole, "employee");
    assert.equal(request.requestedBy, employeeUserId);
    assert.equal(request.proposedLatitude, 12.5);
    assert.equal(request.proposedLongitude, 77.6);
    assert.equal(request.status, "PENDING");
    assert.deepEqual(
      {
        location: state.atm.location,
        locationConfigured: state.atm.locationConfigured,
        locationCapturedAt: state.atm.locationCapturedAt,
        locationCapturedBy: state.atm.locationCapturedBy,
        locationAccuracy: state.atm.locationAccuracy,
      },
      before,
    );
  });
});

test("concurrent submissions produce only one pending request and one conflict", async () => {
  await withHarness({}, async (state) => {
    const results = await Promise.allSettled([
      submitATMlocationRequest({ ...proposal(), requester: employee }),
      submitATMlocationRequest({ ...proposal(), requester: employee }),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const conflict = results.find((result) => result.status === "rejected");
    assert.equal(conflict.reason.statusCode, 409);
    assert.equal(
      [...state.requests.values()].filter(
        (request) => request.status === "PENDING",
      ).length,
      1,
    );
  });
});

test("approved location requests close employee submissions until Admin reopens", async () => {
  const approvedRequest = makeRequest({ status: "APPROVED" });
  await withHarness(
    {
      atm: makeATM({
        locationConfigured: true,
        location: { type: "Point", coordinates: [77.6, 12.5] },
      }),
      requests: [approvedRequest],
    },
    async () => {
      await assert.rejects(
        submitATMlocationRequest({
          ...proposal(),
          requester: employee,
        }),
        { statusCode: 409 },
      );
    },
  );

  await withHarness(
    {
      atm: makeATM({
        locationConfigured: true,
        location: { type: "Point", coordinates: [77.6, 12.5] },
      }),
    },
    async () => {
      await assert.rejects(
        submitATMlocationRequest({
          ...proposal(),
          requester: employee,
        }),
        { statusCode: 409 },
      );
    },
  );

  await withHarness(
    {
      atm: makeATM({
        locationConfigured: true,
        location: { type: "Point", coordinates: [77.6, 12.5] },
        locationRequestWindowOpen: true,
        locationRequestReopenedAt: new Date("2026-10-21T09:00:00.000Z"),
      }),
      requests: [approvedRequest],
    },
    async (state) => {
      const request = await submitATMlocationRequest({
        ...proposal({ inputSource: "MANUAL", accuracy: undefined }),
        requester: employee,
      });
      assert.equal(request.status, "PENDING");
      assert.equal(state.requests.size, 2);
    },
  );
});

test("Admin reopen is authenticated, requires approved history, and records an auditable open event", async () => {
  await withHarness(
    {
      atm: makeATM({
        locationConfigured: true,
        location: { type: "Point", coordinates: [77.6, 12.5] },
      }),
      requests: [makeRequest({ status: "APPROVED" })],
    },
    async (state) => {
      const originalCoordinates = [...state.atm.location.coordinates];
      const reopened = await reopenATMlocationRequests({
        atmId,
        reviewerId: adminId,
      });
      assert.equal(reopened.locationRequestWindowOpen, true);
      assert.deepEqual(state.atm.location.coordinates, originalCoordinates);
      assert.equal(reopened.locationRequestReopenedBy, adminId);
      assert.equal(state.atm.locationRequestReopenHistory.length, 1);
      assert.equal(
        state.atm.locationRequestReopenHistory[0].openedBy,
        adminId,
      );
      await assert.rejects(
        reopenATMlocationRequests({ atmId, reviewerId: adminId }),
        { statusCode: 409 },
      );
    },
  );

  await withHarness({}, async () => {
    await assert.rejects(
      reopenATMlocationRequests({ atmId, reviewerId: adminId }),
      { statusCode: 409 },
    );
  });
});

test("employee submission requires current ATM assignment or a matching assigned AMC", async () => {
  await withHarness(
    { atm: makeATM({ assignedEmployeeId: [] }) },
    async () => {
      await assert.rejects(
        submitATMlocationRequest({ ...proposal(), requester: employee }),
        { statusCode: 403, message: "You are not assigned to this ATM" },
      );
    },
  );

  await withHarness(
    {
      atm: makeATM({ assignedEmployeeId: [] }),
      amcs: [
        {
          _id: amcId,
          atmId,
          employeeId: employeeUserId,
          status: "IN_PROGRESS",
          isDeleted: false,
        },
      ],
    },
    async () => {
      const request = await submitATMlocationRequest({
        ...proposal({ amcId }),
        requester: employee,
      });
      assert.equal(request.amcId, amcId);
    },
  );

  await withHarness(
    {
      amcs: [
        {
          _id: amcId,
          atmId: "64b000000000000000000199",
          employeeId: employeeUserId,
          status: "IN_PROGRESS",
          isDeleted: false,
        },
      ],
    },
    async () => {
      await assert.rejects(
        submitATMlocationRequest({
          ...proposal({ amcId }),
          requester: employee,
        }),
        { statusCode: 403 },
      );
    },
  );
});

test("admins may request initial configuration and changes to configured locations", async () => {
  await withHarness({}, async () => {
    const request = await submitATMlocationRequest({
      ...proposal({ accuracy: undefined }),
      requester: admin,
    });
    assert.equal(request.requesterRole, "admin");
    assert.equal(request.requestType, "INITIAL_CONFIGURATION");
    assert.equal(request.accuracy, null);
  });

  await withHarness(
    {
      atm: makeATM({
        locationConfigured: true,
        location: { type: "Point", coordinates: [77.1, 12.1] },
        locationCapturedAt: new Date("2026-10-18T08:00:00.000Z"),
        locationCapturedBy: "64b000000000000000000108",
      }),
    },
    async (state) => {
      const request = await submitATMlocationRequest({
        ...proposal({ inputSource: "MANUAL", accuracy: undefined }),
        requester: admin,
      });
      assert.equal(request.requestType, "LOCATION_CHANGE");
      assert.deepEqual(request.officialLocationSnapshot, {
        locationConfigured: true,
        coordinates: [77.1, 12.1],
        locationCapturedAt: new Date("2026-10-18T08:00:00.000Z"),
        locationCapturedBy: "64b000000000000000000108",
      });
      const approved = await approveATMlocationRequest({
        requestId: request._id,
        reviewerId: adminId,
      });
      assert.equal(approved.requestedBy, adminId);
      assert.equal(approved.reviewedBy, adminId);
      assert.equal(state.atm.locationConfigured, true);
    },
  );
});

test("review endpoints are limited to Admin and SuperAdmin, except employee-owned list", async () => {
  const reviewRoutes = atmRouter.stack.filter((layer) =>
    [
      "/location-requests/:requestId",
      "/location-requests/:requestId/approve",
      "/location-requests/:requestId/reject",
      "/:id/location-requests/reopen",
    ].includes(layer.route?.path),
  );
  assert.equal(reviewRoutes.length, 4);
  for (const layer of reviewRoutes) {
    const roleGuard = layer.route.stack[1].handle;
    for (const role of ["supervisor", "employee", "customer"]) {
      await assert.rejects(runMiddleware(roleGuard, role), {
        statusCode: 403,
      });
    }
    assert.equal(await runMiddleware(roleGuard, "admin"), null);
    assert.equal(await runMiddleware(roleGuard, "superAdmin"), null);
  }

  const employeeListRoute = atmRouter.stack.find(
    (layer) =>
      layer.route?.path === "/location-requests" &&
      layer.route.methods.get,
  );
  const listRoleGuard = employeeListRoute.route.stack[1].handle;
  assert.equal(await runMiddleware(listRoleGuard, "employee"), null);
  for (const role of ["supervisor", "customer"]) {
    await assert.rejects(runMiddleware(listRoleGuard, role), {
      statusCode: 403,
    });
  }
});

test("submission route derives requester identity from the authenticated user", async () => {
  const submitRoute = atmRouter.stack.find(
    (layer) =>
      layer.route?.path === "/location-requests" &&
      layer.route.methods.post,
  );
  const roleGuard = submitRoute.route.stack[1].handle;
  assert.equal(await runMiddleware(roleGuard, "employee"), null);
  assert.equal(await runMiddleware(roleGuard, "admin"), null);
  assert.equal(await runMiddleware(roleGuard, "superAdmin"), null);
  await assert.rejects(runMiddleware(roleGuard, "supervisor"), {
    statusCode: 403,
  });
  await assert.rejects(runMiddleware(roleGuard, "customer"), {
    statusCode: 403,
  });

  const { submitATMLocationRequest: submitHandler } = await import(
    "../src/modules/atms/atm.controller.js"
  );
  await withHarness({}, async (state) => {
    const result = await new Promise((resolve, reject) => {
      submitHandler(
        {
          body: {
            ...proposal(),
            requestedBy: adminId,
            requesterRole: "superAdmin",
          },
          user: employee,
        },
        {
          status() {
            return this;
          },
          json(response) {
            resolve(response);
          },
        },
        reject,
      );
    });
    assert.equal(result.data.requestedBy, employeeUserId);
    assert.equal(result.data.requesterRole, "employee");
    assert.equal(state.requests.size, 1);
  });
});

test("approval atomically applies GeoJSON coordinates and official audit metadata", async () => {
  await withHarness(
    { requests: [makeRequest()] },
    async (state) => {
      const reviewedAtBefore = Date.now();
      const result = await approveATMlocationRequest({
        requestId,
        reviewerId: adminId,
      });
      assert.equal(result.status, "APPROVED");
      assert.equal(result.reviewedBy, adminId);
      assert.ok(result.reviewedAt.getTime() >= reviewedAtBefore);
      assert.deepEqual(state.atm.location, {
        type: "Point",
        coordinates: [77.6, 12.5],
      });
      assert.equal(state.atm.locationConfigured, true);
      assert.equal(state.atm.locationCapturedBy, adminId);
      assert.equal(state.atm.locationAccuracy, 8);
      assert.equal(state.atm.locationCapturedAt, result.reviewedAt);
      assert.equal(state.atm.locationRequestWindowOpen, false);
      assert.equal(state.atm.locationRequestApproved, true);
    },
  );
});

test("rejection requires a reason and allows a later request", async () => {
  assert.equal(
    rejectATMLocationRequestSchema.safeParse({ reason: "   " }).success,
    false,
  );
  await withHarness(
    { requests: [makeRequest()] },
    async (state) => {
      const rejected = await rejectATMlocationRequest({
        requestId,
        reviewerId: adminId,
        reason: " Coordinates need rechecking ",
      });
      assert.equal(rejected.status, "REJECTED");
      assert.equal(rejected.rejectionReason, "Coordinates need rechecking");
      await submitATMlocationRequest({
        ...proposal(),
        requester: employee,
      });
      assert.equal(
        [...state.requests.values()].filter(
          (request) => request.status === "PENDING",
        ).length,
        1,
      );
      assert.equal(state.requests.get(requestId).status, "REJECTED");
    },
  );
});

test("Admin rejection controller accepts the validated reason and returns the rejected request", async () => {
  const { rejectATMLocationRequest: rejectHandler } = await import(
    "../src/modules/atms/atm.controller.js"
  );
  await withHarness(
    { requests: [makeRequest()] },
    async (state) => {
      const response = await new Promise((resolve, reject) => {
        rejectHandler(
          {
            validatedParams: { requestId },
            body: { reason: " Corrected location required " },
            user: admin,
          },
          {
            status() {
              return this;
            },
            json(body) {
              resolve(body);
            },
          },
          reject,
        );
      });
      assert.equal(response.data.status, "REJECTED");
      assert.equal(response.data.rejectionReason, "Corrected location required");
      assert.equal(state.requests.get(requestId).status, "REJECTED");
    },
  );
});

test("partial unique index and duplicate-key handling protect pending requests", async () => {
  const uniquePendingIndex = ATMLocationRequest.schema
    .indexes()
    .find(
      ([keys, options]) =>
        keys.atmId === 1 &&
        options.unique === true &&
        options.partialFilterExpression?.status === "PENDING",
    );
  assert.ok(uniquePendingIndex);

  await withHarness({}, async () => {
    await submitATMlocationRequest({ ...proposal(), requester: employee });
    await assert.rejects(
      submitATMlocationRequest({ ...proposal(), requester: admin }),
      {
        statusCode: 409,
        message: "A pending location request already exists for this ATM",
      },
    );
  });
});

test("concurrent decisions permit only one pending-request transition", async () => {
  await withHarness(
    { requests: [makeRequest()] },
    async (state) => {
      const decisions = await Promise.allSettled([
        approveATMlocationRequest({ requestId, reviewerId: adminId }),
        rejectATMlocationRequest({
          requestId,
          reviewerId: "64b000000000000000000107",
          reason: "Rejected",
        }),
      ]);
      assert.equal(
        decisions.filter((decision) => decision.status === "fulfilled").length,
        1,
      );
      assert.equal(
        decisions.filter((decision) => decision.status === "rejected").length,
        1,
      );
      const decision = state.requests.get(requestId).status;
      assert.ok(["APPROVED", "REJECTED"].includes(decision));
      assert.equal(state.atm.locationConfigured, decision === "APPROVED");
    },
  );
});

test("stale approval and failed ATM writes do not commit the request decision", async (t) => {
  await t.test("rejects a changed official location and leaves request pending", async () => {
    await withHarness(
      {
        atm: makeATM({
          locationConfigured: true,
          location: { type: "Point", coordinates: [77, 12] },
        }),
        requests: [makeRequest()],
      },
      async (state) => {
        await assert.rejects(
          approveATMlocationRequest({ requestId, reviewerId: adminId }),
          { statusCode: 409 },
        );
        assert.equal(state.requests.get(requestId).status, "PENDING");
        assert.deepEqual(state.atm.location.coordinates, [77, 12]);
      },
    );
  });

  await t.test("rolls back request decision when ATM update throws", async () => {
    await withHarness(
      { requests: [makeRequest()], failATMWrite: true },
      async (state) => {
        await assert.rejects(
          approveATMlocationRequest({ requestId, reviewerId: adminId }),
          /ATM update failed/,
        );
        assert.equal(state.requests.get(requestId).status, "PENDING");
        assert.equal(state.atm.locationConfigured, false);
      },
    );
  });

  await t.test("detects a newer capture even when coordinates are unchanged", async () => {
    const previousCapture = new Date("2026-10-18T08:00:00.000Z");
    await withHarness(
      {
        atm: makeATM({
          locationConfigured: true,
          location: { type: "Point", coordinates: [77.6, 12.5] },
          locationCapturedAt: new Date("2026-10-20T08:00:00.000Z"),
          locationCapturedBy: adminId,
        }),
        requests: [
          makeRequest({
            requestType: "LOCATION_CHANGE",
            officialLocationSnapshot: {
              locationConfigured: true,
              coordinates: [77.6, 12.5],
              locationCapturedAt: previousCapture,
              locationCapturedBy: "64b000000000000000000108",
            },
          }),
        ],
      },
      async (state) => {
        await assert.rejects(
          approveATMlocationRequest({ requestId, reviewerId: adminId }),
          { statusCode: 409 },
        );
        assert.equal(state.requests.get(requestId).status, "PENDING");
        assert.equal(state.atm.locationCapturedAt.getTime(), new Date("2026-10-20T08:00:00.000Z").getTime());
      },
    );
  });
});

test("generic Admin ATM creation and update cannot write coordinates directly", async () => {
  const { createATM, updateATM } = await import(
    "../src/modules/atms/atm.controller.js"
  );
  const invoke = (handler, req) =>
    new Promise((resolve, reject) => {
      handler(
        req,
        {},
        (error) => (error ? reject(error) : resolve()),
      );
    });

    test("legacy employee set-location endpoint cannot write official coordinates", async () => {
      const { setATMLocation } = await import(
        "../src/modules/atms/atm.controller.js"
      );
      const result = await new Promise((resolve) => {
        setATMLocation(
          {
            params: { id: atmId },
            body: { latitude: 12.5, longitude: 77.6, accuracy: 5 },
            user: { _id: employeeUserId, userType: "employee" },
          },
          {},
          (error) => resolve(error),
        );
      });

      assert.equal(result.statusCode, 410);
      assert.match(result.message, /location request/i);
      assert.doesNotMatch(result.message, /coordinates configured successfully/i);
    });

  await assert.rejects(
    invoke(createATM, { body: { location: { type: "Point", coordinates: [1, 2] } } }),
    { statusCode: 400 },
  );
  await assert.rejects(
    invoke(updateATM, { body: { location: { type: "Point", coordinates: [1, 2] } } }),
    { statusCode: 400 },
  );
});
