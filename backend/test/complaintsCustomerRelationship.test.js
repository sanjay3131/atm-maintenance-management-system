import test from "node:test";
import assert from "node:assert/strict";
import ATM from "../src/modules/atms/atm.model.js";
import Complaint from "../src/modules/complaints/complaints.model.js";
import Customer from "../src/modules/customers/customer.model.js";
import {
  createComplaint,
  getComplaintsByCustomer,
} from "../src/modules/complaints/complaints.controller.js";
import { createComplaintSchema } from "../src/modules/complaints/complaints.validation.js";

const customerId = "64b000000000000000000001";
const atmId = "64b000000000000000000002";
const actorId = "64b000000000000000000003";

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

async function withOverrides(overrides, callback) {
  const originals = overrides.map(([target, key]) => [
    target,
    key,
    target[key],
  ]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    return await callback();
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

function queryChain(value, captures = {}) {
  return {
    populate(path, fields) {
      captures.populates ??= [];
      captures.populates.push({ path, fields });
      return this;
    },
    sort(sort) {
      captures.sort = sort;
      return this;
    },
    skip(skip) {
      captures.skip = skip;
      return this;
    },
    limit(limit) {
      captures.limit = limit;
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

const createRequest = (body = {}) => ({
  body: {
    title: "ATM screen issue",
    description: "The screen is not responding",
    atmId,
    reportedBy: "Support desk",
    ...body,
  },
  user: { _id: actorId, userType: "admin" },
});

const savedComplaint = { _id: "64b000000000000000000004" };

async function createComplaintWith(overrides, body) {
  const captures = {};
  return withOverrides(
    [
      [ATM, "findById", async () => ({ _id: atmId, isDeleted: false })],
      [Customer, "findById", async (id) => {
        captures.customerLookupId = id;
        return id === customerId ? { _id: customerId } : null;
      }],
      [Complaint, "countDocuments", async () => 0],
      [Complaint, "create", async (data) => {
        captures.created = data;
        return savedComplaint;
      }],
      [Complaint, "findById", (id) => {
        captures.complaintLookupId = id;
        return queryChain(
          {
            ...savedComplaint,
            customerId: body?.customerId
              ? { customerName: "Example Customer" }
              : null,
          },
          captures,
        );
      }],
      ...overrides,
    ],
    async () => {
      const response = await invoke(createComplaint, createRequest(body));
      return { ...response, captures };
    },
  );
}

test("complaint can be created without customerId and retains null relationship", async () => {
  const { status, captures } = await createComplaintWith([], {});
  assert.equal(status, 201);
  assert.equal(captures.created.customerId, null);
  assert.equal(captures.populates.find(({ path }) => path === "customerId").fields, "customerName");
});

test("complaint can be created with a valid Customer ID", async () => {
  const { status, captures } = await createComplaintWith([], { customerId });
  assert.equal(status, 201);
  assert.equal(captures.customerLookupId, customerId);
  assert.equal(String(captures.created.customerId), customerId);
});

test("invalid Customer ID is rejected", async () => {
  let customerLookupCalled = false;
  const { status } = await createComplaintWith(
    [
      [
        Customer,
        "findById",
        async () => {
          customerLookupCalled = true;
          return null;
        },
      ],
    ],
    { customerId: "not-an-object-id" },
  ).then(
    () => assert.fail("Expected invalid customer ID to be rejected"),
    (error) => ({ status: error.statusCode }),
  );

  assert.equal(status, 400);
  assert.equal(customerLookupCalled, false);
});

test("nonexistent Customer ID is rejected", async () => {
  const result = await createComplaintWith(
    [[Customer, "findById", async () => null]],
    { customerId },
  ).then(
    () => assert.fail("Expected nonexistent customer to be rejected"),
    (error) => error,
  );
  assert.equal(result.statusCode, 404);
  assert.equal(result.message, "Customer not found");
});

test("customer complaint history queries by an existing Customer._id", async () => {
  const captures = {};
  const complaints = [];
  await withOverrides(
    [
      [Customer, "findById", async (id) => {
        captures.customerLookupId = id;
        return { _id: customerId };
      }],
      [Complaint, "find", (filter) => {
        captures.filter = filter;
        return queryChain(complaints, captures);
      }],
      [Complaint, "countDocuments", async (filter) => {
        captures.countFilter = filter;
        return 0;
      }],
    ],
    async () => {
      const { status, body } = await invoke(getComplaintsByCustomer, {
        params: { customerId },
        query: {},
        user: { userType: "admin" },
      });

      assert.equal(status, 200);
      assert.equal(captures.customerLookupId, customerId);
      assert.deepEqual(captures.filter, {
        customerId,
        isDeleted: false,
      });
      assert.deepEqual(body.data.complaints, complaints);
    },
  );
});

test("complaint customer population exposes only customerName, not User credentials", async () => {
  const { captures } = await createComplaintWith([], {});
  const customerPopulate = captures.populates.find(
    ({ path }) => path === "customerId",
  );

  assert.deepEqual(customerPopulate, {
    path: "customerId",
    fields: "customerName",
  });
  assert.equal(Complaint.schema.path("customerId").options.ref, "Customer");
});

test("create validation and model permit null customerId", async () => {
  const parsed = createComplaintSchema.safeParse({
    title: "ATM screen issue",
    description: "The screen is not responding",
    atmId,
    customerId: null,
    reportedBy: "Support desk",
  });

  assert.equal(parsed.success, true);
  assert.notEqual(Complaint.schema.path("customerId").isRequired, true);
  await new Complaint({
    complaintNumber: "COMP-20261007-001",
    atmId,
    customerId: null,
    reportedBy: "Support desk",
    title: "ATM screen issue",
    description: "The screen is not responding",
    createdBy: actorId,
  }).validate();
});
