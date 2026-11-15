import assert from "node:assert/strict";
import test from "node:test";
import {
  auditDistrictGeography,
  countDistrictGeographyIssues,
  DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES,
} from "../src/modules/districts/districtGeographyAudit.js";

const bankA = "64b000000000000000000001";
const bankB = "64b000000000000000000002";
const regionA1 = "64b000000000000000000011";
const regionA2 = "64b000000000000000000012";
const regionB1 = "64b000000000000000000013";

test("fresh mapped Bank-Region-District-ATM geography passes the audit", () => {
  const district = "64b000000000000000000020";
  const report = auditDistrictGeography({
    banks: [{ _id: bankA }],
    regions: [
      { _id: regionA1, bankId: bankA, geographyStatus: "MAPPED" },
    ],
    districts: [
      {
        _id: district,
        bankId: bankA,
        regionId: regionA1,
        districtName: "Karur",
        districtNameNormalized: "karur",
        pinCode: "063901",
        pinCodeNormalized: "063901",
        geographyStatus: "MAPPED",
        isActive: true,
      },
    ],
    atms: [
      {
        _id: "64b000000000000000000030",
        bankId: bankA,
        regionId: regionA1,
        districtId: district,
        geographyStatus: "MAPPED",
      },
    ],
  });

  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.duplicateNames, []);
  assert.deepEqual(report.duplicatePincodes, []);
});

test("geography audit groups normalized duplicates by parent Bank, including inactive Districts", () => {
  const inactiveDistrict = "64b000000000000000000021";
  const sameBankDuplicate = "64b000000000000000000022";
  const otherBankAllowed = "64b000000000000000000023";
  const report = auditDistrictGeography({
    banks: [{ _id: bankA }, { _id: bankB }],
    regions: [
      { _id: regionA1, bankId: bankA },
      { _id: regionA2, bankId: bankA },
      { _id: regionB1, bankId: bankB },
    ],
    districts: [
      {
        _id: inactiveDistrict,
        bankId: bankA,
        regionId: regionA1,
        districtName: " Karur ",
        districtNameNormalized: "karur",
        pinCode: " 063901 ",
        pinCodeNormalized: "063901",
        isActive: false,
        geographyStatus: "MAPPED",
      },
      {
        _id: sameBankDuplicate,
        bankId: bankA,
        regionId: regionA2,
        districtName: "KARUR",
        districtNameNormalized: "karur",
        pinCode: "063901",
        pinCodeNormalized: "063901",
        isActive: true,
        geographyStatus: "MAPPED",
      },
      {
        _id: otherBankAllowed,
        bankId: bankB,
        regionId: regionB1,
        districtName: "karur",
        districtNameNormalized: "karur",
        pinCode: "063901",
        pinCodeNormalized: "063901",
        isActive: true,
        geographyStatus: "MAPPED",
      },
    ],
    atms: [
      {
        _id: "64b000000000000000000031",
        bankId: bankA,
        regionId: regionA1,
        districtId: inactiveDistrict,
      },
    ],
  });

  assert.equal(report.duplicateNames.length, 1);
  assert.equal(report.duplicateNames[0].bankId, bankA);
  assert.deepEqual(
    report.duplicateNames[0].districtIds.sort(),
    [inactiveDistrict, sameBankDuplicate].sort(),
  );
  assert.deepEqual(report.duplicateNames[0].inactiveDistrictIds, [inactiveDistrict]);
  assert.equal(report.duplicatePincodes.length, 1);
  assert.equal(
    report.affectedATMCounts.find((row) => row.districtId === inactiveDistrict).atmCount,
    1,
  );
  assert.equal(report.issues.length, 0);
});

test("geography audit reports orphaned parents, normalized-key gaps, and ATM hierarchy mismatches", () => {
  const region = "64b000000000000000000041";
  const district = "64b000000000000000000042";
  const report = auditDistrictGeography({
    banks: [{ _id: bankA }],
    regions: [{ _id: region, bankId: bankA }],
    districts: [
      {
        _id: district,
        regionId: region,
        bankId: bankB,
        districtName: " Karur ",
        pinCode: "063901",
        geographyStatus: "MAPPED",
      },
      {
        _id: "64b000000000000000000043",
        regionId: "64b000000000000000000099",
        districtName: "Orphan",
        pinCode: "000001",
      },
    ],
    atms: [
      {
        _id: "64b000000000000000000044",
        bankId: bankB,
        regionId: region,
        districtId: district,
      },
    ],
  });
  const issueCounts = Object.fromEntries(
    report.issues.map(({ category, count }) => [category, count]),
  );
  assert.equal(issueCounts.district_bank_mismatch, 1);
  assert.equal(issueCounts.district_missing_normalized_name, 1);
  assert.equal(issueCounts.district_missing_normalized_pincode, 1);
  assert.equal(issueCounts.district_missing_or_invalid_region, 1);
  assert.equal(issueCounts.atm_geography_mismatch, 1);
});

