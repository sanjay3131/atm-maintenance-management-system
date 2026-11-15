import assert from "node:assert/strict";
import test from "node:test";
import Bank from "../src/modules/banks/bank.model.js";
import District from "../src/modules/districts/district.models.js";
import Region from "../src/modules/region/region.model.js";
import { validateActiveATMGeography } from "../src/modules/atms/atm.controller.js";

const bankA = "64b000000000000000000001";
const bankB = "64b000000000000000000002";
const regionA = "64b000000000000000000011";
const regionB = "64b000000000000000000012";
const districtA = "64b000000000000000000021";

const makeQuery = (value) => ({
  select() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
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

const validRecords = () => ({
  banks: {
    [bankA]: { _id: bankA, isActive: true },
    [bankB]: { _id: bankB, isActive: true },
  },
  regions: {
    [regionA]: {
      _id: regionA,
      bankId: bankA,
      geographyStatus: "MAPPED",
      isActive: true,
    },
    [regionB]: {
      _id: regionB,
      bankId: bankA,
      geographyStatus: "MAPPED",
      isActive: true,
    },
  },
  districts: {
    [districtA]: {
      _id: districtA,
      bankId: bankA,
      regionId: regionA,
      geographyStatus: "MAPPED",
      isActive: true,
    },
  },
});

const withGeography = (records, callback) =>
  withOverrides(
    [
      [Bank, "findById", (id) => makeQuery(records.banks[String(id)] ?? null)],
      [
        District,
        "findById",
        (id) => makeQuery(records.districts[String(id)] ?? null),
      ],
      [Region, "findById", (id) => makeQuery(records.regions[String(id)] ?? null)],
    ],
    callback,
  );

test("ATM geography accepts a consistent Bank → Region → District assignment", async () => {
  await withGeography(validRecords(), () =>
    validateActiveATMGeography(bankA, districtA, regionA),
  );
});

test("ATM geography rejects a Region from a different Bank", async () => {
  const records = validRecords();
  records.regions[regionA].bankId = bankB;
  await withGeography(records, async () => {
    await assert.rejects(
      validateActiveATMGeography(bankA, districtA, regionA),
      /Selected region does not belong to the selected bank/,
    );
  });
});

test("ATM geography rejects a District assigned to another Region", async () => {
  const records = validRecords();
  records.districts[districtA].regionId = regionB;
  await withGeography(records, async () => {
    await assert.rejects(
      validateActiveATMGeography(bankA, districtA, regionA),
      /Selected district does not belong to the selected region/,
    );
  });
});

test("ATM geography rejects a District whose Bank differs from the Region and ATM", async () => {
  const records = validRecords();
  records.districts[districtA].bankId = bankB;
  await withGeography(records, async () => {
    await assert.rejects(
      validateActiveATMGeography(bankA, districtA, regionA),
      /Selected district does not belong to the selected bank/,
    );
  });
});
