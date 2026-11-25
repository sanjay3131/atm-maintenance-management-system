import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import Bank from "../src/modules/banks/bank.model.js";
import District from "../src/modules/districts/district.models.js";
import Region from "../src/modules/region/region.model.js";
import {
  createDistrict,
  deactivateDistrict,
  updateDistrict,
} from "../src/modules/districts/district.controller.js";

const bankId = "64b000000000000000000001";
const otherBankId = "64b000000000000000000009";
const regionId = "64b000000000000000000002";
const userId = "64b000000000000000000003";

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

const makeReadQuery = (value) => ({
  select() {
    return this;
  },
  session() {
    return this;
  },
  lean() {
    return Promise.resolve(value);
  },
});

const baseOverrides = ({
  existingDistricts = [],
  onCreate = () => {},
  onBankFence = () => {},
  onRegionFence = () => {},
} = {}) => [
  [
    mongoose,
    "startSession",
    async () => ({
      async withTransaction(operation) {
        return operation(this);
      },
      async endSession() {},
    }),
  ],
  [
    Bank,
    "updateOne",
    async (filter, update, options) => {
      onBankFence({ filter, update, options });
      return { matchedCount: 1 };
    },
  ],
  [
    Bank,
    "findById",
    () => ({
      select() {
        return this;
      },
      session() {
        return this;
      },
      then(resolve, reject) {
        return Promise.resolve({ _id: bankId, isActive: true }).then(
          resolve,
          reject,
        );
      },
    }),
  ],
  [
    Region,
    "updateOne",
    async (filter, update, options) => {
      onRegionFence({ filter, update, options });
      return { matchedCount: 1 };
    },
  ],
  [
    Region,
    "findById",
    () => ({
      value: {
        _id: regionId,
        name: "Karur",
        bankId,
        isActive: true,
        geographyStatus: "MAPPED",
      },
      populate() {
        this.value = {
          _id: regionId,
          name: "Karur",
          bankId: { _id: bankId, isActive: true },
          isActive: true,
          geographyStatus: "MAPPED",
        };
        return this;
      },
      session() {
        return this;
      },
      select() {
        return this;
      },
      lean() {
        return Promise.resolve(this.value);
      },
      then(resolve, reject) {
        return Promise.resolve(this.value).then(resolve, reject);
      },
    }),
  ],
  [Region, "find", () => makeReadQuery([{ _id: regionId }, { _id: `${regionId}-other` }])],
  [
    District,
    "find",
    (filter) => ({
      select() {
        return this;
      },
      session() {
        return this;
      },
      lean() {
        return Promise.resolve(
          existingDistricts.filter(
            (existing) =>
              String(existing.bankId) === String(filter.bankId) &&
              existing.geographyStatus === filter.geographyStatus,
          ),
        );
      },
    }),
  ],
  [
    District,
    "create",
    async (documents, options) => {
      const [district] = documents;
      onCreate(district, options);
      return [{ _id: "64b000000000000000000004", ...district }];
    },
  ],
];

const request = {
  body: {
    regionId,
    districtName: "Karur",
    pinCode: "063901",
    state: "Tamil Nadu",
  },
  user: { _id: userId },
};

test("District creation derives Bank and normalized keys and allows the Region's name", async () => {
  let created;
  let createOptions;
  let bankFence;
  let regionFence;
  await withOverrides(
    baseOverrides({
      onCreate: (district, options) => {
        created = district;
        createOptions = options;
      },
      onBankFence: (call) => (bankFence = call),
      onRegionFence: (call) => (regionFence = call),
    }),
    async () => {
      const response = await invoke(createDistrict, request);
      assert.equal(response.status, 201);
    },
  );

  assert.equal(created.bankId, bankId);
  assert.equal(created.regionId, regionId);
  assert.equal(created.districtName, "Karur");
  assert.equal(created.districtNameNormalized, "karur");
  assert.equal(created.pinCode, "063901");
  assert.equal(created.pinCodeNormalized, "063901");
  assert.deepEqual(bankFence.filter, { _id: bankId });
  assert.equal(bankFence.update.$inc.geographyFence, 1);
  assert.deepEqual(regionFence.filter, { _id: regionId });
  assert.equal(
    bankFence.options.session,
    regionFence.options.session,
    "Bank and Region fences must share the creation transaction",
  );
  assert.equal(createOptions.session, regionFence.options.session);
});

test("District creation rejects a normalized duplicate in another Region of the same Bank", async () => {
  const overrides = baseOverrides({
    existingDistricts: [
      {
        _id: "64b000000000000000000010",
        bankId,
        districtName: "KARUR",
        districtNameNormalized: "karur",
        pinCode: "999999",
        pinCodeNormalized: "999999",
        isActive: false,
        geographyStatus: "MAPPED",
      },
    ],
    onCreate: () => assert.fail("duplicate District must not be written"),
  });
  await withOverrides(overrides, async () => {
    await assert.rejects(invoke(createDistrict, request), /District name already exists in this bank/);
  });
});

