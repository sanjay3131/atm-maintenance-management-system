import assert from "node:assert/strict";
import test from "node:test";
import Bank from "../src/modules/banks/bank.model.js";
import District from "../src/modules/districts/district.models.js";
import Region from "../src/modules/region/region.model.js";
import { captureATMGeographySnapshot } from "../src/utils/geographySnapshot.js";

const bankId = "64b000000000000000000001";
const regionId = "64b000000000000000000002";
const districtId = "64b000000000000000000003";

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

const runWithDistrictBank = (districtBankId, callback) =>
  withOverrides(
    [
      [Bank, "findById", () => makeQuery({ _id: bankId, bankName: "Bank A", isActive: true })],
      [
        Region,
        "findById",
        () =>
          makeQuery({
            _id: regionId,
            name: "Region A",
            bankId,
            geographyStatus: "MAPPED",
          }),
      ],
      [
        District,
        "findById",
        () =>
          makeQuery({
            _id: districtId,
            bankId: districtBankId,
            districtName: "Karur",
            regionId,
            geographyStatus: "MAPPED",
          }),
      ],
    ],
    callback,
  );

test("new operational snapshot captures a consistent Bank → Region → District chain", async () => {
  await runWithDistrictBank(bankId, async () => {
    const snapshot = await captureATMGeographySnapshot({
      geographyStatus: "MAPPED",
      bankId,
      regionId,
      districtId,
    });
    assert.deepEqual(
      {
        bankId: String(snapshot.bankId),
        regionId: String(snapshot.regionId),
        districtId: String(snapshot.districtId),
        bankName: snapshot.bankName,
        regionName: snapshot.regionName,
        districtName: snapshot.districtName,
      },
      {
        bankId,
        regionId,
        districtId,
        bankName: "Bank A",
        regionName: "Region A",
        districtName: "Karur",
      },
    );
  });
});

test("new operational snapshot rejects District Bank mismatch", async () => {
  await runWithDistrictBank("64b000000000000000000099", async () => {
    await assert.rejects(
      captureATMGeographySnapshot({
        geographyStatus: "MAPPED",
        bankId,
        regionId,
        districtId,
      }),
      /ATM geography is inconsistent/,
    );
  });
});
