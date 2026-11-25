import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Bank from "../src/modules/banks/bank.model.js";
import District from "../src/modules/districts/district.models.js";
import Region from "../src/modules/region/region.model.js";
import {
  createRegion,
  getAllRegions,
  getAllRegionsByDistrict,
  getRegionById,
  getRegionsByDistrict,
  updateRegion,
  deleteRegion,
} from "../src/modules/region/region.controller.js";
import { updateRegionSchema } from "../src/modules/region/region.validate.js";

const districtId = "64b000000000000000000001";
const regionId = "64b000000000000000000002";
const bankId = "64b000000000000000000003";

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
  const originals = overrides.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    return await callback();
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

function queryChain(value, capture = {}) {
  return {
    session(session) {
      capture.session = session;
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(value);
    },
    populate() {
      return this;
    },
    sort(sort) {
      capture.sort = sort;
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

const createRegionFenceMocks = ({
  linkedDistrict = null,
  failSave = false,
} = {}) => {
  const state = {
    region: {
      _id: regionId,
      bankId,
      name: "Region One",
      isActive: true,
      geographyStatus: "MAPPED",
    },
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
  const overrides = [
    [mongoose, "startSession", async () => session],
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
        session(value) {
          calls.push({ type: "bank-read", session: value });
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
      async (_filter, update, options) => {
        calls.push({
          type: "region-fence",
          update,
          session: options.session,
        });
        state.region.geographyFence =
          (state.region.geographyFence ?? 0) + update.$inc.geographyFence;
        return { matchedCount: 1 };
      },
    ],
    [
      Region,
      "findById",
      (id) => {
        assert.equal(String(id), regionId);
        const doc = {
          ...state.region,
          async save(options) {
            calls.push({ type: "region-save", options });
            if (failSave) throw new Error("Injected Region save failure");
            state.region = {
              _id: this._id,
              bankId: this.bankId,
              name: this.name,
              isActive: this.isActive,
              geographyStatus: this.geographyStatus,
              updatedBy: this.updatedBy,
              geographyFence: state.region.geographyFence,
            };
          },
          async populate() {
            return this;
          },
        };
        return queryChain(doc, calls);
      },
    ],
    [
      District,
      "findOne",
      (filter) => {
        calls.push({ type: "district-query", filter });
        const query = queryChain(linkedDistrict);
        return {
          select() {
            return this;
          },
          session(value) {
            calls.push({ type: "district-session", session: value });
            return this;
          },
          lean() {
            return Promise.resolve(linkedDistrict);
          },
          then(resolve, reject) {
            return query.then(resolve, reject);
          },
        };
      },
    ],
  ];
  return { calls, overrides, session, state };
};

const createRegionCreationMocks = (createRegionRecord) => {
  const calls = [];
  const session = {
    async withTransaction(operation) {
      return operation(this);
    },
    async endSession() {},
  };
  const overrides = [
    [mongoose, "startSession", async () => session],
    [
      Bank,
      "updateOne",
      async (filter, update, options) => {
        calls.push({ type: "bank-fence", filter, update, options });
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
        session(value) {
          calls.push({ type: "bank-read", session: value });
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
      "create",
      async (documents, options) => {
        calls.push({ type: "region-create", documents, options });
        return createRegionRecord(documents, options);
      },
    ],
  ];
  return { calls, overrides, session };
};

test("default Region lists continue returning active regions only", async () => {
  const originalFind = Region.find;
  const originalRegionFindById = Region.findById;
  const originalDistrictFindById = District.findById;
  const captures = [];
  const parentRegionIds = [];
  const regions = [{ _id: regionId, isActive: true }];
  const parentRegion = {
    _id: regionId,
    isActive: true,
    geographyStatus: "MAPPED",
  };
  Region.find = (filter) => {
    captures.push(filter);
    return queryChain(regions);
  };
  Region.findById = (id) => {
    parentRegionIds.push(String(id));
    return queryChain(parentRegion);
  };
  District.findById = () => queryChain({ _id: districtId, regionId });

  try {
    const all = await invoke(getAllRegions, { query: {} });
    const district = await invoke(getRegionsByDistrict, {
      params: { districtId },
    });

    assert.deepEqual(all.body.data, regions);
    assert.deepEqual(district.body.data, [parentRegion]);
    assert.deepEqual(captures, [
      { isActive: true, geographyStatus: "MAPPED" },
    ]);
    assert.deepEqual(parentRegionIds, [regionId]);
  } finally {
    Region.find = originalFind;
    Region.findById = originalRegionFindById;
    District.findById = originalDistrictFindById;
  }
});

test("admin District list includes an inactive parent Region", async () => {
  const originalRegionFindById = Region.findById;
  const originalDistrictFindById = District.findById;
  const inactiveRegion = { _id: regionId, isActive: false };
  Region.findById = (id) => {
    assert.equal(String(id), regionId);
    return queryChain(inactiveRegion);
  };
  District.findById = () => queryChain({ _id: districtId, regionId });

  try {
    const { status, body } = await invoke(getAllRegionsByDistrict, {
      params: { districtId },
    });
    assert.equal(status, 200);
    assert.deepEqual(body.data, [inactiveRegion]);
  } finally {
    Region.findById = originalRegionFindById;
    District.findById = originalDistrictFindById;
  }
});

test("inactive Region can be loaded by ID and reactivated through a validated update", async () => {
  const { calls, overrides, state, session } = createRegionFenceMocks();
  state.region.isActive = false;

  await withOverrides(overrides, async () => {
    const detail = await invoke(getRegionById, { params: { id: regionId } });
    const parsed = updateRegionSchema.safeParse({ isActive: true });
    assert.equal(parsed.success, true);
    const updated = await invoke(updateRegion, {
      params: { id: regionId },
      body: parsed.data,
      user: { _id: "admin-user" },
    });

    assert.equal(detail.body.data.isActive, false);
    assert.equal(updated.body.data.isActive, true);
  });
  const fence = calls.find((call) => call.type === "region-fence");
  const bankFence = calls.find((call) => call.type === "bank-fence");
  const bankRead = calls.find((call) => call.type === "bank-read");
  const save = calls.find((call) => call.type === "region-save");
  assert.equal(bankFence.session, session);
  assert.equal(bankRead.session, session);
  assert.equal(fence.session, session);
  assert.equal(save.options.session, session);
  assert.ok(
    calls.findIndex((call) => call.type === "bank-fence") <
      calls.findIndex((call) => call.type === "region-fence"),
  );
});

for (const path of ["delete", "patch"]) {
  for (const [status, linkedDistrict] of [
    ["active", { _id: districtId, regionId, isActive: true }],
    ["inactive", { _id: districtId, regionId, isActive: false }],
  ]) {
    test(`Region ${path} deactivation blocks a linked ${status} District`, async () => {
      const { calls, overrides, state, session } =
        createRegionFenceMocks({ linkedDistrict });
      const handler = path === "delete" ? deleteRegion : updateRegion;
      const request = {
        params: { id: regionId },
        user: { _id: "admin-user" },
        ...(path === "patch" ? { body: { isActive: false } } : {}),
      };

      await withOverrides(overrides, async () => {
        await assert.rejects(
          invoke(handler, request),
          /Cannot deactivate a Region while Districts are linked/,
        );
      });

      assert.equal(state.region.isActive, true);
      assert.equal(
        calls.filter((call) => call.type === "region-fence")[0].session,
        session,
      );
      assert.ok(calls.some((call) => call.type === "district-query"));
      assert.ok(!calls.some((call) => call.type === "region-save"));
    });
  }

  test(`Region ${path} deactivation succeeds when no District references it`, async () => {
    const { calls, overrides, state, session } = createRegionFenceMocks();
    const handler = path === "delete" ? deleteRegion : updateRegion;
    const request = {
      params: { id: regionId },
      user: { _id: "admin-user" },
      ...(path === "patch" ? { body: { isActive: false } } : {}),
    };

    await withOverrides(overrides, async () => {
      const response = await invoke(handler, request);
      assert.equal(response.status, 200);
      assert.equal(response.body.data.isActive, false);
    });

    const fence = calls.find((call) => call.type === "region-fence");
    const districtQuery = calls.find((call) => call.type === "district-query");
    const save = calls.find((call) => call.type === "region-save");
    assert.equal(fence.session, session);
    assert.deepEqual(districtQuery.filter, { regionId });
    assert.equal(save.options.session, session);
    assert.equal(state.region.isActive, false);
  });
}

test("Region deactivation rolls back when the Region update fails", async () => {
  const { overrides, state } = createRegionFenceMocks({ failSave: true });

  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(deleteRegion, {
        params: { id: regionId },
        user: { _id: "admin-user" },
      }),
      /Injected Region save failure/,
    );
  });

  assert.equal(state.region.isActive, true);
});

test("Region creation acquires the Bank fence before inserting in the same transaction", async () => {
  const { calls, overrides, session } = createRegionCreationMocks(
    async ([document], options) => [{ ...document, _id: regionId, options }],
  );
  await withOverrides(overrides, async () => {
    const response = await invoke(createRegion, {
      body: { bankId, name: "Karur", code: "KARUR001" },
      user: { _id: "admin-user" },
    });
    assert.equal(response.status, 201);
  });
  const fence = calls.find((call) => call.type === "bank-fence");
  const insertion = calls.find((call) => call.type === "region-create");
  assert.deepEqual(fence.filter, { _id: bankId });
  assert.equal(fence.options.session, session);
  assert.equal(insertion.options.session, session);
  assert.equal(insertion.documents[0].bankId, bankId);
});

test("Region creation does not misreport a legacy parent-index conflict as Bank-scoped", async () => {
  const { overrides } = createRegionCreationMocks(async () => {
    throw Object.assign(new Error("duplicate key"), {
      code: 11000,
      keyPattern: { districtId: 1, name: 1 },
    });
  });
  await withOverrides(overrides, () =>
    assert.rejects(
      invoke(createRegion, {
        body: { bankId, name: "Karur", code: "KARUR001" },
        user: { _id: "admin-user" },
      }),
      /Region index conflict; verify the installed geography indexes/,
    ),
  );
});

test("Region creation preserves the Bank-scoped duplicate conflict for current indexes", async () => {
  const { overrides } = createRegionCreationMocks(async () => {
    throw Object.assign(new Error("duplicate key"), {
      code: 11000,
      keyPattern: { bankId: 1, name: 1 },
    });
  });
  await withOverrides(overrides, () =>
    assert.rejects(
      invoke(createRegion, {
        body: { bankId, name: "Karur", code: "KARUR001" },
        user: { _id: "admin-user" },
      }),
      /Region name or code already exists in this bank/,
    ),
  );
});
