import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import { getAllATMs } from "../src/modules/atms/atm.controller.js";
import { listATMsQuerySchema } from "../src/modules/atms/atm.validation.js";
import Customer from "../src/modules/customers/customer.model.js";
import { getAllCustomers } from "../src/modules/customers/customer.controller.js";
import District from "../src/modules/districts/district.models.js";
import { getAllDistricts } from "../src/modules/districts/district.controller.js";
import Employee from "../src/modules/employees/employee.model.js";
import { viewAllEmployees } from "../src/modules/employees/employee.controller.js";
import Job from "../src/modules/jobs/jobs.model.js";
import { getAllJobs } from "../src/modules/jobs/jobs.controller.js";
import Region from "../src/modules/region/region.model.js";

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
    select() {
      return this;
    },
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

function stubGeography({
  regionBankId = bankId,
  districtBankId = bankId,
  districtRegionId = regionId,
} = {}) {
  const originalRegionFindById = Region.findById;
  const originalDistrictFindById = District.findById;
  Region.findById = () =>
    queryChain({
      bankId: new mongoose.Types.ObjectId(regionBankId),
    });
  District.findById = () =>
    queryChain({
      bankId: new mongoose.Types.ObjectId(districtBankId),
      regionId: new mongoose.Types.ObjectId(districtRegionId),
    });
  return () => {
    Region.findById = originalRegionFindById;
    District.findById = originalDistrictFindById;
  };
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
  const originalAggregate = ATM.aggregate;
  const originalPopulate = ATM.populate;
  const restoreGeography = stubGeography();
  const captured = {};
  ATM.aggregate = async (pipeline) => {
    captured.pipeline = pipeline;
    return [
      {
        atms: [],
        total: [],
        statusCounts: [],
        linkedCustomers: [],
        linkedEmployees: [],
      },
    ];
  };
  ATM.populate = async (atms) => atms;

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
    const [match, facet] = captured.pipeline;
    assert.equal(match.$match.districtId.toString(), districtId);
    assert.equal(match.$match.regionId.toString(), regionId);
    assert.equal(match.$match.bankId.toString(), bankId);
    assert.equal(facet.$facet.atms[1].$skip, 5);
    assert.equal(facet.$facet.atms[2].$limit, 5);
  } finally {
    ATM.aggregate = originalAggregate;
    ATM.populate = originalPopulate;
    restoreGeography();
  }
});

test("ATM list combines geography, assignment, search, operational status, and pagination filters", async () => {
  const originalAggregate = ATM.aggregate;
  const originalPopulate = ATM.populate;
  const restoreGeography = stubGeography();
  let pipeline;
  ATM.aggregate = async (value) => {
    pipeline = value;
    return [
      {
        atms: [],
        total: [],
        statusCounts: [],
        linkedCustomers: [],
        linkedEmployees: [],
      },
    ];
  };
  ATM.populate = async (atms) => atms;

  try {
    await invoke(getAllATMs, {
      query: {
        bankId,
        regionId,
        districtId,
        assignmentStatus: "assigned",
        employeeId: "64b000000000000000000005",
        search: "ATM(1)+",
        status: "ACTIVE",
        page: "2",
        limit: "5",
      },
    });

    const match = pipeline.find((stage) => stage.$match)?.$match;
    assert.deepEqual(match.isDeleted, { $ne: true });
    assert.equal(match.bankId.toString(), bankId);
    assert.equal(match.regionId.toString(), regionId);
    assert.equal(match.districtId.toString(), districtId);
    assert.equal(
      match.assignedEmployeeId.toString(),
      "64b000000000000000000005",
    );
    assert.equal(match.status, "ACTIVE");
    assert.equal(match.$or[0].clientAtmId.$regex, "ATM\\(1\\)\\+");
    assert.ok(
      pipeline.some(
        (stage) =>
          stage.$lookup?.from === Employee.collection.name &&
          stage.$lookup.as === "_validAssignedEmployees",
      ),
    );
    const employeeLookup = pipeline.find(
      (stage) => stage.$lookup?.as === "_validAssignedEmployees",
    ).$lookup;
    assert.deepEqual(employeeLookup.pipeline, [{ $project: { _id: 1 } }]);
    assert.ok(
      pipeline.some(
        (stage) =>
          stage.$match?.["_validAssignedEmployees.0"]?.$exists === true,
      ),
    );
    const atmFacet = pipeline.find((stage) => stage.$facet).$facet.atms;
    assert.equal(atmFacet[1].$skip, 5);
    assert.equal(atmFacet[2].$limit, 5);
  } finally {
    ATM.aggregate = originalAggregate;
    ATM.populate = originalPopulate;
    restoreGeography();
  }
});

