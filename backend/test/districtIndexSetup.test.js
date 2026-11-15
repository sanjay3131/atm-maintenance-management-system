import assert from "node:assert/strict";
import test from "node:test";
import {
  DISTRICT_INDEXES,
  planDistrictIndexes,
  preflightDistrictIndexes,
  verifyDistrictIndexes,
} from "../src/modules/districts/districtIndexSetup.js";

const bankA = "64b000000000000000000001";
const bankB = "64b000000000000000000002";
const regionA = "64b000000000000000000011";
const regionB = "64b000000000000000000012";

const mappedDistrict = ({
  _id,
  bankId = bankA,
  regionId = regionA,
  districtName = "Karur",
  pinCode = "063901",
  isActive = true,
} = {}) => ({
  _id,
  bankId,
  regionId,
  districtName,
  districtNameNormalized: districtName.trim().toLowerCase(),
  pinCode,
  pinCodeNormalized: pinCode.trim(),
  isActive,
  geographyStatus: "MAPPED",
});

const actualIndexes = [
  { name: "_id_", key: { _id: 1 }, v: 2, ns: "fresh.districts" },
  ...DISTRICT_INDEXES.map((index) => ({
    ...index,
    v: 2,
    ns: "fresh.districts",
  })),
];

test("fresh District index plan includes the non-unique name sort index", () => {
  const plan = planDistrictIndexes([]);

  assert.deepEqual(
    plan.createIndexes.map(({ name }) => name),
    DISTRICT_INDEXES.map(({ name }) => name),
  );
  assert.equal(
    DISTRICT_INDEXES.find(({ name }) => name === "districtName_1").unique,
    undefined,
  );
  assert.deepEqual(plan.unexpected, []);
  assert.deepEqual(plan.mismatched, []);
});

test("District duplicate preflight is Bank-wide and includes inactive mapped rows", () => {
  const report = preflightDistrictIndexes([
    mappedDistrict({
      _id: "64b000000000000000000021",
      regionId: regionA,
      districtName: " Karur ",
      pinCode: " 063901 ",
      isActive: false,
    }),
    mappedDistrict({
      _id: "64b000000000000000000022",
      regionId: regionB,
      districtName: "KARUR",
      pinCode: "063901",
    }),
    mappedDistrict({
      _id: "64b000000000000000000023",
      bankId: bankB,
      districtName: "Karur",
      pinCode: "063901",
    }),
  ]);

  assert.equal(report.isClean, false);
  assert.equal(report.duplicateNames.length, 1);
  assert.equal(report.duplicatePincodes.length, 1);
  assert.deepEqual(
    report.duplicateNames[0].districtIds.sort(),
    [
      "64b000000000000000000021",
      "64b000000000000000000022",
    ].sort(),
  );
  assert.equal(report.duplicateNames[0].bankId, bankA);
});

test("District duplicate preflight rejects malformed mapped keys", () => {
  const report = preflightDistrictIndexes([
    {
      ...mappedDistrict({ _id: "64b000000000000000000024" }),
      districtNameNormalized: "wrong-name",
    },
    {
      ...mappedDistrict({ _id: "64b000000000000000000025" }),
      bankId: null,
    },
  ]);

  assert.equal(report.isClean, false);
  assert.deepEqual(report.invalidMappedDistricts, [
    "64b000000000000000000024",
    "64b000000000000000000025",
  ]);
});

test("District index verification accepts exact specs and ignores server metadata", () => {
  const verification = verifyDistrictIndexes(actualIndexes);

  assert.equal(verification.isExact, true);
  assert.deepEqual(verification.missing, []);
  assert.deepEqual(verification.mismatched, []);
  assert.deepEqual(verification.unexpected, []);
});

test("District index verification rejects missing, mismatched, and unexpected indexes", () => {
  const verification = verifyDistrictIndexes([
    actualIndexes[0],
    {
      ...actualIndexes[1],
      unique: true,
    },
    ...actualIndexes.slice(2),
    { name: "unexpected_1", key: { unexpected: 1 } },
  ]);

  assert.equal(verification.isExact, false);
  assert.deepEqual(
    verification.missing.map(({ name }) => name),
    ["regionId_1"],
  );
  assert.deepEqual(
    verification.mismatched.map(({ name }) => name),
    ["regionId_1"],
  );
  assert.deepEqual(
    verification.unexpected.map(({ name }) => name),
    ["unexpected_1"],
  );
});

test("District index verification rejects a partial-filter mismatch", () => {
  const nameIndex = actualIndexes.find(
    ({ name }) => name === "uniq_district_bank_name_normalized",
  );
  const verification = verifyDistrictIndexes([
    ...actualIndexes.filter((index) => index !== nameIndex),
    {
      ...nameIndex,
      partialFilterExpression: { geographyStatus: "UNMAPPED" },
    },
  ]);

  assert.equal(verification.isExact, false);
  assert.deepEqual(
    verification.mismatched.map(({ name }) => name),
    ["uniq_district_bank_name_normalized"],
  );
});

test("District index verification rejects a collation mismatch", () => {
  const nameIndex = actualIndexes.find(
    ({ name }) => name === "uniq_district_bank_name_normalized",
  );
  const verification = verifyDistrictIndexes([
    ...actualIndexes.filter((index) => index !== nameIndex),
    {
      ...nameIndex,
      collation: { locale: "en", strength: 2 },
    },
  ]);

  assert.equal(verification.isExact, false);
  assert.deepEqual(
    verification.mismatched.map(({ name }) => name),
    ["uniq_district_bank_name_normalized"],
  );
});

test("District index verification rejects sparse and hidden option mismatches", () => {
  const nameIndex = actualIndexes.find(
    ({ name }) => name === "uniq_district_bank_name_normalized",
  );

  for (const option of ["sparse", "hidden"]) {
    const verification = verifyDistrictIndexes([
      ...actualIndexes.filter((index) => index !== nameIndex),
      { ...nameIndex, [option]: true },
    ]);

    assert.equal(verification.isExact, false, `${option} mismatch must fail`);
    assert.deepEqual(
      verification.mismatched.map(({ name }) => name),
      ["uniq_district_bank_name_normalized"],
    );
  }
});

test("District index verification rejects a compound key ordering mismatch", () => {
  const nameIndex = actualIndexes.find(
    ({ name }) => name === "uniq_district_bank_name_normalized",
  );
  const verification = verifyDistrictIndexes([
    ...actualIndexes.filter((index) => index !== nameIndex),
    {
      ...nameIndex,
      key: { districtNameNormalized: 1, bankId: 1 },
    },
  ]);

  assert.equal(verification.isExact, false);
  assert.deepEqual(
    verification.mismatched.map(({ name }) => name),
    ["uniq_district_bank_name_normalized"],
  );
});