test("District creation rejects a duplicate PIN in the same Bank", async () => {
  const overrides = baseOverrides({
    existingDistricts: [
      {
        _id: "64b000000000000000000013",
        bankId,
        districtName: "Other district",
        districtNameNormalized: "other district",
        pinCode: "063901",
        pinCodeNormalized: "063901",
        geographyStatus: "MAPPED",
      },
    ],
  });

  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(createDistrict, request),
      /District PIN code already exists in this bank/,
    );
  });
});

test("District creation allows the same normalized name and PIN in another Bank", async () => {
  const overrides = baseOverrides({
    existingDistricts: [
      {
        _id: "64b000000000000000000011",
        bankId: otherBankId,
        regionId: "64b000000000000000000012",
        districtName: "Karur",
        districtNameNormalized: "karur",
        pinCode: "063901",
        pinCodeNormalized: "063901",
        geographyStatus: "MAPPED",
      },
    ],
  });

  await withOverrides(overrides, async () => {
    const response = await invoke(createDistrict, request);
    assert.equal(response.status, 201);
  });
});

test("District creation reports an unknown duplicate index as an index conflict", async () => {
  const overrides = baseOverrides();
  overrides.find(([target, key]) => target === District && key === "create")[2] =
    async () => {
      throw Object.assign(new Error("duplicate key"), {
        code: 11000,
        keyPattern: { districtName: 1 },
      });
    };

  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(createDistrict, request),
      /District index conflict; verify the installed geography indexes/,
    );
  });
});

test("District update recalculates normalized keys without changing parent references", async () => {
  const districtId = "64b000000000000000000005";
  let update;
  const overrides = [
    [
      District,
      "findById",
      async () => ({
        _id: districtId,
        bankId,
        regionId,
        geographyStatus: "MAPPED",
        districtName: "Old name",
        pinCode: "12345",
      }),
    ],
    [
      Region,
      "findById",
      () => ({
        value: {
          _id: regionId,
          bankId: { _id: bankId, isActive: true },
          isActive: true,
          geographyStatus: "MAPPED",
        },
        populate() {
          return Promise.resolve({
            _id: regionId,
            bankId: { _id: bankId, isActive: true },
            isActive: true,
            geographyStatus: "MAPPED",
          });
        },
      }),
    ],
    [Region, "find", () => makeReadQuery([{ _id: regionId }])],
    [District, "find", () => makeReadQuery([])],
    [
      District,
      "findByIdAndUpdate",
      async (id, value) => {
        update = { id, value };
        return { _id: districtId, ...value.$set };
      },
    ],
  ];

  await withOverrides(overrides, async () => {
    const response = await invoke(updateDistrict, {
      params: { id: districtId },
      body: { districtName: " New Name ", pinCode: " 00042 " },
      user: { _id: userId },
    });
    assert.equal(response.status, 200);
  });

  assert.equal(update.id, districtId);
  assert.equal(update.value.$set.districtNameNormalized, "new name");
  assert.equal(update.value.$set.pinCodeNormalized, "00042");
  assert.equal(update.value.$set.regionId, undefined);
  assert.equal(update.value.$set.bankId, undefined);
});

const createDeactivationMocks = ({ linkedATM } = {}) => {
  const district = {
    _id: "64b000000000000000000020",
    bankId,
    regionId,
    geographyStatus: "MAPPED",
    districtName: "Karur",
    pinCode: "063901",
    isActive: true,
  };
  const calls = [];
  const session = {
    async withTransaction(operation) {
      calls.push({ type: "transaction-start" });
      const result = await operation(this);
      calls.push({ type: "transaction-commit" });
      return result;
    },
    async endSession() {
      calls.push({ type: "session-end" });
    },
  };
  const overrides = [
    [
      mongoose,
      "startSession",
      async () => session,
    ],
    [
      Bank,
      "updateOne",
      async (_filter, update, options) => {
        calls.push({
          type: "bank-fence",
          update,
          session: options.session,
        });
        return { matchedCount: 1 };
      },
    ],
    [
      Bank,
      "findById",
      () => ({
        select() {
          return this;
        },
        session() {
          return this;
        },
        then(resolve, reject) {
          return Promise.resolve({ _id: bankId, isActive: true }).then(
            resolve,
            reject,
          );
        },
      }),
    ],
    [
      District,
      "updateOne",
      async (_filter, update, options) => {
        calls.push({
          type: "fence",
          update,
          session: options.session,
        });
        return { matchedCount: 1 };
      },
    ],
    [
      Region,
      "updateOne",
      async (_filter, update, options) => {
        calls.push({
          type: "region-fence",
          update,
          session: options.session,
        });
        return { matchedCount: 1 };
      },
    ],
    [
      District,
      "findById",
      () => ({
        session(value) {
          calls.push({ type: "district-read-session", session: value });
          return this;
        },
        lean() {
          return Promise.resolve(district);
        },
        then(resolve, reject) {
          return Promise.resolve(district).then(resolve, reject);
        },
      }),
    ],
    [
      Region,
      "findById",
      () => ({
        value: {
          _id: regionId,
          bankId: { _id: bankId, isActive: true },
          isActive: true,
          geographyStatus: "MAPPED",
        },
        populate() {
          this.value = {
            _id: regionId,
            bankId: { _id: bankId, isActive: true },
            isActive: true,
            geographyStatus: "MAPPED",
          };
          return this;
        },
        select() {
          return this;
        },
        session() {
          return this;
        },
        then(resolve, reject) {
          return Promise.resolve(this.value).then(resolve, reject);
        },
      }),
    ],
    [Region, "find", () => makeReadQuery([{ _id: regionId }])],
    [District, "find", () => makeReadQuery([])],
    [
      ATM,
      "findOne",
      (filter) => ({
        select() {
          calls.push({ type: "atm-filter", filter });
          return this;
        },
        session(value) {
          calls.push({ type: "atm-session", session: value });
          return this;
        },
        lean() {
          return Promise.resolve(
            linkedATM && linkedATM.isDeleted !== true ? linkedATM : null,
          );
        },
      }),
    ],
    [
      District,
      "findByIdAndUpdate",
      async (id, update, options) => {
        calls.push({
          type: "district-update",
          id,
          update,
          options,
        });
        return { ...district, ...update.$set };
      },
    ],
  ];
  return { calls, overrides, district, session };
};

