import test from "node:test";
import assert from "node:assert/strict";
import PDFDocument from "pdfkit";
import ATM from "../src/modules/atms/atm.model.js";
import AMC from "../src/modules/amc/amc.model.js";
import AMCPhoto from "../src/modules/amcPhotos/amcPhoto.model.js";
import Customer from "../src/modules/customers/customer.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import JobHistory from "../src/modules/jobs/jobHistory.model.js";
import {
  getCustomerJobDetail,
  getCustomerById,
  getCustomerJobPhotos,
  getCustomerJobs,
} from "../src/modules/customers/customer.controller.js";
import { getJobPhotos } from "../src/modules/jobPhotos/jobPhotos.controller.js";
import {
  createJob,
  getAllJobs,
  getJobById,
  getJobHistory,
} from "../src/modules/jobs/jobs.controller.js";
import {
  downloadAMCReport,
  getAMCById,
} from "../src/modules/amc/amc.controller.js";
import { getAMCPhotos } from "../src/modules/amcPhotos/amcPhoto.controller.js";

const customerAId = "64b000000000000000000001";
const customerBId = "64b000000000000000000002";
const userAId = "64b000000000000000000011";
const userBId = "64b000000000000000000012";
const atmId = "64b000000000000000000021";
const jobAId = "64b000000000000000000031";
const jobBId = "64b000000000000000000032";
const amcAId = "64b000000000000000000041";
const amcBId = "64b000000000000000000042";

const customerA = {
  _id: customerAId,
  userId: userAId,
  isActive: true,
  isDeleted: false,
  atmIds: [atmId],
};
const customerB = {
  _id: customerBId,
  userId: userBId,
  isActive: true,
  isDeleted: false,
  atmIds: [atmId],
};

function query(value) {
  return {
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
    select() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

async function withOverrides(overrides, callback) {
  const originals = overrides.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    return await callback();
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

function invoke(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
        return this;
      },
      setHeader(name, value) {
        this.headers[name] = value;
      },
      send(body) {
        resolve({ status: this.statusCode ?? 200, headers: this.headers, body });
        return this;
      },
    };
    handler(req, res, reject);
  });
}

function customerRequest(userId, queryParams = {}) {
  return {
    user: { _id: userId, userType: "customer", status: "active" },
    query: queryParams,
    params: {},
  };
}

function customerProfileLookup() {
  return async (filter) =>
    [customerA, customerB].find(
      (customer) =>
        String(customer.userId) === String(filter.userId) &&
        (!filter.isActive || customer.isActive) &&
        customer.isDeleted === filter.isDeleted,
    ) ?? null;
}

function amcRecord(id, ownerId, status = "COMPLETED") {
  return {
    _id: id,
    amcId: `AMC-${id.slice(-3)}`,
    atmId: {
      _id: atmId,
      atmId: "ATM-21",
      locationName: "Branch",
      customer: customerBId,
    },
    customerId: { _id: ownerId },
    employeeId: {
      _id: "64b000000000000000000051",
      firstName: "Private",
      lastName: "Employee",
      email: "employee@example.test",
      phoneNumber: "555-5555",
    },
    status,
    checklist: [{ item: "door", response: "Good" }],
    gpsDistance: 4,
    isDeleted: false,
  };
}

function jobRecord(id, ownerId, status = "APPROVED") {
  const record = {
    _id: id,
    jobId: `JOB-${id.slice(-3)}`,
    title: "ATM repair",
    description: "Replace the card reader",
    atmId: {
      _id: atmId,
      atmId: "ATM-21",
      locationName: "Branch",
      customer: customerBId,
    },
    customerId: ownerId,
    status,
    isDeleted: false,
    workType: "repair",
    priority: "medium",
    employeeRemarks: "Internal employee remark",
    cancellationReason: "Internal reason",
    gpsDistance: 3,
    assignedEmployeeId: { firstName: "Private", phoneNumber: "555-5555" },
    createdBy: { firstName: "Private" },
  };
  Object.defineProperty(record, "toObject", {
    value: () => ({ ...record }),
  });
  return record;
}

