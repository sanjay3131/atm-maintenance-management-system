import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AMC from "../src/modules/amc/amc.model.js";
import { AMC_STATUS } from "../src/modules/amc/amc.config.js";
import ATM from "../src/modules/atms/atm.model.js";
import { createATM, updateATM } from "../src/modules/atms/atm.controller.js";
import Customer from "../src/modules/customers/customer.model.js";
import District from "../src/modules/districts/district.models.js";
import Employee from "../src/modules/employees/employee.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import RecurringMaintenancePlan from "../src/modules/jobs/recurringMaintenancePlan.model.js";
import Region from "../src/modules/region/region.model.js";
import { JOB_STATUS } from "../src/utils/jobStatus.js";
import { createAtmSchema, updateAtmSchema } from "../src/modules/atms/atm.validation.js";

const districtId = "64b000000000000000000001";
const otherDistrictId = "64b000000000000000000002";
const regionId = "64b000000000000000000003";
const otherRegionId = "64b000000000000000000004";
const atmId = "64b000000000000000000005";
const employeeId = "64b000000000000000000006";

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

function createMocks({
  districts = { [districtId]: { _id: districtId, isActive: true } },
  regions = {
    [regionId]: {
      _id: regionId,
      districtId,
      isActive: true,
    },
  },
  activeRegionCount = 1,
  customer = { _id: "customer-id", isActive: true, isDeleted: false },
} = {}) {
  const captured = {};
  const overrides = [
    [
      District,
      "findById",
      async (id) => districts[id.toString()] ?? null,
    ],
    [
      Region,
      "findById",
      async (id) => regions[id.toString()] ?? null,
    ],
    [Region, "countDocuments", async () => activeRegionCount],
    [
      Customer,
      "findOne",
      () => ({
        session() {
          return Promise.resolve(
            customer && {
              ...customer,
            atmIds: [],
            async save() {
              captured.customer = this;
            },
            },
          );
        },
      }),
    ],
    [
      ATM,
      "findOne",
      () => ({
        sort() {
          return this;
        },
        select: async () => null,
      }),
    ],
    [
      ATM,
      "create",
      async ([data]) => {
        const created = {
          ...data,
          _id: atmId,
          async save() {
            captured.savedATM = this;
          },
        };
        captured.created = created;
        return [created];
      },
    ],
    [
      Customer,
      "updateMany",
      async (...args) => {
        captured.customerCleanup = args;
      },
    ],
    [
      mongoose,
      "startSession",
      async () => ({
        async withTransaction(operation) {
          try {
            return await operation(this);
          } catch (error) {
            delete captured.created;
            delete captured.savedATM;
            delete captured.customer;
            throw error;
          }
        },
        async endSession() {},
      }),
    ],
    [
      ATM,
      "findById",
      async () => ({
        _id: atmId,
        isDeleted: false,
        districtId,
        regionId,
        assignedEmployeeId: [employeeId],
      }),
    ],
    [
      ATM,
      "findByIdAndUpdate",
      async (_id, update, options) => {
        captured.update = { update, options };
        return { _id: atmId, ...update };
      },
    ],
    [Job, "countDocuments", async (query) => {
      captured.jobQuery = query;
      return 0;
    }],
    [AMC, "countDocuments", async (query) => {
      captured.amcQuery = query;
      return 0;
    }],
    [RecurringMaintenancePlan, "countDocuments", async (query) => {
      captured.planQuery = query;
      return 0;
    }],
    [
      Employee,
      "updateMany",
      async () => {
        captured.employeeUpdateMany = true;
      },
    ],
    [
      Employee,
      "updateOne",
      async () => {
        captured.employeeUpdateOne = true;
      },
    ],
  ];
  return { captured, overrides };
}

const createBody = (changes = {}) => ({
  bankId: "bank-id",
  customerId: "customer-id",
  districtId,
  regionId,
  locationName: "Main Street",
  address: "1 Main Street",
  installationType: "ONSITE",
  ...changes,
});

test("rejects ATM creation with an invalid Customer without committing a partial ATM", async () => {
  const { captured, overrides } = createMocks({ customer: null });
  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(createATM, {
        body: createBody(),
        user: { _id: "admin-id" },
      }),
      /Customer not found/,
    );
  });
  assert.equal(captured.created, undefined);
  assert.equal(captured.customer, undefined);
});

function updateRequest(body) {
  return {
    params: { id: atmId },
    body,
    user: { _id: "admin-id" },
  };
}