test("region-scoped ATM list includes legacy and inactive records but excludes deleted records", async () => {
  const originalAggregate = ATM.aggregate;
  const originalPopulate = ATM.populate;
  const restoreGeography = stubGeography();
  let pipeline;
  ATM.aggregate = async (value) => {
    pipeline = value;
    return [
      {
        atms: [{ _id: atmId, atmId: "ATM-INACTIVE", status: "INACTIVE" }],
        total: [{ count: 1 }],
        statusCounts: [{ _id: "INACTIVE", count: 1 }],
        linkedCustomers: [],
        linkedEmployees: [],
      },
    ];
  };
  ATM.populate = async (atms) => atms;

  try {
    const { body } = await invoke(getAllATMs, { query: { regionId } });
    const match = pipeline.find((stage) => stage.$match)?.$match;
    assert.deepEqual(match.isDeleted, { $ne: true });
    assert.equal(match.regionId.toString(), regionId);
    assert.equal(match.status, undefined);
    assert.equal(body.data.atms[0].status, "INACTIVE");

    const linkedCustomerLookup = pipeline.find((stage) => stage.$facet)
      .$facet.linkedCustomers.find(
        (stage) => stage.$lookup?.from === Customer.collection.name,
      ).$lookup;
    assert.deepEqual(linkedCustomerLookup.pipeline[0].$match.isDeleted, {
      $ne: true,
    });
  } finally {
    ATM.aggregate = originalAggregate;
    ATM.populate = originalPopulate;
    restoreGeography();
  }
});

test("scoped ATM rows preserve ATMTable defaults after aggregation", async () => {
  const originalAggregate = ATM.aggregate;
  const originalPopulate = ATM.populate;
  let populatedATMs;
  ATM.aggregate = async () => [
    {
      atms: [{ _id: atmId, atmId: "ATM-1" }],
      total: [{ count: 1 }],
      statusCounts: [],
      linkedCustomers: [],
      linkedEmployees: [],
    },
  ];
  ATM.populate = async (atms) => {
    populatedATMs = atms;
    return atms;
  };

  try {
    const { body } = await invoke(getAllATMs, { query: { bankId } });
    assert.deepEqual(populatedATMs[0].assignedEmployeeId, []);
    assert.equal(populatedATMs[0].status, "ACTIVE");
    assert.deepEqual(body.data.atms[0].assignedEmployeeId, []);
    assert.equal(body.data.atms[0].status, "ACTIVE");
  } finally {
    ATM.aggregate = originalAggregate;
    ATM.populate = originalPopulate;
  }
});

test("ATM list rejects invalid bank, region, and district hierarchies", async () => {
  const originalAggregate = ATM.aggregate;
  const restoreGeography = stubGeography({
    regionBankId: "64b000000000000000000006",
    districtBankId: "64b000000000000000000006",
  });
  ATM.aggregate = async () => {
    throw new Error("Aggregation should not run for invalid geography");
  };

  try {
    await assert.rejects(
      invoke(getAllATMs, { query: { bankId, regionId } }),
      (error) =>
        error.statusCode === 400 &&
        error.message === "Selected region does not belong to the selected bank",
    );

    stubGeography({
      regionBankId: bankId,
      districtRegionId: "64b000000000000000000006",
    });
    await assert.rejects(
      invoke(getAllATMs, { query: { bankId, regionId, districtId } }),
      (error) =>
        error.statusCode === 400 &&
        error.message === "Selected district does not belong to the selected region",
    );
  } finally {
    ATM.aggregate = originalAggregate;
    restoreGeography();
  }
});

test("ATM list validates assignment filters and supports bank-only scope", async () => {
  assert.equal(
    listATMsQuerySchema.safeParse({ bankId, assignmentStatus: "all" }).success,
    true,
  );
  assert.equal(
    listATMsQuerySchema.safeParse({ assignmentStatus: "pending" }).success,
    false,
  );
  assert.equal(
    listATMsQuerySchema.safeParse({ employeeId: "not-an-object-id" }).success,
    false,
  );
  assert.equal(
    listATMsQuerySchema.safeParse({ limit: "101" }).success,
    false,
  );

  const originalAggregate = ATM.aggregate;
  const originalPopulate = ATM.populate;
  let pipeline;
  ATM.aggregate = async (value) => {
    pipeline = value;
    return [
      {
        atms: [],
        total: [],
        statusCounts: [],
        linkedCustomers: [],
        linkedEmployees: [],
      },
    ];
  };
  ATM.populate = async (atms) => atms;

  try {
    await invoke(getAllATMs, { query: { bankId } });
    const match = pipeline.find((stage) => stage.$match)?.$match;
    assert.equal(match.bankId.toString(), bankId);
    assert.equal(match.regionId, undefined);
    assert.equal(match.districtId, undefined);
  } finally {
    ATM.aggregate = originalAggregate;
    ATM.populate = originalPopulate;
  }
});

test("unassigned ATM filter excludes any resolvable employee assignment", async () => {
  const originalAggregate = ATM.aggregate;
  const originalPopulate = ATM.populate;
  let pipeline;
  ATM.aggregate = async (value) => {
    pipeline = value;
    return [
      {
        atms: [],
        total: [],
        statusCounts: [],
        linkedCustomers: [],
        linkedEmployees: [],
      },
    ];
  };
  ATM.populate = async (atms) => atms;

  try {
    await invoke(getAllATMs, {
      query: { assignmentStatus: "unassigned" },
    });

    assert.ok(
      pipeline.some(
        (stage) =>
          stage.$match?.["_validAssignedEmployees.0"]?.$exists === false,
      ),
    );
  } finally {
    ATM.aggregate = originalAggregate;
    ATM.populate = originalPopulate;
  }
});