test("customer identity comes from the authenticated user, never a supplied customer ID", async () => {
  const originalFindOne = Customer.findOne;
  const originalJobFind = Job.find;
  const originalCount = Job.countDocuments;
  const seen = [];
  let capturedFilter;
  Customer.findOne = async (filter) => {
    seen.push(filter);
    return String(filter.userId) === userBId ? customerB : null;
  };
  Job.find = (filter) => {
    capturedFilter = filter;
    return query([]);
  };
  Job.countDocuments = async () => 0;

  try {
    const result = await invoke(
      getCustomerJobs,
      customerRequest(userBId, { customerId: customerAId }),
    );
    assert.equal(result.status, 200);
    assert.equal(String(capturedFilter.customerId), customerBId);
    assert.deepEqual(seen, [
      { userId: userBId, isDeleted: false, isActive: true },
    ]);
  } finally {
    Customer.findOne = originalFindOne;
    Job.find = originalJobFind;
    Job.countDocuments = originalCount;
  }
});

test("missing, deleted, and inactive customer profiles fail closed", async () => {
  const originalFindOne = Customer.findOne;
  const lookups = [];
  Customer.findOne = async (filter) => {
    lookups.push(filter);
    return null;
  };

  try {
    for (const userId of [userAId, userBId, "64b000000000000000000013"]) {
      await assert.rejects(
        invoke(getCustomerJobs, customerRequest(userId)),
        (error) => error.statusCode === 404,
      );
    }
    assert.equal(lookups.length, 3);
    assert.ok(
      lookups.every(
        (filter) =>
          filter.isActive === true &&
          filter.isDeleted === false &&
          !Object.hasOwn(filter, "customerId"),
      ),
    );
    for (const status of ["inactive", "blocked"]) {
      await assert.rejects(
        invoke(getCustomerJobs, {
          ...customerRequest(userAId),
          user: {
            _id: userAId,
            userType: "customer",
            status,
          },
        }),
        (error) => error.statusCode === 404,
      );
    }
    assert.equal(lookups.length, 3);
  } finally {
    Customer.findOne = originalFindOne;
  }
});

test("customer job filters cannot override historical customer scope or visible statuses", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalJobFind = Job.find;
  const originalCount = Job.countDocuments;
  let capturedFilter;
  Customer.findOne = customerProfileLookup();
  Job.find = (filter) => {
    capturedFilter = filter;
    return query([jobRecord(jobAId, customerAId)]);
  };
  Job.countDocuments = async () => 1;

  try {
    const result = await invoke(
      getCustomerJobs,
      customerRequest(userAId, {
        customerId: customerBId,
        atmId,
        status: "APPROVED",
      }),
    );
    assert.equal(result.status, 200);
    assert.equal(String(capturedFilter.customerId), customerAId);
    assert.equal(String(capturedFilter.atmId), atmId);
    assert.equal(capturedFilter.status, "APPROVED");
    assert.equal(result.body.data.jobs[0].employeeRemarks, undefined);

    await assert.rejects(
      invoke(
        getCustomerJobs,
        customerRequest(userAId, { status: "PENDING" }),
      ),
      (error) => error.statusCode === 400,
    );
  } finally {
    Customer.findOne = originalCustomerFindOne;
    Job.find = originalJobFind;
    Job.countDocuments = originalCount;
  }
});

