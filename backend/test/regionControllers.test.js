import test from "node:test";
import assert from "node:assert/strict";
import District from "../src/modules/districts/district.models.js";
import Region from "../src/modules/region/region.model.js";
import {
  getAllRegions,
  getAllRegionsByDistrict,
  getRegionById,
  getRegionsByDistrict,
  updateRegion,
  deleteRegion,
} from "../src/modules/region/region.controller.js";
import { updateRegionSchema } from "../src/modules/region/region.validate.js";

const districtId = "64b000000000000000000001";
const regionId = "64b000000000000000000002";

function invoke(handler, req) {
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
    handler(req, res, reject);
  });
}

function queryChain(value, capture = {}) {
  return {
    populate() {
      return this;
    },
    sort(sort) {
      capture.sort = sort;
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

test("default Region lists continue returning active regions only", async () => {
  const originalFind = Region.find;
  const originalDistrictFindById = District.findById;
  const captures = [];
  const regions = [{ _id: regionId, isActive: true }];
  Region.find = (filter) => {
    captures.push(filter);
    return queryChain(regions);
  };
  District.findById = async () => ({ _id: districtId });

  try {
    const all = await invoke(getAllRegions, { query: {} });
    const district = await invoke(getRegionsByDistrict, {
      params: { districtId },
    });

    assert.deepEqual(all.body.data, regions);
    assert.deepEqual(district.body.data, regions);
    assert.deepEqual(captures, [
      { isActive: true },
      { districtId, isActive: true },
    ]);
  } finally {
    Region.find = originalFind;
    District.findById = originalDistrictFindById;
  }
});

test("admin District list includes active and inactive Regions", async () => {
  const originalFind = Region.find;
  const originalDistrictFindById = District.findById;
  const captures = [];
  const regions = [
    { _id: regionId, isActive: true },
    { _id: "64b000000000000000000003", isActive: false },
  ];
  Region.find = (filter) => {
    captures.push(filter);
    return queryChain(regions);
  };
  District.findById = async () => ({ _id: districtId });

  try {
    const { status, body } = await invoke(getAllRegionsByDistrict, {
      params: { districtId },
    });
    assert.equal(status, 200);
    assert.deepEqual(body.data, regions);
    assert.deepEqual(captures, [{ districtId }]);
  } finally {
    Region.find = originalFind;
    District.findById = originalDistrictFindById;
  }
});

test("inactive Region can be loaded by ID and reactivated through a validated update", async () => {
  const originalFindById = Region.findById;
  const originalFindByIdAndUpdate = Region.findByIdAndUpdate;
  const inactiveRegion = {
    _id: regionId,
    districtId,
    name: "Region One",
    isActive: false,
  };
  const activeRegion = { ...inactiveRegion, isActive: true };
  let updateCapture;
  Region.findById = (id) => {
    assert.equal(id, regionId);
    return queryChain(inactiveRegion);
  };
  Region.findByIdAndUpdate = (id, update, options) => {
    updateCapture = { id, update, options };
    return queryChain(activeRegion);
  };

  try {
    const detail = await invoke(getRegionById, { params: { id: regionId } });
    const parsed = updateRegionSchema.safeParse({ isActive: true });
    assert.equal(parsed.success, true);
    const updated = await invoke(updateRegion, {
      params: { id: regionId },
      body: parsed.data,
      user: { _id: "admin-user" },
    });

    assert.equal(detail.body.data.isActive, false);
    assert.equal(updated.body.data.isActive, true);
    assert.deepEqual(updateCapture, {
      id: regionId,
      update: { isActive: true, updatedBy: "admin-user" },
      options: { new: true, runValidators: true },
    });
  } finally {
    Region.findById = originalFindById;
    Region.findByIdAndUpdate = originalFindByIdAndUpdate;
  }
});

test("Region delete remains a soft deactivation", async () => {
  const originalFindOneAndUpdate = Region.findOneAndUpdate;
  let capture;
  const inactiveRegion = { _id: regionId, isActive: false };
  Region.findOneAndUpdate = async (filter, update, options) => {
    capture = { filter, update, options };
    return inactiveRegion;
  };

  try {
    const { status, body } = await invoke(deleteRegion, {
      params: { id: regionId },
      user: { _id: "admin-user" },
    });
    assert.equal(status, 200);
    assert.deepEqual(body.data, inactiveRegion);
    assert.deepEqual(capture, {
      filter: { _id: regionId, isActive: true },
      update: { isActive: false, updatedBy: "admin-user" },
      options: { new: true },
    });
  } finally {
    Region.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
