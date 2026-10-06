import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import { getAllATMs } from "../src/modules/atms/atm.controller.js";
import Customer from "../src/modules/customers/customer.model.js";
import { getAllCustomers } from "../src/modules/customers/customer.controller.js";
import Employee from "../src/modules/employees/employee.model.js";
import { viewAllEmployees } from "../src/modules/employees/employee.controller.js";
import Job from "../src/modules/jobs/jobs.model.js";
import { getAllJobs } from "../src/modules/jobs/jobs.controller.js";

const districtId = "64b000000000000000000001";
const regionId = "64b000000000000000000002";
const bankId = "64b000000000000000000003";
const atmId = new mongoose.Types.ObjectId("64b000000000000000000004");

function invoke(handler, req) {
  return new Promise((resolve, reject) => {
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
}

function queryChain(value, capture = {}) {
  const chain = {
    populate() {
      return this;
    },
    sort() {
      return this;
    },
    skip(value) {
      capture.skip = value;
      return this;
    },
    limit(value) {
      capture.limit = value;
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
  return chain;
}

function hasNestedFacet(stages, insideFacet = false) {
  return stages.some((stage) => {
    if (stage.$facet) {
      if (insideFacet) return true;
      return Object.values(stage.$facet).some((pipeline) =>
        hasNestedFacet(pipeline, true),
      );
    }
    return false;
  });
}

test("scoped ATM list returns an empty paginated result and complete-scope summary", async () => {
  const originalFind = ATM.find;
  const originalAggregate = ATM.aggregate;
  const captured = {};
  ATM.find = (query) => {
    captured.find = query;
    return queryChain([], captured);
  };
  ATM.aggregate = async (pipeline) => {
    captured.pipeline = pipeline;
    return [
      {
        total: [],
        statusCounts: [],
        linkedCustomers: [],
        linkedEmployees: [],
      },
    ];
  };

  try {
    const { body } = await invoke(getAllATMs, {
      query: {
        districtId,
        regionId,
        bankId,
        page: "2",
        limit: "5",
      },
    });
    assert.equal(body.data.pagination.total, 0);
    assert.equal(body.data.pagination.totalPages, 0);
    assert.deepEqual(body.data.atms, []);
    assert.deepEqual(body.data.summary, {
      total: 0,
      statusCounts: {},
      linkedCustomers: 0,
      linkedEmployees: 0,
    });
    assert.equal(captured.find.districtId.toString(), districtId);
    assert.equal(captured.find.regionId.toString(), regionId);
    assert.equal(captured.find.bankId.toString(), bankId);
    assert.equal(captured.skip, 5);
    assert.equal(captured.limit, 5);
  } finally {
    ATM.find = originalFind;
    ATM.aggregate = originalAggregate;
  }
});

test("scoped customer aggregation deduplicates ATM links and excludes unresolved or deleted customers", async () => {
  const originalAggregate = ATM.aggregate;
  let pipeline;
  ATM.aggregate = async (value) => {
    pipeline = value;
    return [
      {
        total: [{ count: 2 }],
        statusCounts: [{ _id: true, count: 1 }, { _id: false, count: 1 }],
        matchingCustomers: [{ _id: "customer-1", linkedATMCount: 2 }],
        matchingTotal: [{ count: 1 }],
      },
    ];
  };

  try {
    const { body } = await invoke(getAllCustomers, {
      user: { userType: "admin" },
      query: { districtId, page: "1", limit: "10" },
    });
    assert.deepEqual(body.data.customers, [
      { _id: "customer-1", linkedATMCount: 2 },
    ]);
    assert.equal(body.data.pagination.total, 1);
    assert.deepEqual(body.data.summary, { total: 2, active: 1, inactive: 1 });
    assert.equal(pipeline.filter((stage) => stage.$facet).length, 1);
    assert.equal(hasNestedFacet(pipeline), false);
    assert.ok(
      pipeline.some((stage) => stage.$group?._id === "$customer"),
      "customer IDs must be grouped to deduplicate multiple ATMs",
    );
    assert.ok(pipeline.some((stage) => stage.$unwind === "$customer"));
    assert.ok(
      pipeline.some((stage) => stage.$match?.["customer.isDeleted"] === false),
    );
  } finally {
    ATM.aggregate = originalAggregate;
  }
});

test("scoped employee aggregation deduplicates ATM assignments and drops unresolved employee references", async () => {
  const originalAggregate = ATM.aggregate;
  let pipeline;
  ATM.aggregate = async (value) => {
    pipeline = value;
    return [
      {
        total: [{ count: 2 }],
        statusCounts: [{ _id: "active", count: 2 }],
        matchingEmployees: [{ _id: "employee-1", linkedATMCount: 2 }],
        matchingTotal: [{ count: 1 }],
      },
    ];
  };

  try {
    const { body } = await invoke(viewAllEmployees, {
      query: { districtId, page: "1", limit: "10" },
    });
    assert.deepEqual(body.data.employees, [
      { _id: "employee-1", linkedATMCount: 2 },
    ]);
    assert.equal(body.data.pagination.total, 1);
    assert.deepEqual(body.data.summary, {
      total: 2,
      statusCounts: { active: 2 },
    });
    assert.equal(pipeline.filter((stage) => stage.$facet).length, 1);
    assert.equal(hasNestedFacet(pipeline), false);
    assert.ok(pipeline.some((stage) => stage.$unwind === "$assignedEmployeeId"));
    assert.ok(
      pipeline.some(
        (stage) => stage.$group?._id === "$assignedEmployeeId",
      ),
      "employee IDs must be grouped to deduplicate multiple ATM links",
    );
    assert.ok(
      pipeline.some((stage) => stage.$unwind === "$employee"),
      "unresolved Employee references must not appear as employee records",
    );
  } finally {
    ATM.aggregate = originalAggregate;
  }
});

test("unscoped customer list retains its array response contract", async () => {
  const originalFind = Customer.find;
  const customers = [{ _id: new mongoose.Types.ObjectId(), customerName: "Shop" }];
  Customer.find = () => queryChain(customers);

  try {
    const { status, body } = await invoke(getAllCustomers, {
      user: { userType: "admin" },
      query: {},
    });
    assert.equal(status, 200);
    assert.deepEqual(body.data, customers);
    assert.equal(body.message, "Customers fetched successfully");
  } finally {
    Customer.find = originalFind;
  }
});

test("unscoped employee list retains its array response contract", async () => {
  const originalFind = Employee.find;
  const employees = [{ _id: new mongoose.Types.ObjectId(), employeeCode: "EMP-1" }];
  Employee.find = () => queryChain(employees);

  try {
    const { status, body } = await invoke(viewAllEmployees, {
      query: {},
    });
    assert.equal(status, 200);
    assert.deepEqual(body.data, employees);
    assert.equal(body.message, "Employees retrieved successfully");
  } finally {
    Employee.find = originalFind;
  }
});

test("job status counts intersect bank, district, and region independently of row filters and pagination", async () => {
  const originalDistinct = ATM.distinct;
  const originalFind = Job.find;
  const originalCountDocuments = Job.countDocuments;
  const originalAggregate = Job.aggregate;
  const captured = {};
  ATM.distinct = async (field, query) => {
    captured.atmFilter = query;
    return [atmId];
  };
  Job.find = (query) => {
    captured.jobQuery = query;
    return queryChain([], captured);
  };
  Job.countDocuments = async () => 0;
  Job.aggregate = async (pipeline) => {
    captured.pipeline = pipeline;
    return [{ _id: "CLOSED", count: 3 }];
  };

  try {
    const { body } = await invoke(getAllJobs, {
      user: { userType: "admin" },
      query: {
        bankId,
        districtId,
        regionId,
        status: "PENDING",
        search: "JOB-",
        priority: "high",
        workType: "repair",
        page: "2",
        limit: "5",
      },
    });
    assert.equal(captured.atmFilter.$and.length, 4);
    assert.equal(captured.atmFilter.$and[1].bankId, bankId);
    assert.equal(captured.atmFilter.$and[2].districtId, districtId);
    assert.equal(captured.atmFilter.$and[3].regionId, regionId);
    assert.equal(captured.jobQuery.status, "PENDING");
    assert.equal(captured.skip, 5);
    assert.equal(captured.limit, 5);
    assert.equal(captured.pipeline[0].$match.atmId.$in[0], atmId);
    assert.equal(body.data.statusCounts.CLOSED, 3);
    assert.equal(body.data.statusCounts.PENDING, 0);
    assert.equal(body.data.pagination.total, 0);
  } finally {
    ATM.distinct = originalDistinct;
    Job.find = originalFind;
    Job.countDocuments = originalCountDocuments;
    Job.aggregate = originalAggregate;
  }
});
