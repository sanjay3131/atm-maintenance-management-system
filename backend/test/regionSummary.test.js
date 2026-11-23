import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import Customer from "../src/modules/customers/customer.model.js";
import District from "../src/modules/districts/district.models.js";
import Employee from "../src/modules/employees/employee.model.js";
import Region from "../src/modules/region/region.model.js";
import { getRegionSummaries } from "../src/modules/region/region.controller.js";
import { regionSummaryQuerySchema } from "../src/modules/region/region.validate.js";

const regionId = new mongoose.Types.ObjectId("64b000000000000000000001");
const bankId = "64b000000000000000000002";

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

async function captureSummary(query = {}) {
  const originalAggregate = Region.aggregate;
  let pipeline;
  const result = {
    regionId,
    name: "Central",
    description: "",
    isActive: false,
    bank: null,
    counts: { districts: 0, atms: 0, employees: 0, customers: 0 },
  };
  Region.aggregate = async (value) => {
    pipeline = value;
    return [result];
  };

  try {
    const response = await invoke(getRegionSummaries, { query });
    return { ...response, pipeline, result };
  } finally {
    Region.aggregate = originalAggregate;
  }
}

test("region summary includes empty, inactive, unmapped regions and nullable bank", async () => {
  const { status, body, pipeline, result } = await captureSummary();

  assert.equal(status, 200);
  assert.equal(body.data[0], result);
  assert.deepEqual(result.counts, {
    districts: 0,
    atms: 0,
    employees: 0,
    customers: 0,
  });
  assert.equal(result.bank, null);
  assert.deepEqual(pipeline[0], { $match: {} });
  assert.equal(pipeline.some((stage) => stage.$match?.geographyStatus), false);

  const districtLookup = pipeline.find(
    (stage) => stage.$lookup?.from === District.collection.name,
  ).$lookup;
  assert.deepEqual(districtLookup.pipeline[0].$match.isDeleted, {
    $ne: true,
  });
  assert.equal(districtLookup.pipeline[1].$count, "count");
});

test("region summary includes legacy ATMs without isDeleted and excludes explicitly deleted ATMs", async () => {
  const { pipeline } = await captureSummary();
  const atmLookup = pipeline.find(
    (stage) => stage.$lookup?.from === ATM.collection.name,
  ).$lookup;
  const atmMatch = atmLookup.pipeline[0].$match;

  assert.deepEqual(atmMatch, {
    $expr: { $eq: ["$regionId", "$$regionId"] },
    isDeleted: { $ne: true },
  });
  assert.equal(atmLookup.pipeline[1].$facet.atms[0].$count, "count");
  assert.equal(
    Object.hasOwn(atmMatch, "status"),
    false,
    "inactive, maintenance, and removed ATMs remain in the count",
  );
});

test("employee counts include inactive and legacy employees, exclude deleted or invalid references, and deduplicate by ID", async () => {
  const { pipeline } = await captureSummary();
  const atmLookup = pipeline.find(
    (stage) => stage.$lookup?.from === ATM.collection.name,
  ).$lookup;
  const facets = atmLookup.pipeline[1].$facet;
  const employeeGroup = facets.employees.find((stage) => stage.$group);
  const employeeLookup = facets.employees.find(
    (stage) => stage.$lookup?.from === Employee.collection.name,
  ).$lookup;

  assert.deepEqual(employeeGroup.$group, { _id: "$assignedEmployeeId" });
  assert.deepEqual(employeeLookup.pipeline[0].$match, {
    isDeleted: { $ne: true },
  });
  assert.equal(Object.hasOwn(employeeLookup.pipeline[0].$match, "status"), false);
  assert.ok(
    facets.employees.some(
      (stage) => stage.$match?.["employee.0"]?.$exists === true,
    ),
    "dangling employee references are excluded",
  );
});

test("customer counts include inactive customers without isDeleted, exclude deleted or invalid references, and deduplicate by ID", async () => {
  const { pipeline } = await captureSummary();
  const atmLookup = pipeline.find(
    (stage) => stage.$lookup?.from === ATM.collection.name,
  ).$lookup;
  const facets = atmLookup.pipeline[1].$facet;
  const customerGroup = facets.customers.find((stage) => stage.$group);
  const customerLookup = facets.customers.find(
    (stage) => stage.$lookup?.from === Customer.collection.name,
  ).$lookup;

  assert.deepEqual(customerGroup.$group, { _id: "$customer" });
  assert.deepEqual(customerLookup.pipeline[0].$match, {
    isDeleted: { $ne: true },
  });
  assert.equal(Object.hasOwn(customerLookup.pipeline[0].$match, "isActive"), false);
  assert.ok(
    facets.customers.some(
      (stage) => stage.$match?.["customer.0"]?.$exists === true,
    ),
    "dangling and soft-deleted customer references are excluded",
  );
});

test("region summary supports escaped search, status, and bank filters", async () => {
  const parsed = regionSummaryQuerySchema.parse({
    search: "North (1)+",
    status: "inactive",
    bankId,
  });
  const { pipeline } = await captureSummary(parsed);

  assert.deepEqual(pipeline[0].$match, {
    isActive: false,
    bankId: new mongoose.Types.ObjectId(bankId),
    $or: [
      { name: { $regex: "North \\(1\\)\\+", $options: "i" } },
      { code: { $regex: "North \\(1\\)\\+", $options: "i" } },
    ],
  });
  assert.equal(
    regionSummaryQuerySchema.safeParse({ bankId: "not-an-object-id" }).success,
    false,
  );
});

test("region summary projects one parent bank or null for a missing reference", async () => {
  const { pipeline } = await captureSummary();
  const bankLookup = pipeline.find(
    (stage) => stage.$lookup?.from === "banks",
  ).$lookup;
  const project = pipeline.at(-1).$project;

  assert.equal(bankLookup.localField, "bankId");
  assert.equal(bankLookup.foreignField, "_id");
  assert.equal(project.bank.$let.vars.bank.$arrayElemAt[0], "$parentBank");
  assert.deepEqual(project.bank.$let.in.$cond[2], null);
  assert.deepEqual(project.counts, {
    districts: {
      $ifNull: [{ $arrayElemAt: ["$districtSummary.count", 0] }, 0],
    },
    atms: { $ifNull: [{ $arrayElemAt: ["$atmSummary.atms", 0] }, 0] },
    employees: {
      $ifNull: [{ $arrayElemAt: ["$atmSummary.employees", 0] }, 0],
    },
    customers: {
      $ifNull: [{ $arrayElemAt: ["$atmSummary.customers", 0] }, 0],
    },
  });
});