test("customer job list accepts own approved job snapshot after ATM reassignment", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalJobFind = Job.find;
  const originalCount = Job.countDocuments;
  let capturedFilter;
  Customer.findOne = customerProfileLookup();
  Job.find = (filter) => {
    capturedFilter = filter;
    return query([jobRecord(jobAId, customerAId)]);
  };
  Job.countDocuments = async () => 1;

  try {
    const result = await invoke(getCustomerJobs, customerRequest(userAId));
    assert.equal(result.status, 200);
    assert.equal(String(capturedFilter.customerId), customerAId);
    assert.deepEqual(capturedFilter.status.$in, [
      "VERIFIED",
      "APPROVED",
      "CLOSED",
    ]);
    assert.equal(result.body.data.jobs[0].jobId, `JOB-${jobAId.slice(-3)}`);
    assert.equal(result.body.data.jobs[0].cancellationReason, undefined);
  } finally {
    Customer.findOne = originalCustomerFindOne;
    Job.find = originalJobFind;
    Job.countDocuments = originalCount;
  }
});

test("customer job detail uses the historical owner snapshot and denies missing or foreign snapshots", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalJobFindOne = Job.findOne;
  let capturedFilter;
  Customer.findOne = customerProfileLookup();
  Job.findOne = (filter) => {
    capturedFilter = filter;
    const record =
      filter._id === jobAId && filter.customerId === customerAId
        ? jobRecord(jobAId, customerAId)
        : filter._id === jobBId && filter.customerId === customerBId
          ? jobRecord(jobBId, customerBId)
          : null;
    return query(record);
  };

  try {
    const own = await invoke(getCustomerJobDetail, {
      ...customerRequest(userAId),
      params: { jobId: jobAId },
    });
    assert.equal(own.status, 200);
    assert.equal(String(capturedFilter.customerId), customerAId);
    assert.equal(own.body.data.employeeRemarks, undefined);
    assert.equal(own.body.data.assignedEmployeeId, undefined);

    await assert.rejects(
      invoke(getCustomerJobDetail, {
        ...customerRequest(userBId),
        params: { jobId: jobAId },
      }),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      invoke(getCustomerJobDetail, {
        ...customerRequest(userAId),
        params: { jobId: jobBId },
      }),
      (error) => error.statusCode === 404,
    );
    const newOwner = await invoke(getCustomerJobDetail, {
      ...customerRequest(userBId),
      params: { jobId: jobBId },
    });
    assert.equal(newOwner.status, 200);
    assert.equal(newOwner.body.data.jobId, `JOB-${jobBId.slice(-3)}`);
  } finally {
    Customer.findOne = originalCustomerFindOne;
    Job.findOne = originalJobFindOne;
  }
});

test("general job list cannot widen customer status or ownership with query IDs", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalJobFind = Job.find;
  const originalCount = Job.countDocuments;
  const originalAtmDistinct = ATM.distinct;
  const originalAggregate = Job.aggregate;
  let capturedFilter;
  let aggregateCalled = false;
  Customer.findOne = customerProfileLookup();
  ATM.distinct = async () => [atmId];
  Job.aggregate = async () => {
    aggregateCalled = true;
    return [];
  };
  Job.find = (filter) => {
    capturedFilter = filter;
    return query([jobRecord(jobAId, customerAId)]);
  };
  Job.countDocuments = async () => 1;

  try {
    const result = await invoke(
      getAllJobs,
      customerRequest(userAId, {
        customerId: customerBId,
        status: "APPROVED",
        districtId: "64b000000000000000000022",
      }),
    );
    assert.equal(result.status, 200);
    assert.equal(String(capturedFilter.customerId), customerAId);
    assert.equal(capturedFilter.status, "APPROVED");
    assert.deepEqual(capturedFilter.atmId, { $in: [atmId] });
    assert.equal(result.body.data.jobs[0].employeeRemarks, undefined);
    assert.equal(aggregateCalled, false);

    await assert.rejects(
      invoke(
        getAllJobs,
        customerRequest(userAId, { status: "PENDING" }),
      ),
      (error) => error.statusCode === 400,
    );
  } finally {
    Customer.findOne = originalCustomerFindOne;
    Job.find = originalJobFind;
    Job.countDocuments = originalCount;
    ATM.distinct = originalAtmDistinct;
    Job.aggregate = originalAggregate;
  }
});