test("unfiltered ATM list retains its array response contract", async () => {
  const originalFind = ATM.find;
  const atms = [{ _id: atmId, atmId: "ATM-1" }];
  ATM.find = () => queryChain(atms);

  try {
    const { status, body } = await invoke(getAllATMs, {
      query: {},
    });
    assert.equal(status, 200);
    assert.deepEqual(body.data, atms);
    assert.equal(body.message, "ATMs fetched successfully");
  } finally {
    ATM.find = originalFind;
  }
});

test("region-scoped customers include legacy and inactive records, exclude deleted records, and retain geography", async () => {
  const originalAggregate = Customer.aggregate;
  let pipeline;
  Customer.aggregate = async (value) => {
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
      query: { districtId, regionId, page: "1", limit: "10" },
    });
    assert.deepEqual(body.data.customers, [
      {
        _id: "customer-1",
        linkedATMCount: 2,
        regionIds: [],
        serviceDistrictIds: [],
      },
    ]);
    assert.equal(body.data.pagination.total, 1);
    assert.deepEqual(body.data.summary, { total: 2, active: 1, inactive: 1 });
    assert.equal(pipeline.filter((stage) => stage.$facet).length, 1);
    assert.equal(hasNestedFacet(pipeline), false);
    const customerMatch = pipeline.find(
      (stage) => stage.$match?.isDeleted !== undefined,
    ).$match;
    assert.deepEqual(customerMatch.isDeleted, { $ne: true });
    assert.equal(customerMatch.isActive, undefined);
    assert.ok(
      pipeline.some(
        (stage) =>
          stage.$lookup?.from === ATM.collection.name &&
          stage.$lookup.let?.customerId === "$_id",
      ),
      "linked ATMs must be looked up from each Customer",
    );
    const linkedATMMatch = pipeline.find(
      (stage) => stage.$lookup?.from === ATM.collection.name,
    ).$lookup.pipeline[0].$match;
    assert.deepEqual(linkedATMMatch.isDeleted, { $ne: true });
    assert.equal(linkedATMMatch.regionId.toString(), regionId);
    assert.equal(linkedATMMatch.districtId.toString(), districtId);
    assert.ok(pipeline.some((stage) => stage.$addFields?.linkedATMCount));
    assert.ok(
      pipeline.some((stage) => stage.$match?.linkedATMCount?.$gt === 0),
      "geographic scopes must include customers only when an ATM matches",
    );
  } finally {
    Customer.aggregate = originalAggregate;
  }
});

test("region-scoped employees retain inactive assignments and use the non-deleted geographic ATM scope", async () => {
  const originalAggregate = ATM.aggregate;
  let pipeline;
  ATM.aggregate = async (value) => {
    pipeline = value;
    return [
      {
        total: [{ count: 2 }],
        statusCounts: [
          { _id: "active", count: 1 },
          { _id: "inactive", count: 1 },
        ],
        matchingEmployees: [
          {
            _id: "employee-1",
            linkedATMCount: 2,
            status: "inactive",
          },
        ],
        matchingTotal: [{ count: 1 }],
      },
    ];
  };

  try {
    const { body } = await invoke(viewAllEmployees, {
      query: { districtId, regionId, page: "1", limit: "10" },
    });
    assert.deepEqual(body.data.employees, [{
      _id: "employee-1",
      linkedATMCount: 2,
      status: "inactive",
    }]);
    assert.equal(body.data.pagination.total, 1);
    assert.deepEqual(body.data.summary, {
      total: 2,
      statusCounts: { active: 1, inactive: 1 },
    });
    assert.equal(pipeline.filter((stage) => stage.$facet).length, 1);
    assert.equal(hasNestedFacet(pipeline), false);
    const atmMatch = pipeline.find((stage) => stage.$match)?.$match;
    assert.deepEqual(atmMatch.isDeleted, { $ne: true });
    assert.equal(atmMatch.regionId.toString(), regionId);
    assert.equal(atmMatch.districtId.toString(), districtId);
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

test("region-filtered district listing preserves inactive districts without a deletion filter", async () => {
  const originalFind = District.find;
  const inactiveDistrict = {
    _id: "district-1",
    regionId,
    isActive: false,
  };
  let districtQuery;
  District.find = (query) => {
    districtQuery = query;
    return queryChain([inactiveDistrict]);
  };

  try {
    const { body } = await invoke(getAllDistricts, {
      query: { regionId },
    });

    assert.deepEqual(districtQuery, { regionId });
    assert.equal(districtQuery.isDeleted, undefined);
    assert.equal(districtQuery.isActive, undefined);
    assert.deepEqual(body.data, [inactiveDistrict]);
  } finally {
    District.find = originalFind;
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
