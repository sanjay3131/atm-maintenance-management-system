import test from "node:test";
import assert from "node:assert/strict";
import AMC from "../src/modules/amc/amc.model.js";
import AMCPhoto from "../src/modules/amcPhotos/amcPhoto.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import User from "../src/modules/users/user.model.js";
import {
  downloadAMCReport,
  getAllAMC,
  getAMCById,
} from "../src/modules/amc/amc.controller.js";
import { getAMCPhotos } from "../src/modules/amcPhotos/amcPhoto.controller.js";
import { generateAMCPDF } from "../src/modules/reports/amcReport.service.js";
import { getJobPhotos } from "../src/modules/jobPhotos/jobPhotos.controller.js";
import amcRoutes from "../src/modules/amc/amc.routes.js";
import amcPhotoRoutes from "../src/modules/amcPhotos/amcPhoto.routes.js";
import jobRoutes from "../src/modules/jobs/jobs.routes.js";
import jobPhotoRoutes from "../src/modules/jobPhotos/jobPhotos.route.js";
import {
  getSupervisedEmployees,
  getSupervisorEmployeeDetails,
  getSupervisorJobById,
} from "../src/modules/supervisor/supervisor.controller.js";

const supervisorId = "64b000000000000000000001";
const otherSupervisorId = "64b000000000000000000002";
const employeeUserId = "64b000000000000000000003";
const employeeDocumentId = "64b000000000000000000004";
const amcId = "64b000000000000000000005";

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
    return Promise.resolve(value).then(resolve, reject);
  },
});

const findRoute = (router, path, method) =>
  router.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  )?.route;