const invokeDeactivation = (path, handler) =>
  path === "delete"
    ? invoke(handler, {
        params: { id: "64b000000000000000000020" },
        user: { _id: userId },
      })
    : invoke(handler, {
        params: { id: "64b000000000000000000020" },
        body: { isActive: false },
        user: { _id: userId },
      });

for (const path of ["delete", "patch"]) {
  for (const [status, atm] of [
    ["active", { status: "ACTIVE", isDeleted: false }],
    ["inactive", { status: "INACTIVE", isDeleted: false }],
    ["removed", { status: "REMOVED", isDeleted: false }],
    ["legacy", { status: "ACTIVE" }],
  ]) {
    test(`District ${path} deactivation blocks linked ${status} ATMs`, async () => {
      const { calls, overrides } = createDeactivationMocks({
        linkedATM: { _id: "linked-atm", ...atm },
      });
      const handler = path === "delete" ? deactivateDistrict : updateDistrict;

      await withOverrides(overrides, async () => {
        await assert.rejects(
          invokeDeactivation(path, handler),
          /Cannot deactivate a District while non-deleted ATMs are linked/,
        );
      });

      assert.ok(calls.some((call) => call.type === "fence"));
      assert.ok(!calls.some((call) => call.type === "district-update"));
    });
  }

  test(`District ${path} deactivation proceeds when linked ATMs are explicitly deleted`, async () => {
    const { calls, overrides, session } = createDeactivationMocks({
      linkedATM: { _id: "deleted-atm", isDeleted: true },
    });
    const handler = path === "delete" ? deactivateDistrict : updateDistrict;

    await withOverrides(overrides, async () => {
      const response = await invokeDeactivation(path, handler);
      assert.equal(response.status, 200);
      assert.equal(response.body.data.isActive, false);
    });

    const fence = calls.find((call) => call.type === "fence");
    const regionFence = calls.find((call) => call.type === "region-fence");
    const atmLookup = calls.find((call) => call.type === "atm-filter");
    const atmSession = calls.find((call) => call.type === "atm-session");
    const update = calls.find((call) => call.type === "district-update");
    assert.equal(fence.session, session);
    if (path === "patch") {
      assert.equal(regionFence.session, session);
      assert.ok(
        calls.findIndex((call) => call.type === "region-fence") <
          calls.findIndex((call) => call.type === "fence"),
      );
    }
    assert.equal(atmLookup.filter.districtId, "64b000000000000000000020");
    assert.equal(atmLookup.filter.isDeleted.$ne, true);
    assert.equal(atmSession.session, session);
    assert.equal(update.options.session, session);
    assert.ok(
      calls.findIndex((call) => call.type === "fence") <
        calls.findIndex((call) => call.type === "atm-filter"),
    );
    assert.ok(
      calls.findIndex((call) => call.type === "atm-filter") <
        calls.findIndex((call) => call.type === "district-update"),
    );
  });
}

test("District reactivation acquires Bank, Region, and District fences in order", async () => {
  const { calls, overrides, session } = createDeactivationMocks();

  await withOverrides(overrides, async () => {
    const response = await invoke(updateDistrict, {
      params: { id: "64b000000000000000000020" },
      body: { isActive: true },
      user: { _id: userId },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.isActive, true);
  });

  const regionFence = calls.find((call) => call.type === "region-fence");
  const districtFence = calls.find((call) => call.type === "fence");
  const bankFence = calls.find((call) => call.type === "bank-fence");
  const update = calls.find((call) => call.type === "district-update");
  assert.equal(bankFence.session, session);
  assert.equal(regionFence.session, session);
  assert.equal(districtFence.session, session);
  assert.equal(update.options.session, session);
  assert.ok(
    calls.findIndex((call) => call.type === "bank-fence") <
      calls.findIndex((call) => call.type === "region-fence"),
  );
  assert.ok(
    calls.findIndex((call) => call.type === "region-fence") <
      calls.findIndex((call) => call.type === "fence"),
  );
});
