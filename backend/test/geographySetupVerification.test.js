import assert from "node:assert/strict";
import test from "node:test";
import {
  excludeSoftDeletedAtms,
  findGeographyUniqueKeyConflicts,
} from "../src/modules/districts/geographySetupVerification.js";

const objectId = (hex) => ({
  _bsontype: "ObjectId",
  toHexString: () => hex,
});

const bankA = objectId("64b000000000000000000001");
const bankB = objectId("64b000000000000000000002");

const conflictsFor = (banks = [], regions = []) =>
  findGeographyUniqueKeyConflicts({ banks, regions });

test("reports globally duplicated Bank names", () => {
  const report = conflictsFor([
    { _id: "bank-1", bankName: "North Bank", bankCode: "NB1" },
    { _id: "bank-2", bankName: "North Bank", bankCode: "NB2" },
  ]);

  assert.equal(report.bankNames.length, 1);
  assert.deepEqual(report.bankNames[0].records.map(({ _id }) => _id), [
    "bank-1",
    "bank-2",
  ]);
  assert.deepEqual(report.bankNames[0].key, { bankName: "North Bank" });
});

test("reports globally duplicated Bank codes", () => {
  const report = conflictsFor([
    { _id: "bank-1", bankName: "North Bank", bankCode: "NB" },
    { _id: "bank-2", bankName: "South Bank", bankCode: "NB" },
  ]);

  assert.equal(report.bankCodes.length, 1);
  assert.deepEqual(report.bankCodes[0].records.map(({ _id }) => _id), [
    "bank-1",
    "bank-2",
  ]);
  assert.deepEqual(report.bankCodes[0].key, { bankCode: "NB" });
});

test("reports duplicate Region names within one Bank", () => {
  const report = conflictsFor([], [
    { _id: "region-1", bankId: bankA, name: "Central", code: "C1" },
    { _id: "region-2", bankId: bankA, name: "Central", code: "C2" },
  ]);

  assert.equal(report.regionNames.length, 1);
  assert.deepEqual(
    report.regionNames[0].records.map(({ _id }) => _id),
    ["region-1", "region-2"],
  );
});

test("allows the same Region name under different Banks", () => {
  const report = conflictsFor([], [
    { _id: "region-1", bankId: bankA, name: "Central", code: "C1" },
    { _id: "region-2", bankId: bankB, name: "Central", code: "C2" },
  ]);

  assert.deepEqual(report.regionNames, []);
});

test("allows the same Region code under different Banks", () => {
  const report = conflictsFor([], [
    { _id: "region-1", bankId: bankA, name: "Central", code: "C1" },
    { _id: "region-2", bankId: bankB, name: "Central", code: "C1" },
  ]);

  assert.deepEqual(report.regionCodes, []);
});

test("reports duplicate Region codes within one Bank", () => {
  const report = conflictsFor([], [
    { _id: "region-1", bankId: bankA, name: "Central", code: "C1" },
    { _id: "region-2", bankId: bankA, name: "Coastal", code: "C1" },
  ]);

  assert.equal(report.regionCodes.length, 1);
  assert.deepEqual(
    report.regionCodes[0].records.map(({ _id }) => _id),
    ["region-1", "region-2"],
  );
});

test("excludes empty, missing, and null Region codes from the unique-code check", () => {
  const report = conflictsFor([], [
    { _id: "region-1", bankId: bankA, name: "Central", code: "" },
    { _id: "region-2", bankId: bankA, name: "Coastal", code: "" },
    { _id: "region-3", bankId: bankA, name: "Eastern" },
    { _id: "region-4", bankId: bankA, name: "Western", code: null },
  ]);

  assert.deepEqual(report.regionCodes, []);
});

test("excludes non-ObjectId Region Bank IDs from both partial unique indexes", () => {
  const report = conflictsFor([], [
    { _id: "region-1", bankId: "bank-a", name: "Central", code: "C1" },
    { _id: "region-2", bankId: "bank-a", name: "Central", code: "C1" },
  ]);

  assert.deepEqual(report.regionNames, []);
  assert.deepEqual(report.regionCodes, []);
});

test("groups missing and null indexed values as equal unique-index keys", () => {
  const report = conflictsFor(
    [
      { _id: "bank-1" },
      { _id: "bank-2", bankName: null, bankCode: null },
    ],
    [
      { _id: "region-1", bankId: bankA, code: "R1" },
      { _id: "region-2", bankId: bankA, name: null, code: "R2" },
    ],
  );

  assert.equal(report.bankNames.length, 1);
  assert.deepEqual(report.bankNames[0].key, { bankName: null });
  assert.equal(report.bankCodes.length, 1);
  assert.deepEqual(report.bankCodes[0].key, { bankCode: null });
  assert.equal(report.regionNames.length, 1);
  assert.deepEqual(report.regionNames[0].key, {
    bankId: bankA,
    name: null,
  });
  assert.deepEqual(report.regionCodes, []);
});

test("excludes only ATMs whose isDeleted flag is true", () => {
  const active = { _id: "active", isDeleted: false };
  const unspecified = { _id: "unspecified" };
  const deleted = { _id: "deleted", isDeleted: true };

  assert.deepEqual(excludeSoftDeletedAtms([active, deleted, unspecified]), [
    active,
    unspecified,
  ]);
});
