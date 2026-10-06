import test from "node:test";
import assert from "node:assert/strict";
import ATM from "../src/modules/atms/atm.model.js";
import Region from "../src/modules/region/region.model.js";
import { getDistrictGeographicSummaries } from "../src/modules/districts/district.controller.js";

function invoke(handler) {
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
    handler({}, res, reject);
  });
}

test("returns one aggregated geographic summary per populated district", async () => {
  const originalATM = ATM.aggregate;
  const originalRegion = Region.aggregate;
  const districtId = "64b000000000000000000001";
  const captured = {};
  ATM.aggregate = async (pipeline) => {
    captured.atmPipeline = pipeline;
    return [
      {
        atms: [{ _id: districtId, total: 56 }],
        employees: [{ _id: districtId, total: 12 }],
        customers: [{ _id: districtId, total: 8 }],
      },
    ];
  };
  Region.aggregate = async (pipeline) => {
    captured.regionPipeline = pipeline;
    return [{ _id: districtId, total: 2 }];
  };

  try {
    const { status, body } = await invoke(getDistrictGeographicSummaries);
    assert.equal(status, 200);
    assert.deepEqual(body.data, [
      {
        districtId,
        regions: 2,
        atms: 56,
        employees: 12,
        customers: 8,
      },
    ]);
    assert.ok(captured.atmPipeline.some((stage) => stage.$facet));
    assert.ok(captured.regionPipeline.some((stage) => stage.$match?.isActive));
  } finally {
    ATM.aggregate = originalATM;
    Region.aggregate = originalRegion;
  }
});
