import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import AMC from "../src/modules/amc/amc.model.js";
import { AMC_STATUS } from "../src/modules/amc/amc.config.js";
import ATM from "../src/modules/atms/atm.model.js";
import ATMIdSequence from "../src/modules/atms/atmIdSequence.model.js";
import { createATM, updateATM } from "../src/modules/atms/atm.controller.js";
import Bank from "../src/modules/banks/bank.model.js";
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
const bankId = "bank-id";

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

function makeQuery(value) {
  return {
    select() {
      return this;
    },
    session() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function createMocks({
  districts = {
    [districtId]: {
      _id: districtId,
      bankId,
      regionId,
      geographyStatus: "MAPPED",
      isActive: true,
    },
    [otherDistrictId]: {
      _id: otherDistrictId,
      bankId,
      regionId: otherRegionId,
      geographyStatus: "MAPPED",
      isActive: true,
    },
  },
  regions = {
    [regionId]: {
      _id: regionId,
      bankId,
      geographyStatus: "MAPPED",
      isActive: true,
    },
    [otherRegionId]: {
      _id: otherRegionId,
      bankId,
      geographyStatus: "MAPPED",
      isActive: true,
    },
  },
  customer = { _id: "customer-id", isActive: true, isDeleted: false },
  atmCreateError,
} = {}) {
  const captured = {};
  const sequenceState = { value: 0 };
  const overrides = [
    [
      Bank,
      "findById",
      () => makeQuery({ _id: bankId, isActive: true }),
    ],
    [
      District,
      "findById",
      (id) => makeQuery(districts[String(id)] ?? null),
    ],
    [
      Region,
      "findById",
      (id) => makeQuery(regions[String(id)] ?? null),
    ],
    [
      District,
      "updateOne",
      async () => ({ matchedCount: 1 }),
    ],
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
      ATMIdSequence,
      "findOneAndUpdate",
      async (filter, update, options) => {
        captured.sequenceReservation = { filter, update, options };
        sequenceState.value += update.$inc.value;
        return { value: sequenceState.value };
      },
    ],
    [
      ATM,
      "findOne",
      (filter) => {
        if (filter?._id) {
          return makeQuery({
            _id: atmId,
            bankId,
            isDeleted: false,
            districtId,
            regionId,
            assignedEmployeeId: [employeeId],
            async save() {
              captured.savedATM = this;
            },
          });
        }
        return {
          sort() {
            return this;
          },
          select: async () => null,
        };
      },
    ],
    [
      ATM,
      "create",
      async ([data], options) => {
        if (atmCreateError) throw atmCreateError;
        captured.atmCreateOptions = options;
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
      async () => {
        const session = {
          async withTransaction(operation) {
            const sequenceBeforeTransaction = sequenceState.value;
            captured.transactionSession = session;
            try {
              return await operation(session);
            } catch (error) {
              sequenceState.value = sequenceBeforeTransaction;
              delete captured.created;
              delete captured.savedATM;
              delete captured.customer;
              throw error;
            }
          },
          async endSession() {},
        };
        return session;
      },
    ],
    [
      ATM,
      "findById",
      async () => ({
        _id: atmId,
        bankId,
        isDeleted: false,
        districtId,
        regionId,
        geographyStatus: "MAPPED",
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
    [Job, "countDocuments", (query) => {
      captured.jobQuery = query;
      return makeQuery(0);
    }],
    [AMC, "countDocuments", (query) => {
      captured.amcQuery = query;
      return makeQuery(0);
    }],
    [RecurringMaintenancePlan, "countDocuments", (query) => {
      captured.planQuery = query;
      return makeQuery(0);
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
  return { captured, overrides, sequenceState };
}

const createBody = (changes = {}) => ({
  clientAtmId: "CLIENT-ATM-001",
  bankId,
  customerId: "customer-id",
  districtId,
  regionId,
  locationName: "Main Street",
  city: "Chennai",
  address: "1 Main Street",
  installationType: "ONSITE",
  ...changes,
});

test("rejects ATM creation with an invalid Customer without committing a partial ATM", async () => {
  const { captured, overrides, sequenceState } = createMocks({ customer: null });
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
  assert.equal(sequenceState.value, 0);
});

test("rolls back the sequence reservation when ATM creation fails", async () => {
  const { captured, overrides, sequenceState } = createMocks({
    atmCreateError: new Error("ATM create failed"),
  });

  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(createATM, {
        body: createBody(),
        user: { _id: "admin-id" },
      }),
      /ATM create failed/,
    );
  });

  assert.equal(sequenceState.value, 0);
  assert.equal(captured.created, undefined);
});

function updateRequest(body) {
  return {
    params: { id: atmId },
    body,
    user: { _id: "admin-id" },
  };
}

test("ATM validation requires a Region and validates geographic IDs", () => {
  assert.equal(createAtmSchema.safeParse(createBody({ regionId: null })).success, false);
  assert.equal(
    createAtmSchema.safeParse(createBody({ districtId: "invalid" })).success,
    false,
  );
  assert.equal(
    updateAtmSchema.safeParse({ regionId: null }).success,
    false,
  );
});

test("ATM city is required and trimmed on create, optional and validated on update", () => {
  const validCreateBody = createBody({ bankId: atmId, city: "  Chennai  " });
  assert.equal(createAtmSchema.parse(validCreateBody).city, "Chennai");

  const createWithoutCity = { ...validCreateBody };
  delete createWithoutCity.city;
  assert.equal(createAtmSchema.safeParse(createWithoutCity).success, false);
  assert.equal(
    createAtmSchema.safeParse({ ...validCreateBody, city: "   " }).success,
    false,
  );

  assert.equal(updateAtmSchema.safeParse({}).success, true);
  assert.equal(updateAtmSchema.parse({ city: "  Madurai  " }).city, "Madurai");
  assert.equal(updateAtmSchema.safeParse({ city: "   " }).success, false);
});

test("client ATM IDs are required on create and normalized on create and update", async () => {
  const validCreateBody = createBody({ bankId: atmId });
  const parsedCreate = createAtmSchema.parse(
    { ...validCreateBody, clientAtmId: "  client-atm-002  " },
  );
  assert.equal(parsedCreate.clientAtmId, "CLIENT-ATM-002");

  const createWithoutClientAtmId = { ...validCreateBody };
  delete createWithoutClientAtmId.clientAtmId;
  assert.equal(
    createAtmSchema.safeParse(createWithoutClientAtmId).success,
    false,
  );
  assert.equal(
    createAtmSchema.safeParse({
      ...validCreateBody,
      clientAtmId: "   ",
    }).success,
    false,
  );

  assert.equal(updateAtmSchema.safeParse({}).success, true);
  assert.equal(
    updateAtmSchema.parse({ clientAtmId: " client-atm-003 " }).clientAtmId,
    "CLIENT-ATM-003",
  );
  assert.equal(
    updateAtmSchema.safeParse({ clientAtmId: " " }).success,
    false,
  );

  const legacyATM = new ATM({
    atmId: "ATM0001",
    customer: new mongoose.Types.ObjectId(),
    locationName: "Legacy location",
    address: "Legacy address",
    installationType: "ONSITE",
    createdBy: new mongoose.Types.ObjectId(),
  });
  await assert.doesNotReject(legacyATM.validate());
  assert.equal(legacyATM.city, undefined);

  const emptyClientIdATM = new ATM({
    ...legacyATM.toObject(),
    clientAtmId: "  ",
  });
  await assert.rejects(
    emptyClientIdATM.validate(),
    (error) => Boolean(error.errors.clientAtmId),
  );

  const clientAtmIdIndex = ATM.schema
    .indexes()
    .find(([, options]) => options.name === "uniq_atm_client_atm_id");
  assert.deepEqual(clientAtmIdIndex?.[0], { clientAtmId: 1 });
  assert.equal(clientAtmIdIndex?.[1].unique, true);
  assert.deepEqual(clientAtmIdIndex?.[1].partialFilterExpression, {
    clientAtmId: { $type: "string" },
  });
});

test("creates an ATM with an active District and its active Region", async () => {
  const { captured, overrides, sequenceState } = createMocks();
  await withOverrides(overrides, async () => {
    const { status, body } = await invoke(createATM, {
      body: createBody(),
      user: { _id: "admin-id" },
    });
    assert.equal(status, 201);
    assert.equal(body.data.districtId, districtId);
    assert.equal(body.data.regionId, regionId);
    assert.equal(captured.created.regionId, regionId);
    assert.equal(captured.created.clientAtmId, "CLIENT-ATM-001");
    assert.equal(captured.created.atmId, "ATM0001");
    assert.equal(captured.created.city, "Chennai");
    assert.equal(captured.savedATM.customer, "customer-id");
    assert.deepEqual(captured.customer.atmIds, [atmId]);
    assert.strictEqual(
      captured.sequenceReservation.options.session,
      captured.transactionSession,
    );
    assert.strictEqual(
      captured.atmCreateOptions.session,
      captured.transactionSession,
    );
    assert.equal(sequenceState.value, 1);
  });
});

test("maps duplicate client ATM IDs on creation to a conflict", async () => {
  const { captured, overrides, sequenceState } = createMocks({
    atmCreateError: {
      code: 11000,
      keyPattern: { clientAtmId: 1 },
    },
  });

  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(createATM, {
        body: createBody(),
        user: { _id: "admin-id" },
      }),
      (error) =>
        error.statusCode === 409 &&
        error.message === "Client ATM ID already exists",
    );
  });
  assert.equal(captured.created, undefined);
  assert.equal(sequenceState.value, 0);
});

test("preserves duplicate ATM ID errors from ATM creation", async () => {
  const duplicateATMIdError = {
    code: 11000,
    keyPattern: { atmId: 1 },
  };
  const { captured, overrides, sequenceState } = createMocks({
    atmCreateError: duplicateATMIdError,
  });

  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(createATM, {
        body: createBody(),
        user: { _id: "admin-id" },
      }),
      (error) => error === duplicateATMIdError,
    );
  });

  assert.equal(captured.created, undefined);
  assert.equal(sequenceState.value, 0);
});

