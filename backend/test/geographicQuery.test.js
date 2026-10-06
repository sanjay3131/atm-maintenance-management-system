import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  buildATMGeographicQuery,
  escapeRegex,
  parsePagination,
} from "../src/utils/geographicQuery.js";

const districtId = "64b000000000000000000001";
const regionId = "64b000000000000000000002";
const bankId = "64b000000000000000000003";

test("builds an intersecting, non-deleted ATM scope from supplied IDs", () => {
  const query = buildATMGeographicQuery({ districtId, regionId, bankId });

  assert.deepEqual(query, {
    isDeleted: false,
    districtId: new mongoose.Types.ObjectId(districtId),
    regionId: new mongoose.Types.ObjectId(regionId),
    bankId: new mongoose.Types.ObjectId(bankId),
  });
});

test("requires at least one geographic scope and rejects invalid IDs", () => {
  assert.throws(
    () => buildATMGeographicQuery({ bankId }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => buildATMGeographicQuery({ districtId: "not-an-object-id" }),
    (error) => error.statusCode === 400,
  );
});

test("validates and calculates bounded pagination", () => {
  assert.deepEqual(parsePagination("3", "25"), {
    page: 3,
    limit: 25,
    skip: 50,
  });
  assert.deepEqual(parsePagination(), { page: 1, limit: 10, skip: 0 });
  assert.throws(() => parsePagination("0", "10"), (error) => error.statusCode === 400);
  assert.throws(() => parsePagination("1", "101"), (error) => error.statusCode === 400);
  assert.throws(() => parsePagination(["1"], "10"), (error) => error.statusCode === 400);
});

test("escapes user-provided search text for literal matching", () => {
  assert.equal(escapeRegex("ATM(1)+"), "ATM\\(1\\)\\+");
});