test("create validation accepts an explicit null Region and validates IDs", () => {
  assert.equal(createAtmSchema.safeParse(createBody({ regionId: null })).success, true);
  assert.equal(
    createAtmSchema.safeParse(createBody({ districtId: "invalid" })).success,
    false,
  );
  assert.equal(
    updateAtmSchema.safeParse({ regionId: null }).success,
    true,
  );
});

test("creates an ATM with an active District and its active Region", async () => {
  const { captured, overrides } = createMocks();
  await withOverrides(overrides, async () => {
    const { status, body } = await invoke(createATM, {
      body: createBody(),
      user: { _id: "admin-id" },
    });
    assert.equal(status, 201);
    assert.equal(body.data.districtId, districtId);
    assert.equal(body.data.regionId, regionId);
    assert.equal(captured.created.regionId, regionId);
    assert.equal(captured.savedATM.customer, "customer-id");
    assert.deepEqual(captured.customer.atmIds, [atmId]);
  });
});

test("rejects inactive or missing destination Districts and Regions", async (t) => {
  const scenarios = [
    {
      name: "inactive District",
      districts: { [districtId]: { _id: districtId, isActive: false } },
      regions: {},
      body: createBody(),
      message: "Destination district is inactive",
    },
    {
      name: "missing District",
      districts: {},
      regions: {},
      body: createBody(),
      message: "Destination district was not found",
    },
    {
      name: "missing Region",
      districts: undefined,
      regions: {},
      body: createBody(),
      message: "Destination region was not found",
    },
    {
      name: "inactive Region",
      districts: undefined,
      regions: {
        [regionId]: { _id: regionId, districtId, isActive: false },
      },
      body: createBody(),
      message: "Destination region is inactive",
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const { overrides } = createMocks(scenario);
      await withOverrides(overrides, async () => {
        await assert.rejects(
          invoke(createATM, {
            body: scenario.body,
            user: { _id: "admin-id" },
          }),
          (error) => error.message === scenario.message,
        );
      });
    });
  }
});

test("rejects a Region from a different District", async () => {
  const { overrides } = createMocks({
    regions: {
      [regionId]: {
        _id: regionId,
        districtId: otherDistrictId,
        isActive: true,
      },
    },
  });
  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(createATM, {
        body: createBody(),
        user: { _id: "admin-id" },
      }),
      (error) =>
        error.message ===
        "Destination region does not belong to the selected district",
    );
  });
});

test("allows a Region-less ATM only when the District has no active Regions", async (t) => {
  await t.test("District has none", async () => {
    const { captured, overrides } = createMocks({ activeRegionCount: 0 });
    await withOverrides(overrides, async () => {
      const { body } = await invoke(createATM, {
        body: createBody({ regionId: null }),
        user: { _id: "admin-id" },
      });
      assert.equal(body.data.regionId, null);
      assert.equal(captured.created.regionId, null);
    });
  });

  await t.test("District has active Regions", async () => {
    const { overrides } = createMocks({ activeRegionCount: 2 });
    await withOverrides(overrides, async () => {
      await assert.rejects(
        invoke(createATM, {
          body: createBody({ regionId: null }),
          user: { _id: "admin-id" },
        }),
        (error) =>
          error.message ===
          "Select an active region because this district has active regions",
      );
    });
  });
});

