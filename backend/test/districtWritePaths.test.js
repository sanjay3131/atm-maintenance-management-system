import assert from "node:assert/strict";
import test from "node:test";
import District from "../src/modules/districts/district.models.js";
import Region from "../src/modules/region/region.model.js";
import {
  createDistrict,
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
  lean() {
    return Promise.resolve(value);
  },
});

const baseOverrides = ({
  existingDistricts = [],
  onCreate = () => {},
} = {}) => [
  [
    Region,
    "findById",
    () => ({
      populate() {
        return Promise.resolve({
          _id: regionId,
          name: "Karur",
          bankId: { _id: bankId, isActive: true },
          isActive: true,
          geographyStatus: "MAPPED",
        });
      },
    }),
  ],
  [Region, "find", () => makeReadQuery([{ _id: regionId }, { _id: `${regionId}-other` }])],
  [
    District,
    "find",
    (filter) =>
      makeReadQuery(
        existingDistricts.filter(
          (existing) =>
            String(existing.bankId) === String(filter.bankId) &&
            existing.geographyStatus === filter.geographyStatus,
        ),
      ),
  ],
  [
    District,
    "create",
    async (district) => {
      onCreate(district);
      return { _id: "64b000000000000000000004", ...district };
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
  await withOverrides(
    baseOverrides({ onCreate: (district) => (created = district) }),
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
