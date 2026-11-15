import assert from "node:assert/strict";
import test from "node:test";
import District from "../src/modules/districts/district.models.js";
import {
  createDistrictSchema,
  updateDistrictSchema,
} from "../src/modules/districts/district.validation.js";
import {
  districtNormalizedValues,
  buildDistrictGeographyBackfill,
  normalizeDistrictName,
  normalizeDistrictPinCode,
} from "../src/modules/districts/districtNormalization.js";

test("District normalization trims names case-insensitively and preserves PIN zeros", () => {
  assert.deepEqual(
    districtNormalizedValues({
      districtName: " Karur ",
      pinCode: " 063901 ",
    }),
    {
      districtNameNormalized: "karur",
      pinCodeNormalized: "063901",
    },
  );
  assert.equal(normalizeDistrictName(" Karur "), "karur");
  assert.equal(normalizeDistrictPinCode(" 0004 "), "0004");
});

test("District normalization rejects non-string and empty values without mutating display data", () => {
  const displayValues = { districtName: " Karur ", pinCode: " 063901 " };
  assert.throws(() => normalizeDistrictName("  "));
  assert.throws(() => normalizeDistrictName(123));
  assert.throws(() => normalizeDistrictPinCode(" "));
  assert.throws(() => normalizeDistrictPinCode(63901));
  districtNormalizedValues(displayValues);
  assert.deepEqual(displayValues, { districtName: " Karur ", pinCode: " 063901 " });
});

test("District Bank backfill is parent-derived and idempotent", () => {
  const district = {
    regionId: "64b000000000000000000011",
    districtName: " Karur ",
    pinCode: " 063901 ",
  };
  const region = {
    _id: "64b000000000000000000011",
    bankId: "64b000000000000000000001",
  };
  const first = buildDistrictGeographyBackfill(district, region);
  const second = buildDistrictGeographyBackfill(district, region);
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    bankId: region.bankId,
    districtNameNormalized: "karur",
    pinCodeNormalized: "063901",
  });
  assert.throws(() =>
    buildDistrictGeographyBackfill(district, { ...region, _id: "wrong-region" }),
  );
});

test("District write validation rejects client-controlled Bank and normalized keys", () => {
  const valid = {
    regionId: "64b000000000000000000001",
    districtName: "Karur",
    pinCode: "063901",
    state: "Tamil Nadu",
  };
  assert.equal(createDistrictSchema.safeParse(valid).success, true);
  for (const field of ["bankId", "districtNameNormalized", "pinCodeNormalized"]) {
    assert.equal(
      createDistrictSchema.safeParse({ ...valid, [field]: "client-value" }).success,
      false,
    );
  }
  for (const field of [
    "bankId",
    "regionId",
    "districtNameNormalized",
    "pinCodeNormalized",
  ]) {
    assert.equal(
      updateDistrictSchema.safeParse({ [field]: "client-value" }).success,
      false,
    );
  }
});

test("District uses Bank-wide mapped-only unique indexes and disables startup index creation", () => {
  const indexes = District.schema.indexes();
  assert.equal(District.schema.options.autoIndex, false);
  assert.ok(
    indexes.some(
      ([keys, options]) =>
        JSON.stringify(keys) ===
          JSON.stringify({ bankId: 1, districtNameNormalized: 1 }) &&
        options.unique === true &&
        options.name === "uniq_district_bank_name_normalized" &&
        options.partialFilterExpression.geographyStatus === "MAPPED",
    ),
  );
  assert.ok(
    indexes.some(
      ([keys, options]) =>
        JSON.stringify(keys) ===
          JSON.stringify({ bankId: 1, pinCodeNormalized: 1 }) &&
        options.unique === true &&
        options.name === "uniq_district_bank_pin_normalized" &&
        options.partialFilterExpression.geographyStatus === "MAPPED",
    ),
  );
});
