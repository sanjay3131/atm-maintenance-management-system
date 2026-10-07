import test from "node:test";
import assert from "node:assert/strict";
import ATM from "../src/modules/atms/atm.model.js";
import Bank from "../src/modules/banks/bank.model.js";
import Customer from "../src/modules/customers/customer.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import customerRouter from "../src/modules/customers/customer.routes.js";
import { getAllJobs } from "../src/modules/jobs/jobs.controller.js";
import {
  getAllCustomers,
  getCustomerById,
} from "../src/modules/customers/customer.controller.js";
import {
  createCustomerSchema,
  updateCustomerSchema,
} from "../src/modules/customers/customer.validation.js";

const customerId = "64b000000000000000000001";
const districtId = "64b000000000000000000002";
const regionId = "64b000000000000000000003";

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
    select(fields) {
      captures.select = fields;
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

function paginatedAggregateResult(customers, { total = customers.length } = {}) {
  return [{
    total: [{ count: total }],
    statusCounts: [{ _id: true, count: total }],
    matchingCustomers: customers,
    matchingTotal: [{ count: total }],
  }];
}

test("Customer detail derives assigned ATMs and districts from ATM.customer", async () => {
  const captures = { atm: {}, bank: {} };
  const customer = {
    _id: customerId,
    userId: { _id: "64b000000000000000000004" },
    bankName: "TEST_BANK_001",
    atmIds: [],
    isActive: true,
    isDeleted: false,
    toObject() {
      return {
        _id: this._id,
        userId: this.userId,
        bankName: this.bankName,
        atmIds: this.atmIds,
        isActive: this.isActive,
        isDeleted: this.isDeleted,
      };
    },
  };
  const assignedATMs = Array.from({ length: 9 }, (_, index) => ({
    _id: `atm-${index}`,
    atmId: `ATM-${index}`,
    bankId: { _id: "bank-id", bankName: "Test Bank" },
    districtId: {
      _id: index < 5 ? "district-a" : "district-b",
      districtName: index < 5 ? "District A" : "District B",
    },
    regionId: { _id: "region-id", name: "Region" },
    status: "ACTIVE",
  }));

  await withOverrides(
    [
      [
        Customer,
        "findById",
        (id) => {
          captures.id = id;
          return queryChain(customer, captures);
        },
      ],
      [
        ATM,
        "find",
        (filter) => {
          captures.atmFilter = filter;
          return queryChain(assignedATMs, captures.atm);
        },
      ],
      [
        Bank,
        "findOne",
        (filter) => {
          captures.bankFilter = filter;
          return queryChain({ bankName: "Test Bank" }, captures.bank);
        },
      ],
    ],
    async () => {
      const { status, body } = await invoke(getCustomerById, {
        params: { id: customerId },
        user: { _id: "admin-user", userType: "admin" },
      });

      assert.equal(status, 200);
      assert.deepEqual(captures.atmFilter, {
        customer: customerId,
        isDeleted: false,
      });
      assert.equal(body.data.atmIds.length, 9);
      assert.equal(body.data.linkedATMCount, body.data.atmIds.length);
      assert.deepEqual(
        body.data.districtIds.map(({ districtName }) => districtName),
        ["District A", "District B"],
      );
      assert.equal(body.data.bankName, "Test Bank");
      assert.deepEqual(captures.bankFilter, {
        $or: [
          { bankCode: "TEST_BANK_001" },
          { bankName: "TEST_BANK_001" },
        ],
      });
      assert.equal(captures.bank.select, "bankName");
      assert.equal(
        captures.atm.select,
        "atmId locationName bankId districtId regionId address installationType status",
      );
      assert.deepEqual(captures.atm.populates, [
        { path: "bankId", fields: "bankName" },
        { path: "districtId", fields: "districtName" },
        { path: "regionId", fields: "name" },
      ]);
      assert.ok(ATM.schema.path("bankId"));
    },
  );
});

test("Customer detail rejects malformed Customer IDs before querying", async () => {
  const originalFindById = Customer.findById;
  let called = false;
  Customer.findById = () => {
    called = true;
    throw new Error("Customer lookup must not run for an invalid ID");
  };

  try {
    await assert.rejects(
      invoke(getCustomerById, {
        params: { id: "invalid" },
        user: { userType: "admin" },
      }),
      (error) => error.statusCode === 400,
    );
    assert.equal(called, false);
  } finally {
    Customer.findById = originalFindById;
  }
});

test("/portal/jobs routes are declared before the generic Customer :id route", () => {
  const paths = customerRouter.stack
    .map((layer) => layer.route?.path)
    .filter(Boolean);
  const genericIdIndex = paths.indexOf("/:id");

  assert.ok(genericIdIndex >= 0);
  for (const path of [
    "/portal/jobs",
    "/portal/jobs/:jobId",
    "/portal/jobs/:jobId/photos",
  ]) {
    assert.ok(paths.indexOf(path) >= 0);
    assert.ok(paths.indexOf(path) < genericIdIndex);
  }
});

test("scoped paginated list includes customers with zero or multiple assigned ATMs", async () => {
  const originalAggregate = Customer.aggregate;
  let pipeline;
  const customers = [
    { _id: "customer-zero", customerName: "No ATM", linkedATMCount: 0 },
    { _id: "customer-many", customerName: "Several ATMs", linkedATMCount: 3 },
  ];
  Customer.aggregate = async (value) => {
    pipeline = value;
    return paginatedAggregateResult(customers);
  };

  try {
    const { status, body } = await invoke(getAllCustomers, {
      user: { userType: "admin" },
      query: { page: "1", limit: "10" },
    });

    assert.equal(status, 200);
    assert.deepEqual(body.data.customers, customers);
    assert.deepEqual(
      body.data.customers.map(({ linkedATMCount }) => linkedATMCount),
      [0, 3],
    );
    assert.ok(pipeline[0].$match.isDeleted === false);
    assert.equal(pipeline[0].$lookup, undefined);
    assert.ok(
      pipeline.some(
        (stage) =>
          stage.$lookup?.from === ATM.collection.name &&
          stage.$lookup.let?.customerId === "$_id",
      ),
    );
    assert.ok(pipeline.some((stage) => stage.$addFields?.linkedATMCount));
    assert.equal(
      pipeline.some((stage) => stage.$match?.linkedATMCount?.$gt === 0),
      false,
    );
  } finally {
    Customer.aggregate = originalAggregate;
  }
});

test("Customer status, search, geographic filters, summary, and pagination remain scoped", async () => {
  const originalAggregate = Customer.aggregate;
  let pipeline;
  const customer = { _id: "customer-match", linkedATMCount: 1 };
  Customer.aggregate = async (value) => {
    pipeline = value;
    return [{
      total: [{ count: 3 }],
      statusCounts: [{ _id: true, count: 2 }, { _id: false, count: 1 }],
      matchingCustomers: [customer],
      matchingTotal: [{ count: 1 }],
    }];
  };

  try {
    const { status, body } = await invoke(getAllCustomers, {
      user: { userType: "admin" },
      query: {
        districtId,
        regionId,
        bankId: "64b000000000000000000005",
        status: "active",
        search: "Alice.*",
        page: "2",
        limit: "5",
      },
    });

    assert.equal(status, 200);
    assert.deepEqual(body.data.customers, [customer]);
    assert.deepEqual(body.data.summary, {
      total: 3,
      active: 2,
      inactive: 1,
    });
    assert.deepEqual(body.data.pagination, {
      page: 2,
      limit: 5,
      total: 1,
      totalPages: 1,
    });

    const atmLookup = pipeline.find(
      (stage) => stage.$lookup?.from === ATM.collection.name,
    ).$lookup;
    const atmMatch = atmLookup.pipeline[0].$match;
    assert.equal(atmMatch.districtId.toString(), districtId);
    assert.equal(atmMatch.regionId.toString(), regionId);
    assert.equal(atmMatch.bankId.toString(), "64b000000000000000000005");
    assert.equal(atmMatch.isDeleted, false);
    assert.equal(atmMatch.$expr.$eq[1], "$$customerId");
    assert.ok(
      pipeline.some((stage) => stage.$match?.linkedATMCount?.$gt === 0),
    );

    const matchingCustomers = pipeline.find(
      (stage) => stage.$facet,
    ).$facet.matchingCustomers;
    const filter = matchingCustomers.find((stage) => stage.$match)?.$match;
    assert.equal(filter.isActive, true);
    assert.deepEqual(filter.$or.map((term) => Object.keys(term)[0]), [
      "customerName",
      "customerEmail",
      "customerPhone",
    ]);
    assert.equal(filter.$or[0].customerName.$regex, "Alice\\.\\*");
    assert.deepEqual(matchingCustomers.find((stage) => stage.$skip), {
      $skip: 5,
    });
    assert.deepEqual(matchingCustomers.find((stage) => stage.$limit), {
      $limit: 5,
    });
  } finally {
    Customer.aggregate = originalAggregate;
  }
});

test("Customer bank filtering uses Customer.bankName and preserves full ATM counts", async () => {
  const sbiBank = {
    _id: "64b000000000000000000005",
    bankCode: "SBI",
    bankName: "State Bank of India",
  };
  const testBank = {
    _id: "64b000000000000000000006",
    bankCode: "TEST_BANK_001",
    bankName: "Test Bank",
  };
  const customerFixtures = [
    { _id: "test", customerName: "test", bankName: "TEST_BANK_001", isActive: true, createdAt: "2026-10-07" },
    { _id: "customer", customerName: "customer", bankName: "SBI", isActive: true, createdAt: "2026-10-06" },
    { _id: "Kumar", customerName: "Kumar", bankName: "SBI", isActive: true, createdAt: "2026-10-05" },
    { _id: "cus-0", customerName: "cus 0", bankName: "SBI", isActive: true, createdAt: "2026-10-04" },
    { _id: "test-customer", customerName: "Test Customer", bankName: "TEST_BANK_001", isActive: true, createdAt: "2026-10-03" },
    { _id: "batman2", customerName: "batman2", bankName: "SBI", isActive: false, createdAt: "2026-10-02" },
    { _id: "batman", customerName: "batman", bankName: "SBI", isActive: true, createdAt: "2026-10-01" },
  ];
  const atmFixtures = [
    { customer: "Kumar", bankId: sbiBank._id, isDeleted: false },
    { customer: "Kumar", bankId: testBank._id, isDeleted: false },
    { customer: "Kumar", bankId: testBank._id, isDeleted: false },
    ...Array.from({ length: 9 }, () => ({
      customer: "test-customer",
      bankId: testBank._id,
      isDeleted: false,
    })),
  ];
  const bankValues = [sbiBank, testBank];
  let lastPipeline;

  const findBank = (query) => {
    const terms = query.$or ?? [];
    const value = terms[0]?.bankCode ?? terms[0]?.bankName;
    return bankValues.find(
      (bank) => bank.bankCode === value || bank.bankName === value,
    );
  };

  const matchesFilter = (customer, filter) => {
    if (filter.bankName && !filter.bankName.$in.includes(customer.bankName)) {
      return false;
    }
    if (
      filter.isActive !== undefined &&
      customer.isActive !== filter.isActive
    ) {
      return false;
    }
    if (filter.$or) {
      const matched = filter.$or.some((term) => {
        const [field, condition] = Object.entries(term)[0];
        return new RegExp(condition.$regex, condition.$options).test(
          customer[field],
        );
      });
      if (!matched) return false;
    }
    return true;
  };

  await withOverrides(
    [
      [
        Bank,
        "findOne",
        (query) => queryChain(findBank(query)),
      ],
      [
        Customer,
        "aggregate",
        async (pipeline) => {
          lastPipeline = pipeline;
          const baseMatch = pipeline[0].$match;
          const linkedATMMatch = pipeline.find(
            (stage) => stage.$lookup?.from === ATM.collection.name,
          ).$lookup.pipeline[0].$match;
          const baseCustomers = customerFixtures.filter(
            (customer) =>
              customer.isDeleted !== true &&
              (!baseMatch.bankName ||
                baseMatch.bankName.$in.includes(customer.bankName)),
          );
          const customersWithCounts = baseCustomers.map((customer) => ({
            ...customer,
            linkedATMCount: atmFixtures.filter(
              (atm) =>
                atm.customer === customer._id &&
                atm.isDeleted === linkedATMMatch.isDeleted,
            ).length,
          }));
          const facet = pipeline.find((stage) => stage.$facet).$facet;
          const customerFilter = facet.matchingCustomers.find(
            (stage) => stage.$match,
          ).$match;
          const matchingCustomers = customersWithCounts
            .filter((customer) => matchesFilter(customer, customerFilter))
            .sort((left, right) =>
              right.createdAt.localeCompare(left.createdAt),
            );
          const skip = facet.matchingCustomers.find(
            (stage) => stage.$skip,
          )?.$skip ?? 0;
          const limit = facet.matchingCustomers.find(
            (stage) => stage.$limit,
          )?.$limit ?? matchingCustomers.length;
          const active = customersWithCounts.filter(
            (customer) => customer.isActive,
          ).length;
          return [{
            total: [{ count: customersWithCounts.length }],
            statusCounts: [
              ...(active ? [{ _id: true, count: active }] : []),
              ...(customersWithCounts.length - active
                ? [{ _id: false, count: customersWithCounts.length - active }]
                : []),
            ],
            matchingCustomers: matchingCustomers.slice(skip, skip + limit),
            matchingTotal: [{ count: matchingCustomers.length }],
          }];
        },
      ],
    ],
    async () => {
      const request = async (query) => {
        const { status, body } = await invoke(getAllCustomers, {
          user: { userType: "admin" },
          query: { page: "1", limit: "10", ...query },
        });
        assert.equal(status, 200);
        return body.data;
      };

      const all = await request({});
      assert.equal(all.pagination.total, 7);
      assert.equal(all.summary.total, 7);
      assert.deepEqual(
        Object.fromEntries(
          all.customers.map(({ _id, linkedATMCount }) => [
            _id,
            linkedATMCount,
          ]),
        ),
        {
          test: 0,
          customer: 0,
          Kumar: 3,
          "cus-0": 0,
          "test-customer": 9,
          batman2: 0,
          batman: 0,
        },
      );

      const sbi = await request({ bankName: "SBI" });
      assert.equal(sbi.pagination.total, 5);
      assert.equal(sbi.summary.total, 5);
      assert.deepEqual(
        sbi.customers.map(({ _id }) => _id).sort(),
        ["Kumar", "batman", "batman2", "cus-0", "customer"].sort(),
      );
      assert.equal(
        sbi.customers.find(({ _id }) => _id === "Kumar").linkedATMCount,
        3,
      );

      const testCustomers = await request({ bankName: "TEST_BANK_001" });
      assert.equal(testCustomers.pagination.total, 2);
      assert.equal(testCustomers.summary.total, 2);
      assert.deepEqual(
        testCustomers.customers.map(({ _id }) => _id).sort(),
        ["test", "test-customer"].sort(),
      );
      assert.equal(
        testCustomers.customers.find(({ _id }) => _id === "test").linkedATMCount,
        0,
      );
      assert.equal(
        testCustomers.customers.find(({ _id }) => _id === "test-customer")
          .linkedATMCount,
        9,
      );

      const searchAndBank = await request({
        bankName: "SBI",
        search: "Kumar",
      });
      assert.deepEqual(
        searchAndBank.customers.map(({ _id }) => _id),
        ["Kumar"],
      );
      assert.equal(searchAndBank.pagination.total, 1);
      assert.equal(searchAndBank.summary.total, 5);

      const statusAndBank = await request({
        bankName: "SBI",
        status: "inactive",
      });
      assert.deepEqual(
        statusAndBank.customers.map(({ _id }) => _id),
        ["batman2"],
      );
      assert.equal(statusAndBank.summary.total, 5);
      assert.equal(statusAndBank.summary.active, 4);
      assert.equal(statusAndBank.summary.inactive, 1);

      const paginated = await request({
        bankName: "SBI",
        page: "2",
        limit: "2",
      });
      assert.equal(paginated.pagination.page, 2);
      assert.equal(paginated.pagination.limit, 2);
      assert.equal(paginated.pagination.total, 5);
      assert.equal(paginated.pagination.totalPages, 3);

      const atmLookup = lastPipeline.find(
        (stage) => stage.$lookup?.from === ATM.collection.name,
      ).$lookup;
      assert.deepEqual(atmLookup.pipeline[0].$match, {
        isDeleted: false,
        $expr: { $eq: ["$customer", "$$customerId"] },
      });
      assert.equal(
        lastPipeline.some(
          (stage) => stage.$match?.linkedATMCount?.$gt === 0,
        ),
        false,
      );
      assert.deepEqual(lastPipeline[0].$match.bankName.$in, [
        "SBI",
        "State Bank of India",
      ]);
      assert.deepEqual(
        lastPipeline.find((stage) => stage.$facet).$facet.total,
        [{ $count: "count" }],
      );
    },
  );
});

test("legacy bankId customer-list filters resolve to Customer.bankName values", async () => {
  const bankId = "64b000000000000000000005";
  let pipeline;

  await withOverrides(
    [
      [
        Bank,
        "findById",
        (id) => {
          assert.equal(id, bankId);
          return queryChain({
            bankCode: "SBI",
            bankName: "State Bank of India",
          });
        },
      ],
      [
        Customer,
        "aggregate",
        async (value) => {
          pipeline = value;
          return paginatedAggregateResult([]);
        },
      ],
    ],
    async () => {
      const { status } = await invoke(getAllCustomers, {
        user: { userType: "admin" },
        query: { bankId, page: "1", limit: "10" },
      });

      assert.equal(status, 200);
      assert.deepEqual(pipeline[0].$match, {
        isDeleted: false,
        bankName: { $in: ["SBI", "State Bank of India"] },
      });
      const atmLookup = pipeline.find(
        (stage) => stage.$lookup?.from === ATM.collection.name,
      ).$lookup;
      assert.deepEqual(atmLookup.pipeline[0].$match, {
        isDeleted: false,
        $expr: { $eq: ["$customer", "$$customerId"] },
      });
    },
  );
});

test("Customer workspace jobs remain available through the existing customerId filter", async () => {
  const jobs = [
    { jobNumber: "JOB-20261005-R-9670D490", atmId: "ATM0015" },
    { jobNumber: "JOB-20261005-R-4F7733AB", atmId: "ATM0016" },
    { jobNumber: "JOB-20261005-R-5CCD6B0D", atmId: "ATM0013" },
    { jobNumber: "JOB-20261004-R-00405566", atmId: "ATM0013" },
  ];
  let jobFilter;
  await withOverrides(
    [
      [
        Job,
        "find",
        (filter) => {
          jobFilter = filter;
          return queryChain(jobs);
        },
      ],
      [
        Job,
        "countDocuments",
        async (filter) => {
          assert.deepEqual(filter, jobFilter);
          return jobs.length;
        },
      ],
    ],
    async () => {
      const { status, body } = await invoke(getAllJobs, {
        user: { userType: "admin" },
        query: {
          customerId,
          page: "1",
          limit: "10",
        },
      });

      assert.equal(status, 200);
      assert.deepEqual(jobFilter, {
        isDeleted: false,
        customerId,
      });
      assert.deepEqual(body.data.jobs, jobs);
      assert.equal(body.data.pagination.total, 4);
    },
  );
});

test("Customer create and update schemas validate fields and ObjectIds without stripping atmIds", () => {
  const validCreate = createCustomerSchema.safeParse({
    firstName: "Example",
    email: "example@example.com",
    password: "password123",
    phoneNumber: "1234567890",
    bankName: "Example Bank",
    districtIds: [districtId],
  });
  const invalidCreate = createCustomerSchema.safeParse({
    firstName: "Example",
    email: "example@example.com",
    password: "password123",
    phoneNumber: "1234567890",
    bankName: "Example Bank",
    districtIds: ["not-an-object-id"],
  });
  const validUpdate = updateCustomerSchema.safeParse({
    customerName: "Example",
    districtIds: [districtId],
    atmIds: ["attempted-direct-assignment"],
  });
  const invalidUpdate = updateCustomerSchema.safeParse({
    districtIds: ["not-an-object-id"],
  });

  assert.equal(validCreate.success, true);
  assert.equal(invalidCreate.success, false);
  assert.equal(validUpdate.success, true);
  if (validUpdate.success) {
    assert.deepEqual(validUpdate.data.atmIds, ["attempted-direct-assignment"]);
  }
  assert.equal(invalidUpdate.success, false);
});