test("maps duplicate client ATM IDs on update to a conflict", async () => {
  const { overrides } = createMocks();
  overrides.push([
    ATM,
    "findByIdAndUpdate",
    async () => {
      throw {
        code: 11000,
        keyPattern: { clientAtmId: 1 },
      };
    },
  ]);

  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(updateATM, updateRequest({ clientAtmId: "CLIENT-ATM-001" })),
      (error) =>
        error.statusCode === 409 &&
        error.message === "Client ATM ID already exists",
    );
  });
});

test("rejects inactive or missing destination Districts and Regions", async (t) => {
  const scenarios = [
    {
      name: "inactive District",
      districts: {
        [districtId]: {
          _id: districtId,
          bankId,
          regionId,
          geographyStatus: "MAPPED",
          isActive: false,
        },
      },
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
        [regionId]: {
          _id: regionId,
          bankId,
          geographyStatus: "MAPPED",
          isActive: false,
        },
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
        bankId,
        geographyStatus: "MAPPED",
        isActive: true,
      },
    },
    districts: {
      [districtId]: {
        _id: districtId,
        bankId,
        regionId: otherRegionId,
        geographyStatus: "MAPPED",
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
        "Selected district does not belong to the selected region",
    );
  });
});

test("ATM creation rejects a missing Region", async () => {
  const { overrides } = createMocks({ regions: {} });
  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(createATM, {
        body: createBody({ regionId: null }),
        user: { _id: "admin-id" },
      }),
      /Destination region was not found/,
    );
  });
});

