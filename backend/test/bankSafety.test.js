import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import Bank from "../src/modules/banks/bank.model.js";
import { deleteBank, updateBank } from "../src/modules/banks/bank.controller.js";
import District from "../src/modules/districts/district.models.js";
import { withGeographyFence } from "../src/modules/districts/districtGeography.service.js";
import Region from "../src/modules/region/region.model.js";

const bankId = "64b000000000000000000001";
const userId = "64b000000000000000000002";

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

const withOverrides = async (overrides, callback) => {
  const originals = overrides.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    return await callback();
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
};

const makeQuery = (value) => ({
  select() {
    return this;
  },
  session(session) {
    this.transactionSession = session;
    return this;
  },
  lean() {
    return Promise.resolve(value);
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const isConflict = (message) => (error) =>
  error.statusCode === 409 && message.test(error.message);

const createHarness = ({ region, district, atm } = {}) => {
  const state = {
    bank: { _id: bankId, isActive: true },
    savedWithSession: null,
  };
  const calls = [];
  const session = {
    async withTransaction(operation) {
      const before = structuredClone(state);
      try {
        return await operation(this);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
    async endSession() {},
  };
  const queryResult = (record, filter) => {
    if (record === null) return null;
    if (filter.isActive === true && record.isActive !== true) return null;
    if (
      filter.isDeleted?.$ne === true &&
      record.isDeleted === true
    ) {
      return null;
    }
    return { _id: record._id };
  };
  const overrides = [
    [mongoose, "startSession", async () => session],
    [
      Bank,
      "updateOne",
      async (filter, update, options) => {
        calls.push({ type: "bank-fence", filter, update, options });
        return { matchedCount: filter._id === bankId ? 1 : 0 };
      },
    ],
    [
      Bank,
      "findById",
      (id) =>
        makeQuery(
          id === bankId
            ? {
                ...state.bank,
                async save(options) {
                  this.isActive = false;
                  state.bank.isActive = false;
                  state.savedWithSession = options.session;
                },
              }
            : null,
        ),
    ],
    ...[
      [Region, region],
      [District, district],
      [ATM, atm],
    ].map(([Model, record]) => [
      Model,
      "findOne",
      (filter) => {
        calls.push({ type: "child-query", Model, filter });
        return makeQuery(queryResult(record ?? null, filter));
      },
    ]),
  ];
  return { calls, overrides, session, state };
};

const bankRequest = {
  params: { id: bankId },
  body: { isActive: false },
  user: { _id: userId },
};

for (const [label, field] of [
  ["active Region", "region"],
  ["active District", "district"],
]) {
  test(`Bank DELETE is blocked by an ${label}`, async () => {
    const record = { _id: "child", isActive: true };
    const { overrides } = createHarness({ [field]: record });
    await withOverrides(overrides, () =>
      assert.rejects(
        invoke(deleteBank, bankRequest),
        isConflict(/Cannot deactivate the Bank/),
      ),
    );
  });

  test(`Bank PUT deactivation is blocked by an ${label}`, async () => {
    const record = { _id: "child", isActive: true };
    const { overrides } = createHarness({ [field]: record });
    await withOverrides(overrides, () =>
      assert.rejects(
        invoke(updateBank, bankRequest),
        isConflict(/Cannot deactivate the Bank/),
      ),
    );
  });
}

for (const [status, atm] of [
  ["active", { _id: "atm-active", isDeleted: false, status: "ACTIVE" }],
  ["inactive", { _id: "atm-inactive", isDeleted: false, status: "INACTIVE" }],
  ["REMOVED", { _id: "atm-removed", isDeleted: false, status: "REMOVED" }],
  ["legacy", { _id: "atm-legacy", status: "ACTIVE" }],
]) {
  test(`Bank deactivation is blocked by a non-deleted ${status} ATM`, async () => {
    const { calls, overrides } = createHarness({ atm });
    await withOverrides(overrides, () =>
      assert.rejects(
        invoke(updateBank, bankRequest),
        isConflict(/Cannot deactivate the Bank while non-deleted ATMs are linked/),
      ),
    );
    const atmQuery = calls.find((call) => call.Model === ATM);
    assert.deepEqual(atmQuery.filter, {
      bankId,
      isDeleted: { $ne: true },
    });
  });
}

test("Bank DELETE ignores explicitly deleted ATMs", async () => {
  const { overrides, state, session } = createHarness({
    atm: { _id: "atm-deleted", isDeleted: true, status: "REMOVED" },
  });
  const response = await withOverrides(overrides, () =>
    invoke(deleteBank, bankRequest),
  );
  assert.equal(response.status, 200);
  assert.equal(state.bank.isActive, false);
  assert.equal(state.savedWithSession, session);
});

test("Bank deactivation succeeds when descendants are inactive or deleted", async () => {
  const { overrides, state } = createHarness({
    region: { _id: "inactive-region", isActive: false },
    district: { _id: "inactive-district", isActive: false },
    atm: { _id: "atm-deleted", isDeleted: true },
  });
  const response = await withOverrides(overrides, () =>
    invoke(updateBank, bankRequest),
  );
  assert.equal(response.status, 200);
  assert.equal(state.bank.isActive, false);
});

test("geography fences acquire sorted Bank, Region, then District IDs", async () => {
  const ids = [
    "64b000000000000000000011",
    "64b000000000000000000010",
  ];
  const order = [];
  const session = {
    async withTransaction(operation) {
      return operation(this);
    },
    async endSession() {},
  };
  const overrides = [
    [mongoose, "startSession", async () => session],
    ...[
      [Bank, "bank"],
      [Region, "region"],
      [District, "district"],
    ].map(([Model, type]) => [
      Model,
      "updateOne",
      async (filter) => {
        order.push(`${type}:${filter._id}`);
        return { matchedCount: 1 };
      },
    ]),
  ];

  await withOverrides(overrides, () =>
    withGeographyFence(
      { bankIds: ids, regionIds: ids, districtIds: ids },
      async () => {},
    ),
  );

  assert.deepEqual(order, [
    `bank:${ids[1]}`,
    `bank:${ids[0]}`,
    `region:${ids[1]}`,
    `region:${ids[0]}`,
    `district:${ids[1]}`,
    `district:${ids[0]}`,
  ]);
});