test("partial geographic updates validate the effective District and Region", async (t) => {
  await t.test("changing only Region validates it against the existing District", async () => {
    const { captured, overrides } = createMocks({
      regions: {
        [otherRegionId]: {
          _id: otherRegionId,
          districtId,
          isActive: true,
        },
      },
    });
    await withOverrides(overrides, async () => {
      await invoke(updateATM, updateRequest({ regionId: otherRegionId }));
      assert.equal(captured.update.update.regionId, otherRegionId);
      assert.equal(captured.update.update.districtId, undefined);
    });
  });

  await t.test("changing only District never carries the old Region across", async () => {
    const { captured, overrides } = createMocks({
      districts: {
        [districtId]: { _id: districtId, isActive: true },
        [otherDistrictId]: { _id: otherDistrictId, isActive: true },
      },
      activeRegionCount: 0,
    });
    await withOverrides(overrides, async () => {
      await invoke(
        updateATM,
        updateRequest({ districtId: otherDistrictId }),
      );
      assert.equal(captured.update.update.districtId, otherDistrictId);
      assert.equal(captured.update.update.regionId, null);
    });
  });

  await t.test("changing only District with active Regions requires an explicit Region", async () => {
    const { overrides } = createMocks({
      districts: {
        [districtId]: { _id: districtId, isActive: true },
        [otherDistrictId]: { _id: otherDistrictId, isActive: true },
      },
      activeRegionCount: 1,
    });
    await withOverrides(overrides, async () => {
      await assert.rejects(
        invoke(
          updateATM,
          updateRequest({ districtId: otherDistrictId }),
        ),
        (error) =>
          error.message ===
          "Select an active region because this district has active regions",
      );
    });
  });

  await t.test("clearing Region is allowed only when the District has no active Regions", async (t) => {
    await t.test("District has none", async () => {
      const { captured, overrides } = createMocks({ activeRegionCount: 0 });
      await withOverrides(overrides, async () => {
        await invoke(updateATM, updateRequest({ regionId: null }));
        assert.equal(captured.update.update.regionId, null);
      });
    });

    await t.test("District has an active Region", async () => {
      const { overrides } = createMocks({ activeRegionCount: 1 });
      await withOverrides(overrides, async () => {
        await assert.rejects(
          invoke(updateATM, updateRequest({ regionId: null })),
          (error) =>
            error.message ===
            "Select an active region because this district has active regions",
        );
      });
    });
  });
});

test("geographic move preserves employee assignment and reciprocal relationship records", async () => {
  const { captured, overrides } = createMocks({
    regions: {
      [otherRegionId]: {
        _id: otherRegionId,
        districtId,
        isActive: true,
      },
    },
  });
  await withOverrides(overrides, async () => {
    await invoke(updateATM, updateRequest({ regionId: otherRegionId }));
    assert.equal(captured.update.update.assignedEmployeeId, undefined);
    assert.equal(captured.employeeUpdateMany, undefined);
    assert.equal(captured.employeeUpdateOne, undefined);
  });
});

test("blocks moves with unresolved Jobs, AMC records, or active recurring plans", async (t) => {
  const cases = [
    {
      name: "unresolved Job",
      counts: { jobs: 1 },
      message: "1 unresolved job(s)",
    },
    {
      name: "unresolved AMC",
      counts: { amcs: 1 },
      message: "1 unresolved AMC record(s)",
    },
    {
      name: "active recurring plan",
      counts: { plans: 1 },
      message: "1 active recurring maintenance plan(s)",
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { captured, overrides } = createMocks({
        regions: {
          [otherRegionId]: {
            _id: otherRegionId,
            districtId,
            isActive: true,
          },
        },
      });
      overrides.find(([target, key]) => target === Job && key === "countDocuments")[2] =
        async (query) => {
          captured.jobQuery = query;
          return scenario.counts.jobs ?? 0;
        };
      overrides.find(([target, key]) => target === AMC && key === "countDocuments")[2] =
        async (query) => {
          captured.amcQuery = query;
          return scenario.counts.amcs ?? 0;
        };
      overrides.find(
        ([target, key]) =>
          target === RecurringMaintenancePlan && key === "countDocuments",
      )[2] = async (query) => {
        captured.planQuery = query;
        return scenario.counts.plans ?? 0;
      };
      await withOverrides(overrides, async () => {
        await assert.rejects(
          invoke(updateATM, updateRequest({ regionId: otherRegionId })),
          (error) =>
            error.statusCode === 409 && error.message.includes(scenario.message),
        );
        if (scenario.counts.jobs) {
          assert.equal(captured.jobQuery.status.$ne, JOB_STATUS.CLOSED);
        }
        if (scenario.counts.amcs) {
          assert.deepEqual(captured.amcQuery.status.$in, [
            AMC_STATUS.PENDING,
            AMC_STATUS.IN_PROGRESS,
            AMC_STATUS.OVERDUE,
          ]);
        }
        if (scenario.counts.plans) {
          assert.equal(captured.planQuery.isActive, true);
        }
      });
    });
  }
});

test("normal non-geographic ATM updates continue without geography or workload checks", async () => {
  const { captured, overrides } = createMocks();
  await withOverrides(overrides, async () => {
    await invoke(updateATM, updateRequest({ locationName: "Updated location" }));
    assert.equal(captured.update.update.locationName, "Updated location");
    assert.equal(captured.jobQuery, undefined);
    assert.equal(captured.amcQuery, undefined);
    assert.equal(captured.planQuery, undefined);
  });
});
