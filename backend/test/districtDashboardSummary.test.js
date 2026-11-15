import assert from "node:assert/strict";
import test from "node:test";
import District from "../src/modules/districts/district.models.js";
import { getDistrictSummary } from "../src/modules/dashboard/dashboard.controller.js";

test("District dashboard summary follows the District's regionId parent reference", async () => {
  const originalAggregate = District.aggregate;
  let pipeline;
  District.aggregate = async (value) => {
    pipeline = value;
    return [];
  };
  try {
    await new Promise((resolve, reject) => {
      const response = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          resolve({ status: this.statusCode, body });
          return this;
        },
      };
      getDistrictSummary({ user: { userType: "admin" } }, response, reject);
    });
    const regionLookup = pipeline.find((stage) => stage.$lookup?.from === "regions");
    assert.deepEqual(regionLookup.$lookup.localField, "regionId");
    assert.deepEqual(regionLookup.$lookup.foreignField, "_id");
    assert.equal(regionLookup.$lookup.let, undefined);
  } finally {
    District.aggregate = originalAggregate;
  }
});