test("admin and employee job lists retain their existing scopes", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalJobFind = Job.find;
  const originalCount = Job.countDocuments;
  const filters = [];
  Customer.findOne = async () => null;
  Job.find = (filter) => {
    filters.push(filter);
    return query([]);
  };
  Job.countDocuments = async () => 0;

  try {
    await invoke(getAllJobs, {
      user: { _id: userAId, userType: "admin" },
      query: { customerId: customerBId, status: "PENDING" },
    });
    await invoke(getAllJobs, {
      user: { _id: userAId, userType: "employee" },
      query: { status: "IN_PROGRESS" },
    });
    assert.deepEqual(filters[0], {
      isDeleted: false,
      status: "PENDING",
      customerId: customerBId,
    });
    assert.deepEqual(filters[1], {
      isDeleted: false,
      assignedEmployeeId: userAId,
      status: "IN_PROGRESS",
    });
  } finally {
    Customer.findOne = originalCustomerFindOne;
    Job.find = originalJobFind;
    Job.countDocuments = originalCount;
  }
});

test("admin and assigned employees retain full job-detail access", async () => {
  const originalFindById = Job.findById;
  const originalEmployeeFind = Employee.find;
  const employeeJob = jobRecord(jobAId, customerAId);
  employeeJob.assignedEmployeeId = {
    _id: userAId,
    firstName: "Assigned",
    lastName: "Employee",
  };
  Job.findById = () => query(employeeJob);
  Employee.find = () => ({
    select() {
      return {
        lean: async () => [],
      };
    },
  });

  try {
    const admin = await invoke(getJobById, {
      user: { _id: userBId, userType: "admin", status: "active" },
      params: { id: jobAId },
    });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.data.employeeRemarks, "Internal employee remark");

    const employee = await invoke(getJobById, {
      user: { _id: userAId, userType: "employee", status: "active" },
      params: { id: jobAId },
    });
    assert.equal(employee.status, 200);
    assert.equal(employee.body.data.employeeRemarks, "Internal employee remark");
  } finally {
    Job.findById = originalFindById;
    Employee.find = originalEmployeeFind;
  }
});

test("new job ownership snapshots derive from the ATM and reject a forged customer ID", async () => {
  const originalAtmFindById = ATM.findById;
  const originalJobCount = Job.countDocuments;
  const originalJobCreate = Job.create;
  const originalJobFindById = Job.findById;
  const originalHistoryCreate = JobHistory.create;
  let createdJob;
  ATM.findById = async () => ({
    _id: atmId,
    customer: customerBId,
    isDeleted: false,
  });
  Job.countDocuments = async () => 0;
  Job.create = async (data) => {
    createdJob = data;
    return { _id: jobBId };
  };
  Job.findById = () => query(jobRecord(jobBId, customerBId, "PENDING"));
  JobHistory.create = async () => {};

  try {
    await assert.rejects(
      invoke(createJob, {
        user: { _id: userAId, userType: "admin", status: "active" },
        body: {
          title: "ATM repair",
          atmId,
          customerId: customerAId,
        },
      }),
      (error) => error.statusCode === 400,
    );
    assert.equal(createdJob, undefined);

    const result = await invoke(createJob, {
      user: { _id: userAId, userType: "admin", status: "active" },
      body: { title: "ATM repair", atmId },
      headers: {},
    });
    assert.equal(result.status, 201);
    assert.equal(String(createdJob.customerId), customerBId);
  } finally {
    ATM.findById = originalAtmFindById;
    Job.countDocuments = originalJobCount;
    Job.create = originalJobCreate;
    Job.findById = originalJobFindById;
    JobHistory.create = originalHistoryCreate;
  }
});