test("supervisor employee list query is restricted to the authenticated supervisor", async () => {
  const rows = [
    { _id: employeeDocumentId, userId: employeeUserId, supervisorId },
  ];
  let queryFilter;
  const originals = [Employee.find, User.find];
  Employee.find = (filter) => {
    queryFilter = filter;
    return query(rows);
  };
  User.find = () =>
    query([
      {
        _id: employeeUserId,
        firstName: "Taylor",
        lastName: "Employee",
        userType: "employee",
      },
    ]);
  try {
    const result = await invoke(getSupervisedEmployees, {
      user: { _id: supervisorId, userType: "supervisor" },
      validatedQuery: { page: 1, limit: 20 },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(queryFilter, { supervisorId });
    assert.equal(result.body.data.employees.length, 1);
    assert.equal(result.body.data.employees[0].userId, employeeUserId);
  } finally {
    Employee.find = originals[0];
    User.find = originals[1];
  }
});

test("direct AMC reads are denied immediately after reassignment or unassignment", async () => {
  const amc = {
    _id: amcId,
    amcId: "AMC-2026-07",
    atmId: {
      _id: "64b000000000000000000006",
      atmId: "ATM-42",
      locationName: "Central Branch",
      address: "Main Road",
      location: { type: "Point", coordinates: [12, 34] },
      locationConfigured: true,
      locationCapturedBy: "private-user",
      locationCapturedAt: new Date(),
    },
    employeeId: {
      _id: employeeUserId,
      firstName: "Sam",
      lastName: "Employee",
      email: "private@example.com",
      phoneNumber: "555-0100",
    },
    customerId: { customerEmail: "customer@example.com" },
    visitGps: { latitude: 12, longitude: 34 },
    gpsDistance: 5,
    gpsValidated: true,
    status: "PENDING",
    month: 7,
    year: 2026,
    deadlineDate: new Date("2026-07-31T00:00:00Z"),
    visitDate: null,
    completedAt: null,
    generatedAt: new Date("2026-07-01T00:00:00Z"),
    createdAt: new Date("2026-07-01T00:00:00Z"),
    checklist: [{ item: "Cash dispenser", response: "Working", remarks: "" }],
    checklistCompleted: false,
    employeeRemarks: "",
    photoCount: 0,
    status: "PENDING",
    isDeleted: false,
  };
  let currentSupervisor = supervisorId;
  const originalFindById = AMC.findById;
  const originalEmployeeFindOne = Employee.findOne;
  let selectedDetailFields;
  const detailPopulates = [];
  AMC.findById = () => ({
    select(fields) {
      selectedDetailFields = fields;
      return this;
    },
    populate(path, fields) {
      detailPopulates.push([path, fields]);
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(amc).then(resolve, reject);
    },
  });
  Employee.findOne = (filter) =>
    query(
      currentSupervisor === filter.supervisorId &&
        filter.userId === employeeUserId
        ? { userId: employeeUserId }
        : null,
    );
  try {
    const ownResult = await invoke(getAMCById, {
      params: { id: amcId },
      user: { _id: supervisorId, userType: "supervisor" },
    });
    assert.equal(ownResult.status, 200);
    assert.equal(
      selectedDetailFields,
      "amcId atmId employeeId month year status deadlineDate visitDate completedAt generatedAt createdAt checklist checklistCompleted employeeRemarks photoCount isDeleted",
    );
    assert.deepEqual(detailPopulates, [
      ["atmId", "atmId locationName address"],
      ["employeeId", "firstName lastName"],
    ]);
    assert.deepEqual(Object.keys(ownResult.body.data).sort(), [
      "_id",
      "amcId",
      "atmId",
      "checklist",
      "checklistCompleted",
      "completedAt",
      "createdAt",
      "deadlineDate",
      "employeeId",
      "employeeRemarks",
      "generatedAt",
      "month",
      "photoCount",
      "status",
      "year",
      "visitDate",
    ].sort());
    assert.deepEqual(Object.keys(ownResult.body.data.atmId).sort(), [
      "_id",
      "address",
      "atmId",
      "locationName",
    ]);
    assert.deepEqual(Object.keys(ownResult.body.data.employeeId).sort(), [
      "_id",
      "firstName",
      "lastName",
    ]);

    currentSupervisor = otherSupervisorId;
    await assert.rejects(
      invoke(getAMCById, {
        params: { id: amcId },
        user: { _id: supervisorId, userType: "supervisor" },
      }),
      (error) => error.statusCode === 404,
    );

    currentSupervisor = null;
    await assert.rejects(
      invoke(getAMCById, {
        params: { id: amcId },
        user: { _id: supervisorId, userType: "supervisor" },
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    AMC.findById = originalFindById;
    Employee.findOne = originalEmployeeFindOne;
  }
});

test("supervisor AMC list enforces employee scope and returns only monitoring fields", async () => {
  const originals = [
    Employee.find,
    AMC.find,
    AMC.countDocuments,
  ];
  const row = {
    _id: amcId,
    amcId: "AMC-2026-07",
    atmId: {
      _id: "64b000000000000000000006",
      atmId: "ATM-42",
      locationName: "Central Branch",
      address: "Main Road",
      location: { coordinates: [12, 34] },
    },
    employeeId: {
      _id: employeeUserId,
      firstName: "Sam",
      lastName: "Employee",
      email: "private@example.com",
      phoneNumber: "555-0100",
    },
    month: 7,
    year: 2026,
    status: "PENDING",
    deadlineDate: new Date("2026-07-31T00:00:00Z"),
    visitGps: { latitude: 12, longitude: 34 },
    customerId: "private-customer",
  };
  let employeeFilter;
  let amcFilter;
  let selectedFields;
  const populateFields = [];
  let skipValue;
  let limitValue;
  Employee.find = (filter) => {
    employeeFilter = filter;
    return {
      select() {
        return query([{ userId: employeeUserId }]);
      },
    };
  };
  AMC.find = (filter) => {
    amcFilter = filter;
    return {
      select(fields) {
        selectedFields = fields;
        return this;
      },
      populate(path, fields) {
        populateFields.push([path, fields]);
        return this;
      },
      sort() {
        return this;
      },
      skip(value) {
        skipValue = value;
        return this;
      },
      limit(value) {
        limitValue = value;
        return this;
      },
      then(resolve, reject) {
        return Promise.resolve([row]).then(resolve, reject);
      },
    };
  };
  AMC.countDocuments = async () => 3;

  try {
    const result = await invoke(getAllAMC, {
      query: {
        page: "2",
        limit: "1",
        month: "7",
        year: "2026",
        status: "PENDING",
        search: "AMC-2026",
      },
      user: { _id: supervisorId, userType: "supervisor" },
    });
    assert.deepEqual(employeeFilter, { supervisorId });
    assert.deepEqual(amcFilter, {
      isDeleted: false,
      employeeId: { $in: [employeeUserId] },
      month: 7,
      year: 2026,
      status: "PENDING",
      amcId: { $regex: "AMC-2026", $options: "i" },
    });
    assert.equal(
      selectedFields,
      "amcId atmId employeeId month year status deadlineDate visitDate completedAt",
    );
    assert.deepEqual(populateFields, [
      ["atmId", "atmId locationName address"],
      ["employeeId", "firstName lastName"],
    ]);
    assert.equal(skipValue, 1);
    assert.equal(limitValue, 1);
    assert.equal(result.body.data.pagination.total, 3);
    assert.equal(result.body.data.amcs.length, 1);
    assert.deepEqual(Object.keys(result.body.data.amcs[0].employeeId).sort(), [
      "_id",
      "firstName",
      "lastName",
    ]);
    assert.equal("customerId" in result.body.data.amcs[0], false);
    assert.equal("visitGps" in result.body.data.amcs[0], false);
  } finally {
    Employee.find = originals[0];
    AMC.find = originals[1];
    AMC.countDocuments = originals[2];
  }
});

test("direct AMC report reads are revoked after reassignment or unassignment", async () => {
  const amc = {
    _id: amcId,
    employeeId: employeeUserId,
    isDeleted: false,
  };
  let currentSupervisor = supervisorId;
  const originalFindById = AMC.findById;
  const originalEmployeeFindOne = Employee.findOne;
  AMC.findById = async () => amc;
  Employee.findOne = (filter) =>
    query(
      currentSupervisor === filter.supervisorId &&
        filter.userId === employeeUserId
        ? { userId: employeeUserId }
        : null,
    );

  try {
    const reportRoute = findRoute(amcRoutes, "/:id/report", "get");
    assert.ok(reportRoute, "AMC report read route exists");
    assert.doesNotThrow(() =>
      reportRoute.stack[1].handle(
        { user: { userType: "supervisor" } },
        {},
        () => {},
      ),
    );

    currentSupervisor = otherSupervisorId;
    await assert.rejects(
      invoke(downloadAMCReport, {
        params: { id: amcId },
        user: { _id: supervisorId, userType: "supervisor" },
      }),
      (error) => error.statusCode === 404,
    );

    currentSupervisor = null;
    await assert.rejects(
      invoke(downloadAMCReport, {
        params: { id: amcId },
        user: { _id: supervisorId, userType: "supervisor" },
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    AMC.findById = originalFindById;
    Employee.findOne = originalEmployeeFindOne;
  }
});

test("authorized supervisor AMC report is generated with privacy-safe projections", async () => {
  const amc = {
    _id: amcId,
    amcId: "AMC-2026-07",
    atmId: { atmId: "ATM-42", locationName: "Central Branch" },
    employeeId: employeeUserId,
    month: 7,
    year: 2026,
    visitDate: new Date("2026-07-10T10:00:00Z"),
    completedAt: null,
    status: "IN_PROGRESS",
    checklist: [{ item: "Cash dispenser", response: "Working", remarks: "" }],
    gpsDistance: 5,
    visitGps: { latitude: 12, longitude: 34 },
    isDeleted: false,
  };
  const originals = [AMC.findById, AMCPhoto.find, Employee.findOne];
  const selections = [];
  const supervisorPopulates = [];
  const photoSelections = [];
  let currentSupervisor = supervisorId;
  let amcFindCount = 0;
  AMC.findById = () => {
    const queryNumber = ++amcFindCount;
    return {
    select(fields) {
      selections.push(fields);
      return this;
    },
    populate(path, fields) {
      supervisorPopulates.push([path, fields]);
      return this;
    },
    then(resolve, reject) {
      const value =
        queryNumber === 2
          ? {
              ...amc,
              employeeId: {
                _id: employeeUserId,
                firstName: "Sam",
                lastName: "Employee",
              },
            }
          : amc;
      return Promise.resolve(value).then(resolve, reject);
    },
    };
  };
  AMCPhoto.find = () => ({
    select(fields) {
      photoSelections.push(fields);
      return this;
    },
    sort() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve([
        {
          _id: "64b000000000000000000007",
          originalName: "private-photo-name.jpg",
          url: "https://private.example/photo.jpg",
        },
      ]).then(resolve, reject);
    },
  });
  Employee.findOne = (filter) =>
    query(
      currentSupervisor === filter.supervisorId &&
        filter.userId === employeeUserId
        ? { userId: employeeUserId }
        : null,
    );

  const invokeReport = (user) =>
    new Promise((resolve, reject) => {
      const headers = {};
      const res = {
        setHeader(name, value) {
          headers[name] = value;
        },
        send(body) {
          resolve({ headers, body });
        },
      };
      downloadAMCReport(
        { params: { id: amcId }, user },
        res,
        reject,
      );
    });

  try {
    const report = await invokeReport({
      _id: supervisorId,
      userType: "supervisor",
    });
    assert.equal(report.headers["Content-Type"], "application/pdf");
    assert.equal(report.body.subarray(0, 4).toString(), "%PDF");
    assert.deepEqual(selections, [
      "amcId atmId bankId districtId employeeId month year visitDate completedAt status checklist",
    ]);
    assert.deepEqual(supervisorPopulates, [
      ["atmId", "atmId locationName"],
      ["employeeId", "firstName lastName"],
      ["bankId", "bankName"],
      ["districtId", "districtName"],
    ]);
    assert.deepEqual(photoSelections, ["_id"]);

    const adminPopulates = [];
    AMC.findById = () => ({
      populate(path, fields) {
        adminPopulates.push([path, fields]);
        return this;
      },
      then(resolve, reject) {
        return Promise.resolve(amc).then(resolve, reject);
      },
    });
    await generateAMCPDF(amcId);
    assert.deepEqual(adminPopulates, [
      [
        "atmId",
        "atmId locationName bankId address location locationConfigured",
      ],
      ["employeeId", "firstName lastName email phoneNumber"],
      ["bankId", "bankName"],
      ["districtId", "districtName"],
    ]);
    assert.deepEqual(photoSelections, ["_id"]);
  } finally {
    AMC.findById = originals[0];
    AMCPhoto.find = originals[1];
    Employee.findOne = originals[2];
  }
});

test("direct AMC photo reads enforce the employee's current supervisor assignment", async () => {
  const amc = {
    _id: amcId,
    employeeId: employeeUserId,
    isDeleted: false,
  };
  let currentSupervisor = supervisorId;
  const originalAMCFindById = AMC.findById;
  const originalEmployeeFindOne = Employee.findOne;
  const originalPhotoFind = AMCPhoto.find;
  let photoFields;
  AMC.findById = () => query(amc);
  AMCPhoto.find = () => ({
    select(fields) {
      photoFields = fields;
      return this;
    },
    sort() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve([]).then(resolve, reject);
    },
  });
  Employee.findOne = (filter) =>
    query(
      currentSupervisor === filter.supervisorId &&
        filter.userId === employeeUserId
        ? { _id: employeeDocumentId }
        : null,
    );
  try {
    const allowed = await invoke(getAMCPhotos, {
      params: { amcId },
      user: { _id: supervisorId, userType: "supervisor" },
    });
    assert.equal(allowed.status, 200);
    assert.equal(photoFields, "_id url thumbnailUrl uploadedAt");

    currentSupervisor = otherSupervisorId;
    await assert.rejects(
      invoke(getAMCPhotos, {
        params: { amcId },
        user: { _id: supervisorId, userType: "supervisor" },
      }),
      (error) => error.statusCode === 403,
    );

    currentSupervisor = null;
    await assert.rejects(
      invoke(getAMCPhotos, {
        params: { amcId },
        user: { _id: supervisorId, userType: "supervisor" },
      }),
      (error) => error.statusCode === 403,
    );
  } finally {
    AMC.findById = originalAMCFindById;
    Employee.findOne = originalEmployeeFindOne;
    AMCPhoto.find = originalPhotoFind;
  }
});

test("general job reads remain unavailable to supervisors; scoped photo reads are enabled", () => {
  for (const [router, path, method] of [
    [jobRoutes, "/", "get"],
    [jobRoutes, "/:id", "get"],
    [jobRoutes, "/:id/history", "get"],
  ]) {
    const route = findRoute(router, path, method);
    assert.ok(route, `${method.toUpperCase()} ${path} route exists`);
    const authorize = route.stack[1].handle;
    assert.throws(
      () => authorize({ user: { userType: "supervisor" } }, {}, () => {}),
      { statusCode: 403 },
    );
  }

  const photosRoute = findRoute(jobPhotoRoutes, "/job/:jobId", "get");
  assert.ok(photosRoute);
  assert.doesNotThrow(() =>
    photosRoute.stack[1].handle(
      { user: { userType: "supervisor" } },
      {},
      () => {},
    ),
  );
});

test("direct supervisor job photo reads verify the current employee assignment", async () => {
  const originals = [
    Job.findById,
    Employee.findOne,
    User.findOne,
    JobPhoto.find,
  ];
  Job.findById = async () => ({
    _id: "64b000000000000000000006",
    assignedEmployeeId: employeeUserId,
    isDeleted: false,
  });
  Employee.findOne = () => query({ _id: employeeDocumentId });
  User.findOne = () => query({ _id: employeeUserId });
  JobPhoto.find = () => query([]);
  try {
    const allowed = await invoke(getJobPhotos, {
        params: { jobId: "64b000000000000000000006" },
        user: { _id: supervisorId, userType: "supervisor" },
      });
    assert.equal(allowed.status, 200);

    Employee.findOne = () => query(null);
    await assert.rejects(
      invoke(getJobPhotos, {
        params: { jobId: "64b000000000000000000006" },
        user: { _id: supervisorId, userType: "supervisor" },
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    Job.findById = originals[0];
    Employee.findOne = originals[1];
    User.findOne = originals[2];
    JobPhoto.find = originals[3];
  }
});

test("job, AMC, and photo mutations remain unavailable to supervisors", () => {
  const mutatingRoutes = [
    [jobRoutes, "/", "post"],
    [jobRoutes, "/:id/assign", "put"],
    [jobRoutes, "/:id/reassign", "put"],
    [jobRoutes, "/:id/verify", "put"],
    [jobRoutes, "/:id/approve", "put"],
    [jobRoutes, "/:id/close", "put"],
    [jobRoutes, "/:id/cancel", "put"],
    [jobRoutes, "/:id", "put"],
    [jobRoutes, "/:id", "delete"],
    [jobRoutes, "/:id/accept", "put"],
    [jobRoutes, "/:id/start", "put"],
    [jobRoutes, "/:id/complete", "put"],
    [jobRoutes, "/:id/hold", "put"],
    [jobRoutes, "/:id/material-usage", "post"],
    [jobRoutes, "/:id/material-usage/:usageId", "delete"],
    [amcRoutes, "/generate", "post"],
    [amcRoutes, "/:id/start", "put"],
    [amcRoutes, "/:id/save-checklist", "put"],
    [amcRoutes, "/:id/complete", "put"],
    [jobPhotoRoutes, "/upload/:jobId", "post"],
    [jobPhotoRoutes, "/:photoId", "delete"],
    [amcPhotoRoutes, "/upload/:amcId", "post"],
    [amcPhotoRoutes, "/:photoId", "delete"],
  ];

  for (const [router, path, method] of mutatingRoutes) {
    const route = findRoute(router, path, method);
    assert.ok(route, `${method.toUpperCase()} ${path} route exists`);
    const authorize = route.stack[1]?.handle;
    assert.equal(typeof authorize, "function", `${method} ${path} is guarded`);
    assert.throws(
      () => authorize({ user: { userType: "supervisor" } }, {}, () => {}),
      { statusCode: 403 },
      `${method.toUpperCase()} ${path} denies supervisors`,
    );
  }

});

test("employee details and job detail are hidden outside current assignment scope", async () => {
  const originalEmployeeFindOne = Employee.findOne;
  const originalUserFindOne = User.findOne;
  const originalJobFindOne = Job.findOne;
  Employee.findOne = (filter) =>
    query(
      filter.supervisorId === supervisorId
        ? { _id: employeeDocumentId, userId: employeeUserId, assignedAtmIds: [] }
        : null,
    );
  User.findOne = () => query({ _id: employeeUserId, userType: "employee" });
  Job.findOne = () =>
    query({ _id: amcId, assignedEmployeeId: employeeUserId, isDeleted: false });
  try {
    await assert.rejects(
      invoke(getSupervisorEmployeeDetails, {
        params: { employeeId: employeeDocumentId },
        validatedParams: { employeeId: employeeDocumentId },
        user: { _id: otherSupervisorId, userType: "supervisor" },
      }),
      (error) => error.statusCode === 404,
    );

    Employee.findOne = () => query(null);
    await assert.rejects(
      invoke(getSupervisorJobById, {
        params: { jobId: amcId },
        validatedParams: { jobId: amcId },
        user: { _id: otherSupervisorId, userType: "supervisor" },
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    Employee.findOne = originalEmployeeFindOne;
    User.findOne = originalUserFindOne;
    Job.findOne = originalJobFindOne;
  }
});

test("direct job detail access is revoked immediately after reassignment or unassignment", async () => {
  const originals = [
    Employee.findOne,
    User.findOne,
    Job.findOne,
    JobPhoto.find,
  ];
  let currentSupervisor = supervisorId;
  Employee.findOne = (filter) =>
    query(
      currentSupervisor === filter.supervisorId
        ? { _id: employeeDocumentId, userId: employeeUserId }
        : null,
    );
  User.findOne = () =>
    query({
      _id: employeeUserId,
      firstName: "Assigned",
      lastName: "Employee",
      userType: "employee",
    });
  Job.findOne = () =>
    query({
      _id: amcId,
      jobId: "JOB-1",
      assignedEmployeeId: employeeUserId,
      atmId: null,
      isDeleted: false,
      beforePhotos: [],
      afterPhotos: [],
    });
  JobPhoto.find = () => query([]);

  try {
    const own = await invoke(getSupervisorJobById, {
      validatedParams: { jobId: amcId },
      user: { _id: supervisorId, userType: "supervisor" },
    });
    assert.equal(own.status, 200);

    currentSupervisor = otherSupervisorId;
    await assert.rejects(
      invoke(getSupervisorJobById, {
        validatedParams: { jobId: amcId },
        user: { _id: supervisorId, userType: "supervisor" },
      }),
      (error) => error.statusCode === 404,
    );

    currentSupervisor = null;
    await assert.rejects(
      invoke(getSupervisorJobById, {
        validatedParams: { jobId: amcId },
        user: { _id: supervisorId, userType: "supervisor" },
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    Employee.findOne = originals[0];
    User.findOne = originals[1];
    Job.findOne = originals[2];
    JobPhoto.find = originals[3];
  }
});
