import test from "node:test";
import assert from "node:assert/strict";
import ATM from "../src/modules/atms/atm.model.js";
import District from "../src/modules/districts/district.models.js";
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

test("returns one geographic summary per District and counts its parent Region", async () => {
  const originalATM = ATM.aggregate;
  const originalDistrict = District.find;
  const districtId = "64b000000000000000000001";
  let atmPipeline;
  District.find = () => ({
    select() {
      return this;
    },
    lean: async () => [{ _id: districtId, regionId: "64b000000000000000000002" }],
  });
  ATM.aggregate = async (pipeline) => {
    atmPipeline = pipeline;
    return [{
      atms: [{ _id: districtId, total: 56 }],
      employees: [{ _id: districtId, total: 12 }],
      customers: [{ _id: districtId, total: 8 }],
    }];
  };

  try {
    const { status, body } = await invoke(getDistrictGeographicSummaries);
    assert.equal(status, 200);
    assert.deepEqual(body.data, [
      {
        districtId,
        regions: 1,
        atms: 56,
        employees: 12,
        customers: 8,
      },
    ]);
    assert.ok(atmPipeline.some((stage) => stage.$facet));
  } finally {
    ATM.aggregate = originalATM;
    District.find = originalDistrict;
  }
});