test("customer job history denies foreign, incomplete, and ambiguous jobs and returns only safe fields", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalJobFindById = Job.findById;
  const originalHistoryFind = JobHistory.find;
  let historyFilter;
  let historyRecord = {
    _id: "64b000000000000000000061",
    action: "approved",
    fromStatus: "VERIFIED",
    toStatus: "APPROVED",
    performedAt: new Date("2026-10-01T12:00:00.000Z"),
    details: { adminRemarks: "private", employeeId: userAId },
    ipAddress: "192.0.2.1",
    performedBy: { firstName: "Private", phoneNumber: "555-5555" },
  };
  Customer.findOne = customerProfileLookup();
  Job.findById = async (id) =>
    id === jobAId
      ? jobRecord(jobAId, customerAId)
      : id === jobBId
        ? jobRecord(jobBId, customerBId)
        : jobRecord("64b000000000000000000033", null);
  JobHistory.find = (filter) => {
    historyFilter = filter;
    return query([historyRecord]);
  };

  try {
    const own = await invoke(getJobHistory, {
      ...customerRequest(userAId),
      params: { id: jobAId },
    });
    assert.equal(own.status, 200);
    assert.deepEqual(historyFilter, { jobId: jobAId });
    assert.deepEqual(Object.keys(own.body.data[0]).sort(), [
      "_id",
      "action",
      "fromStatus",
      "performedAt",
      "toStatus",
    ]);

    const adminHistory = await invoke(getJobHistory, {
      user: { _id: userBId, userType: "admin", status: "active" },
      params: { id: jobAId },
    });
    assert.equal(adminHistory.body.data[0].ipAddress, "192.0.2.1");
    assert.deepEqual(adminHistory.body.data[0].details, {
      adminRemarks: "private",
      employeeId: userAId,
    });
    assert.equal(adminHistory.body.data[0].performedBy.phoneNumber, "555-5555");

    await assert.rejects(
      invoke(getJobHistory, {
        ...customerRequest(userAId),
        params: { id: jobBId },
      }),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      invoke(getJobHistory, {
        ...customerRequest(userAId),
        params: { id: "64b000000000000000000033" },
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    Customer.findOne = originalCustomerFindOne;
    Job.findById = originalJobFindById;
    JobHistory.find = originalHistoryFind;
  }
});

test("customer detail route returns only ATMs currently assigned to that customer", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalCustomerFindById = Customer.findById;
  const originalAtmFind = ATM.find;
  const filters = [];
  Customer.findOne = customerProfileLookup();
  Customer.findById = (id) =>
    query({
      ...(id === customerAId ? customerA : customerB),
      userId: { _id: id === customerAId ? userAId : userBId },
      customerName: id === customerAId ? "Customer A" : "Customer B",
      bankName: "",
      toObject() {
        return { ...this };
      },
    });
  ATM.find = (filter) => {
    filters.push(filter);
    return query(
      filter.customer === customerAId
        ? []
        : [{ _id: atmId, atmId: "ATM-21", districtId: null }],
    );
  };

  try {
    const formerOwner = await invoke(getCustomerById, {
      ...customerRequest(userAId),
      params: { id: customerAId },
    });
    const currentOwner = await invoke(getCustomerById, {
      ...customerRequest(userBId),
      params: { id: customerBId },
    });
    assert.deepEqual(formerOwner.body.data.atmIds, []);
    assert.deepEqual(currentOwner.body.data.atmIds.map((atm) => atm._id), [
      atmId,
    ]);
    assert.deepEqual(filters, [
      { customer: customerAId, isDeleted: false },
      { customer: customerBId, isDeleted: false },
    ]);

    await assert.rejects(
      invoke(getCustomerById, {
        ...customerRequest(userBId),
        params: { id: customerAId },
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    Customer.findOne = originalCustomerFindOne;
    Customer.findById = originalCustomerFindById;
    ATM.find = originalAtmFind;
  }
});

test("customer job details and history require an eligible completed status", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalJobFindById = Job.findById;
  const originalHistoryFind = JobHistory.find;
  Customer.findOne = customerProfileLookup();
  Job.findById = async () => jobRecord(jobAId, customerAId, "IN_PROGRESS");
  JobHistory.find = () => query([]);

  try {
    await assert.rejects(
      invoke(getJobHistory, {
        ...customerRequest(userAId),
        params: { id: jobAId },
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    Customer.findOne = originalCustomerFindOne;
    Job.findById = originalJobFindById;
    JobHistory.find = originalHistoryFind;
  }
});

test("job photo access follows job snapshot and only returns customer-safe photo fields", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalJobFindById = Job.findById;
  const originalJobFindOne = Job.findOne;
  const originalPhotoFind = JobPhoto.find;
  const photo = {
    _id: "64b000000000000000000071",
    url: "https://photos.example.test/job.jpg",
    thumbnailUrl: "https://photos.example.test/job-thumb.jpg",
    photoType: "after",
    uploadedAt: new Date("2026-10-01T12:00:00.000Z"),
    jobId: jobAId,
    isExpired: false,
    uploadedBy: { firstName: "Private", phoneNumber: "555-5555" },
    gpsData: { latitude: 1, longitude: 2 },
  };
  const job = jobRecord(jobAId, customerAId);
  job.beforePhotos = [photo];
  job.afterPhotos = [];
  Customer.findOne = customerProfileLookup();
  Job.findById = async () => job;
  Job.findOne = () => query(job);
  JobPhoto.find = () => query([photo]);

  try {
    const owner = await invoke(getJobPhotos, {
      ...customerRequest(userAId),
      params: { jobId: jobAId },
    });
    assert.equal(owner.status, 200);
    assert.deepEqual(Object.keys(owner.body.data.photos[0]).sort(), [
      "_id",
      "photoType",
      "thumbnailUrl",
      "uploadedAt",
      "url",
    ]);

    const portalPhotos = await invoke(getCustomerJobPhotos, {
      ...customerRequest(userAId),
      params: { jobId: jobAId },
    });
    assert.deepEqual(Object.keys(portalPhotos.body.data.beforePhotos[0]).sort(), [
      "_id",
      "photoType",
      "thumbnailUrl",
      "uploadedAt",
      "url",
    ]);

    await assert.rejects(
      invoke(getJobPhotos, {
        ...customerRequest(userBId),
        params: { jobId: jobAId },
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    Customer.findOne = originalCustomerFindOne;
    Job.findById = originalJobFindById;
    Job.findOne = originalJobFindOne;
    JobPhoto.find = originalPhotoFind;
  }
});

test("customer portal job photos exclude references owned by another job", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalJobFindOne = Job.findOne;
  Customer.findOne = customerProfileLookup();

  const ownBeforePhoto = {
    _id: "64b000000000000000000073",
    jobId: jobAId,
    url: "https://photos.example.test/customer-a-before.jpg",
    photoType: "before",
    isExpired: false,
  };
  const foreignBeforePhoto = {
    _id: "64b000000000000000000074",
    jobId: jobBId,
    url: "https://photos.example.test/customer-b-before.jpg",
    photoType: "before",
    isExpired: false,
  };
  const foreignAfterPhoto = {
    _id: "64b000000000000000000075",
    jobId: jobBId,
    url: "https://photos.example.test/customer-b-after.jpg",
    photoType: "after",
    isExpired: false,
  };
  const job = jobRecord(jobAId, customerAId);
  job.beforePhotos = [ownBeforePhoto, foreignBeforePhoto];
  job.afterPhotos = [foreignAfterPhoto];
  Job.findOne = () => query(job);

  try {
    const result = await invoke(getCustomerJobPhotos, {
      ...customerRequest(userAId),
      params: { jobId: jobAId },
    });

    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.data.beforePhotos.map((photo) => photo.url),
      [ownBeforePhoto.url],
    );
    assert.deepEqual(result.body.data.afterPhotos, []);
    assert.equal(
      JSON.stringify(result.body.data).includes("customer-b"),
      false,
    );
  } finally {
    Customer.findOne = originalCustomerFindOne;
    Job.findOne = originalJobFindOne;
  }
});

test("AMC photos require completed historical ownership and omit private photo metadata", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalAmcFindById = AMC.findById;
  const originalPhotoFind = AMCPhoto.find;
  let record = amcRecord(amcAId, customerAId);
  const photo = {
    _id: "64b000000000000000000072",
    url: "https://photos.example.test/amc.jpg",
    thumbnailUrl: "https://photos.example.test/amc-thumb.jpg",
    uploadedAt: new Date("2026-10-01T12:00:00.000Z"),
    uploadedBy: { firstName: "Private", phoneNumber: "555-5555" },
    gpsData: { latitude: 1, longitude: 2 },
    publicId: "private-cloudinary-id",
  };
  Customer.findOne = customerProfileLookup();
  AMC.findById = async () => record;
  AMCPhoto.find = () => query([photo]);

  try {
    const owner = await invoke(getAMCPhotos, {
      ...customerRequest(userAId),
      params: { amcId: amcAId },
    });
    assert.equal(owner.status, 200);
    assert.deepEqual(Object.keys(owner.body.data.photos[0]).sort(), [
      "_id",
      "uploadedAt",
    ]);

    await assert.rejects(
      invoke(getAMCPhotos, {
        ...customerRequest(userBId),
        params: { amcId: amcAId },
      }),
      (error) => error.statusCode === 404,
    );
    record = amcRecord(amcAId, customerAId, "IN_PROGRESS");
    await assert.rejects(
      invoke(getAMCPhotos, {
        ...customerRequest(userAId),
        params: { amcId: amcAId },
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    Customer.findOne = originalCustomerFindOne;
    AMC.findById = originalAmcFindById;
    AMCPhoto.find = originalPhotoFind;
  }
});

test("AMC detail uses historical customer ownership and requires completion", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalAmcFindById = AMC.findById;
  let record = amcRecord(amcAId, customerAId);
  Customer.findOne = customerProfileLookup();
  AMC.findById = () => query(record);

  try {
    const own = await invoke(getAMCById, {
      ...customerRequest(userAId),
      params: { id: amcAId },
    });
    assert.equal(own.status, 200);
    assert.equal(own.body.data.amcId, `AMC-${amcAId.slice(-3)}`);
    assert.equal(own.body.data.status, "COMPLETED");
    assert.equal("employeeId" in own.body.data, false);

    await assert.rejects(
      invoke(getAMCById, {
        ...customerRequest(userBId),
        params: { id: amcAId },
      }),
      (error) => error.statusCode === 404 || error.statusCode === 403,
    );
    record = amcRecord(amcAId, customerAId, "IN_PROGRESS");
    await assert.rejects(
      invoke(getAMCById, {
        ...customerRequest(userAId),
        params: { id: amcAId },
      }),
      (error) => error.statusCode === 404,
    );
    record = amcRecord(amcAId, null);
    await assert.rejects(
      invoke(getAMCById, {
        ...customerRequest(userAId),
        params: { id: amcAId },
      }),
      (error) => error.statusCode === 404,
    );
    record = amcRecord(amcBId, customerBId);
    const newOwner = await invoke(getAMCById, {
      ...customerRequest(userBId),
      params: { id: amcBId },
    });
    assert.equal(newOwner.status, 200);
  } finally {
    Customer.findOne = originalCustomerFindOne;
    AMC.findById = originalAmcFindById;
  }
});

test("admin and supervisor AMC details retain authorization and role-specific projections", async () => {
  const originalAmcFindById = AMC.findById;
  const originalEmployeeFindOne = Employee.findOne;
  const record = amcRecord(amcAId, customerAId);
  AMC.findById = () => query(record);
  Employee.findOne = (filter) =>
    query(
      filter.userId === record.employeeId._id && filter.supervisorId === userBId
        ? { userId: record.employeeId._id }
        : null,
    );

  try {
    const admin = await invoke(getAMCById, {
      user: { _id: userBId, userType: "admin", status: "active" },
      params: { id: amcAId },
    });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.data.employeeId.email, "employee@example.test");

    const supervisor = await invoke(getAMCById, {
      user: { _id: userBId, userType: "supervisor", status: "active" },
      params: { id: amcAId },
    });
    assert.equal(supervisor.status, 200);
    assert.equal(supervisor.body.data.amcId, `AMC-${amcAId.slice(-3)}`);
    assert.deepEqual(Object.keys(supervisor.body.data.employeeId).sort(), [
      "_id",
      "firstName",
      "lastName",
    ]);
    assert.equal(supervisor.body.data.employeeId.firstName, "Private");
    assert.equal(supervisor.body.data.employeeId.email, undefined);
    assert.equal(supervisor.body.data.employeeId.phoneNumber, undefined);
  } finally {
    AMC.findById = originalAmcFindById;
    Employee.findOne = originalEmployeeFindOne;
  }
});

test("AMC PDF denies foreign, unfinished, and ambiguous historical ownership", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalAmcFindById = AMC.findById;
  let record = amcRecord(amcAId, customerAId);
  Customer.findOne = customerProfileLookup();
  AMC.findById = () => Promise.resolve(record);

  try {
    await assert.rejects(
      invoke(downloadAMCReport, {
        ...customerRequest(userBId),
        params: { id: amcAId },
      }),
      (error) => error.statusCode === 404,
    );
    record = amcRecord(amcAId, customerAId, "IN_PROGRESS");
    await assert.rejects(
      invoke(downloadAMCReport, {
        ...customerRequest(userAId),
        params: { id: amcAId },
      }),
      (error) => error.statusCode === 404,
    );
    record = amcRecord(amcAId, null);
    await assert.rejects(
      invoke(downloadAMCReport, {
        ...customerRequest(userAId),
        params: { id: amcAId },
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    Customer.findOne = originalCustomerFindOne;
    AMC.findById = originalAmcFindById;
  }
});

test("former owner may download its completed AMC PDF without employee contact details", async () => {
  const originalCustomerFindOne = Customer.findOne;
  const originalAmcFindById = AMC.findById;
  const originalPhotoFind = AMCPhoto.find;
  const record = amcRecord(amcAId, customerAId);
  const populatedPaths = [];
  const renderedText = [];
  const originalText = PDFDocument.prototype.text;
  Customer.findOne = customerProfileLookup();
  AMC.findById = () => {
    const result = query(record);
    const originalPopulate = result.populate;
    result.populate = function (path, fields) {
      populatedPaths.push(path);
      return originalPopulate.call(this, path, fields);
    };
    return result;
  };
  PDFDocument.prototype.text = function (...args) {
    renderedText.push(String(args[0]));
    return originalText.apply(this, args);
  };
  AMCPhoto.find = () =>
    query([
      {
        originalName: "maintenance.jpg",
        url: "https://res.cloudinary.com/example/image/upload/private-photo.jpg",
      },
    ]);

  try {
    const pdf = await invoke(downloadAMCReport, {
      ...customerRequest(userAId),
      params: { id: amcAId },
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers["Content-Type"], "application/pdf");
    assert.ok(Buffer.isBuffer(pdf.body));
    assert.ok(!populatedPaths.includes("employeeId"));
    assert.equal(
      renderedText.some((text) => text.includes("res.cloudinary.com")),
      false,
    );
    assert.equal(
      renderedText.some((text) => text.includes("private-photo.jpg")),
      false,
    );
    assert.equal(renderedText.includes("Total Photos: 1"), true);
    assert.equal(
      renderedText.some((text) => text.includes("employee@example.test")),
      false,
    );
    assert.equal(
      renderedText.some((text) => text.includes("GPS Distance")),
      false,
    );
    assert.equal(renderedText.includes("Status: COMPLETED"), true);
    assert.equal(renderedText.includes("✓ door: Good"), true);
  } finally {
    PDFDocument.prototype.text = originalText;
    Customer.findOne = originalCustomerFindOne;
    AMC.findById = originalAmcFindById;
    AMCPhoto.find = originalPhotoFind;
  }
});