test("partial geographic updates validate the effective District and Region", async (t) => {
  await t.test("changing only Region is rejected when District belongs elsewhere", async () => {
    const { overrides } = createMocks();
    await withOverrides(overrides, async () => {
      await assert.rejects(
        invoke(updateATM, updateRequest({ regionId: otherRegionId })),
        /Selected district does not belong to the selected region/,
      );
    });
  });

  await t.test("changing only District is rejected when its parent Region differs", async () => {
    const { overrides } = createMocks();
    await withOverrides(overrides, async () => {
      await assert.rejects(
        invoke(updateATM, updateRequest({ districtId: otherDistrictId })),
        /Selected district does not belong to the selected region/,
      );
    });
  });

  await t.test("changing District and Region together validates the full hierarchy", async () => {
    const { captured, overrides } = createMocks();
    await withOverrides(overrides, async () => {
      await invoke(
        updateATM,
        updateRequest({
          districtId: otherDistrictId,
          regionId: otherRegionId,
        }),
      );
      assert.equal(captured.savedATM.districtId, otherDistrictId);
      assert.equal(captured.savedATM.regionId, otherRegionId);
    });
  });

  await t.test("clearing Region is rejected", async () => {
    const { overrides } = createMocks();
    await withOverrides(overrides, async () => {
      await assert.rejects(
        invoke(updateATM, updateRequest({ regionId: null })),
        /Destination region was not found/,
      );
    });
  });
});

test("geographic move preserves employee assignment and reciprocal relationship records", async () => {
  const { captured, overrides } = createMocks();
  await withOverrides(overrides, async () => {
    await invoke(
      updateATM,
      updateRequest({ districtId: otherDistrictId, regionId: otherRegionId }),
    );
    assert.equal(captured.savedATM.assignedEmployeeId[0], employeeId);
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
        regions: undefined,
      });
      overrides.find(([target, key]) => target === Job && key === "countDocuments")[2] =
        (query) => {
          captured.jobQuery = query;
          return makeQuery(scenario.counts.jobs ?? 0);
        };
      overrides.find(([target, key]) => target === AMC && key === "countDocuments")[2] =
        (query) => {
          captured.amcQuery = query;
          return makeQuery(scenario.counts.amcs ?? 0);
        };
      overrides.find(
        ([target, key]) =>
          target === RecurringMaintenancePlan && key === "countDocuments",
      )[2] = (query) => {
        captured.planQuery = query;
        return makeQuery(scenario.counts.plans ?? 0);
      };
      await withOverrides(overrides, async () => {
        await assert.rejects(
          invoke(
            updateATM,
            updateRequest({
              districtId: otherDistrictId,
              regionId: otherRegionId,
            }),
          ),
          (error) =>
            error.statusCode === 409 && error.message.includes(scenario.message),
        );
        if (scenario.counts.jobs) {
          assert.deepEqual(captured.jobQuery.status.$nin, [
            JOB_STATUS.CLOSED,
            JOB_STATUS.CANCELLED,
          ]);
          assert.equal(captured.jobQuery.status.$ne, undefined);
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
    await invoke(
      updateATM,
      updateRequest({ locationName: "Updated location", city: "Coimbatore" }),
    );
    assert.equal(captured.update.update.locationName, "Updated location");
    assert.equal(captured.update.update.city, "Coimbatore");
    assert.equal(captured.jobQuery, undefined);
    assert.equal(captured.amcQuery, undefined);
    assert.equal(captured.planQuery, undefined);
  });
});