test("geography audit categories map once to counters for every detected issue", () => {
  const missingRegion = "64b000000000000000000099";
  const invalidBank = "64b000000000000000000098";
  const invalidBankRegion = "64b000000000000000000096";
  const missingDistrictBank = "64b000000000000000000051";
  const mismatchedDistrictBank = "64b000000000000000000052";
  const missingRegionDistrict = "64b000000000000000000053";
  const invalidDisplayDistrict = "64b000000000000000000054";
  const missingKeysDistrict = "64b000000000000000000055";
  const mismatchedKeysDistrict = "64b000000000000000000056";
  const invalidParentDistrict = "64b000000000000000000057";
  const validBankBDistrict = "64b000000000000000000058";
  const report = auditDistrictGeography({
    banks: [{ _id: bankA }, { _id: bankB }],
    regions: [
      { _id: regionA1, bankId: bankA },
      { _id: regionB1, bankId: bankB },
      { _id: invalidBankRegion, bankId: invalidBank },
    ],
    districts: [
      {
        _id: missingDistrictBank,
        regionId: regionA1,
        districtName: "Missing Bank",
        districtNameNormalized: "missing bank",
        pinCode: "100001",
        pinCodeNormalized: "100001",
      },
      {
        _id: mismatchedDistrictBank,
        bankId: bankB,
        regionId: regionA1,
        districtName: "Wrong Bank",
        districtNameNormalized: "wrong bank",
        pinCode: "100002",
        pinCodeNormalized: "100002",
      },
      {
        _id: missingRegionDistrict,
        regionId: missingRegion,
        districtName: "Missing Region",
        pinCode: "100003",
      },
      {
        _id: invalidDisplayDistrict,
        bankId: bankA,
        regionId: regionA1,
        districtName: " ",
        pinCode: "100004",
      },
      {
        _id: missingKeysDistrict,
        bankId: bankA,
        regionId: regionA1,
        districtName: "Missing Keys",
        pinCode: "100005",
      },
      {
        _id: mismatchedKeysDistrict,
        bankId: bankA,
        regionId: regionA1,
        districtName: "Wrong Keys",
        districtNameNormalized: "wrong",
        pinCode: "100006",
        pinCodeNormalized: "100000",
      },
      {
        _id: invalidParentDistrict,
        regionId: invalidBankRegion,
        districtName: "Invalid Parent Bank",
        pinCode: "100007",
      },
      {
        _id: validBankBDistrict,
        bankId: bankB,
        regionId: regionB1,
        districtName: "ATM Mismatch",
        districtNameNormalized: "atm mismatch",
        pinCode: "100008",
        pinCodeNormalized: "100008",
      },
    ],
    atms: [
      {
        _id: "64b000000000000000000059",
        bankId: bankA,
        regionId: "64b000000000000000000097",
        districtId: missingDistrictBank,
      },
      {
        _id: "64b000000000000000000060",
        bankId: bankA,
        regionId: regionA1,
        districtId: validBankBDistrict,
      },
    ],
  });
  const categories = DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES;
  const expectedCounts = Object.fromEntries(
    Object.values(categories).map((category) => [category, 1]),
  );
  const issueCounts = countDistrictGeographyIssues(report.issues);

  assert.deepEqual(issueCounts, expectedCounts);
  assert.equal(new Set(report.issues.map(({ category }) => category)).size, 12);
});

test("geography audit category counters reject unrecognized categories", () => {
  assert.throws(
    () =>
      countDistrictGeographyIssues([
        { category: "unknown_category", count: 1 },
      ]),
    /Unrecognized district geography audit category "unknown_category"/,
  );
});

test("geography audit category counters include zeroes for empty findings", () => {
  const categories = DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES;

  assert.deepEqual(
    countDistrictGeographyIssues(auditDistrictGeography({}).issues),
    Object.fromEntries(Object.values(categories).map((category) => [category, 0])),
  );
});
