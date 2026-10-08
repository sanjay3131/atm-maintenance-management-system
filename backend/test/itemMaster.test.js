import test from "node:test";
import assert from "node:assert/strict";
import Item from "../src/modules/items/item.model.js";
import {
  createItem,
  getAllItems,
  getItemById,
  updateItem,
} from "../src/modules/items/item.controller.js";
import {
  createItemSchema,
  updateItemSchema,
} from "../src/modules/items/item.validation.js";
import { authorizeRoles } from "../src/middlewares/role.middleware.js";
import itemRouter from "../src/modules/items/item.routes.js";
import {
  createItemIndexReadiness,
  initializeItemNameIndex,
  ITEM_NAME_INDEX,
  requireItemNameIndex,
} from "../src/modules/items/itemIndexReadiness.js";

const itemId = "64b000000000000000000071";
const adminId = "64b000000000000000000072";

const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
    };
    handler(req, res, reject);
  });

const captureError = async (handler, req) => {
  try {
    await invoke(handler, req);
    assert.fail("Expected request handler to reject");
  } catch (error) {
    return error;
  }
};

const queryChain = (value, capture = {}) => ({
  select(selection) {
    capture.selection = selection;
    return this;
  },
  sort(sort) {
    capture.sort = sort;
    const selected = value.map((record) => {
      if (capture.selection.startsWith("-")) {
        const result = { ...record };
        delete result[capture.selection.slice(1)];
        if (capture.selection === "-normalizedName") {
          delete result.normalizedName;
        }
        return result;
      }
      const fields = capture.selection.split(/\s+/);
      return Object.fromEntries(
        Object.entries(record).filter(
          ([key]) => key === "_id" || fields.includes(key),
        ),
      );
    });
    return Promise.resolve(selected);
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

test("Item schema supports flexible units and protects normalized names", () => {
  assert.deepEqual(
    createItemSchema.parse({
      itemName: "  Cleaning fluid ",
      unit: "litre",
      currentUnitCost: 0,
    }),
    {
      itemName: "Cleaning fluid",
      unit: "litre",
      currentUnitCost: 0,
    },
  );

  const indexes = Item.schema.indexes();
  assert.ok(
    indexes.some(
      ([keys, options]) =>
        keys.normalizedName === 1 && options.unique === true,
    ),
  );
  assert.equal(
    Item.schema.path("normalizedName").options.select,
    false,
  );
  assert.deepEqual(ITEM_NAME_INDEX, {
    fields: { normalizedName: 1 },
    options: { unique: true, name: "normalizedName_1" },
  });
  const serialized = new Item({
    itemName: "Cable ties",
    normalizedName: "cable ties",
    unit: "packet",
    currentUnitCost: 2.5,
    createdBy: adminId,
  }).toJSON();
  assert.equal("normalizedName" in serialized, false);
});

test("Item writes remain blocked until index initialization succeeds", async () => {
  let createIndexCalls = 0;
  const readiness = createItemIndexReadiness(async () => {
    createIndexCalls += 1;
    await Promise.resolve();
  });
  const requireReady = () =>
    new Promise((resolve) => {
      readiness.requireReady({}, {}, (error) => resolve(error));
    });

  const initialization = readiness.initialize();
  const pendingError = await requireReady();
  assert.equal(pendingError.statusCode, 503);

  await initialization;
  assert.equal(await requireReady(), undefined);
  assert.equal(createIndexCalls, 1);
  await readiness.initialize();
  assert.equal(createIndexCalls, 1);
});

test("failed index initialization remains visible and never enables Item writes", async () => {
  let createIndexCalls = 0;
  const indexError = new Error("index build failed");
  const readiness = createItemIndexReadiness(async () => {
    createIndexCalls += 1;
    throw indexError;
  });
  const requireReady = () =>
    new Promise((resolve) => {
      readiness.requireReady({}, {}, (error) => resolve(error));
    });

  await assert.rejects(readiness.initialize(), indexError);
  assert.equal((await requireReady()).statusCode, 503);
  await assert.rejects(readiness.initialize(), indexError);
  assert.equal(createIndexCalls, 1);
});

test("startup confirms the declared unique index before marking Item writes ready", async () => {
  const originalCreateIndex = Item.collection.createIndex;
  let requestedIndex;
  Item.collection.createIndex = async (fields, options) => {
    requestedIndex = { fields, options };
    return options.name;
  };

  try {
    await initializeItemNameIndex();
    assert.deepEqual(requestedIndex, ITEM_NAME_INDEX);

    const readinessError = await new Promise((resolve) => {
      requireItemNameIndex({}, {}, resolve);
    });
    assert.equal(readinessError, undefined);
  } finally {
    Item.collection.createIndex = originalCreateIndex;
  }
});

test("Item create validation rejects missing names, invalid units, invalid costs, and protected fields", () => {
  const valid = {
    itemName: "Filter",
    unit: "piece",
    currentUnitCost: 12,
  };
  assert.equal(createItemSchema.safeParse(valid).success, true);
  assert.equal(
    createItemSchema.safeParse({ ...valid, itemName: "  " }).success,
    false,
  );
  assert.equal(createItemSchema.safeParse({ ...valid, unit: "" }).success, false);
  const missingCost = { ...valid };
  delete missingCost.currentUnitCost;
  assert.equal(createItemSchema.safeParse(missingCost).success, false);
  assert.equal(
    createItemSchema.safeParse({ ...valid, currentUnitCost: -1 }).success,
    false,
  );
  assert.equal(
    createItemSchema.safeParse({ ...valid, currentUnitCost: Infinity }).success,
    false,
  );
  assert.equal(
    createItemSchema.safeParse({ ...valid, createdBy: adminId }).success,
    false,
  );
});

test("update validation accepts reactivation and rejects empty or mass-assignment updates", () => {
  assert.deepEqual(updateItemSchema.parse({ isActive: true }), {
    isActive: true,
  });
  assert.equal(updateItemSchema.safeParse({}).success, false);
  assert.equal(
    updateItemSchema.safeParse({
      currentUnitCost: 10,
      createdAt: new Date(),
    }).success,
    false,
  );
  assert.equal(
    updateItemSchema.safeParse({ normalizedName: "forged" }).success,
    false,
  );
});

test("admin and superAdmin may create Item Master records", async (t) => {
  const originalCreate = Item.create;
  const created = [];
  Item.create = async (data) => {
    created.push(data);
    return data;
  };

  try {
    for (const role of ["admin", "superAdmin"]) {
      await t.test(`${role} creation`, async () => {
        const request = {
          user: { _id: adminId, userType: role },
        };
        let nextError;
        authorizeRoles("admin", "superAdmin")(
          request,
          {},
          (error) => {
            nextError = error;
          },
        );
        assert.equal(nextError, undefined);

        const result = await invoke(createItem, {
          ...request,
          body: {
            itemName: "  Cable Ties ",
            unit: "packet",
            currentUnitCost: 2.5,
          },
        });
        assert.equal(result.status, 201);
      });
    }
  } finally {
    Item.create = originalCreate;
  }

  assert.deepEqual(created.map((entry) => entry.createdBy), [adminId, adminId]);
  assert.deepEqual(
    created.map((entry) => entry.normalizedName),
    ["cable ties", "cable ties"],
  );
});

test("other roles are forbidden from managing Items", () => {
  for (const userType of ["employee", "customer", "supervisor"]) {
    assert.throws(
      () =>
        authorizeRoles("admin", "superAdmin")(
          { user: { userType } },
          {},
          () => {},
        ),
      { statusCode: 403 },
    );
  }
});

test("Item routes allow employees to list only and keep management restricted", () => {
  const getRoute = itemRouter.stack.find(
    (layer) => layer.route?.path === "/" && layer.route.methods.get,
  )?.route;
  const postRoute = itemRouter.stack.find(
    (layer) => layer.route?.path === "/" && layer.route.methods.post,
  )?.route;
  const detailRoute = itemRouter.stack.find(
    (layer) => layer.route?.path === "/:id" && layer.route.methods.get,
  )?.route;
  const updateRoute = itemRouter.stack.find(
    (layer) => layer.route?.path === "/:id" && layer.route.methods.put,
  )?.route;

  assert.ok(getRoute);
  assert.ok(postRoute);
  assert.ok(detailRoute);
  assert.ok(updateRoute);

  for (const role of ["admin", "superAdmin", "employee"]) {
    assert.doesNotThrow(() =>
      getRoute.stack[0].handle({ user: { userType: role } }, {}, () => {}),
    );
  }

  for (const route of [postRoute, detailRoute, updateRoute]) {
    assert.throws(
      () =>
        route.stack[0].handle(
          { user: { userType: "employee" } },
          {},
          () => {},
        ),
      { statusCode: 403 },
    );
    for (const role of ["admin", "superAdmin"]) {
      assert.doesNotThrow(() =>
        route.stack[0].handle({ user: { userType: role } }, {}, () => {}),
      );
    }
  }
});

test("duplicate case variants return a conflict, including concurrent index conflicts", async () => {
  const originalCreate = Item.create;
  Item.create = async () => {
    const error = new Error("duplicate key");
    error.code = 11000;
    throw error;
  };

  try {
    const error = await captureError(createItem, {
      user: { _id: adminId },
      body: {
        itemName: "cAbLe TiEs",
        unit: "packet",
        currentUnitCost: 2.5,
      },
    });
    assert.equal(error.statusCode, 409);
    assert.match(error.message, /already exists/);
  } finally {
    Item.create = originalCreate;
  }
});

test("Employee Item lists expose only safe active fields while Admins retain costs", async () => {
  const originalFind = Item.find;
  const capture = {};
  const activeItem = {
    _id: itemId,
    itemName: "Air filter",
    unit: "piece",
    isActive: true,
    currentUnitCost: 12.5,
    replacementCost: 15,
    normalizedName: "air filter",
    createdBy: adminId,
  };
  const inactiveItem = {
    ...activeItem,
    _id: "64b000000000000000000073",
    itemName: "Inactive filter",
    isActive: false,
  };
  const records = [activeItem, inactiveItem];
  Item.find = (filter) => {
    capture.filter = filter;
    return queryChain(
      records.filter(
        (record) =>
          filter.isActive === undefined || record.isActive === filter.isActive,
      ),
      capture,
    );
  };

  try {
    for (const query of [{}, { isActive: "false" }, { isActive: "sometimes" }]) {
      const result = await invoke(getAllItems, {
        user: { userType: "employee" },
        query,
      });
      assert.deepEqual(capture.filter, { isActive: true });
      assert.equal(capture.selection, "_id itemName unit isActive");
      assert.deepEqual(result.body.data, [
        {
          _id: itemId,
          itemName: "Air filter",
          unit: "piece",
          isActive: true,
        },
      ]);
      for (const item of result.body.data) {
        assert.equal("currentUnitCost" in item, false);
        assert.equal("replacementCost" in item, false);
        assert.equal("normalizedName" in item, false);
        assert.equal("createdBy" in item, false);
      }
      assert.deepEqual(capture.sort, { itemName: 1 });
    }

    const adminResult = await invoke(getAllItems, {
      user: { userType: "admin" },
      query: {},
    });
    assert.deepEqual(capture.filter, {});
    assert.equal(capture.selection, "-normalizedName");
    assert.equal(adminResult.body.data.length, 2);
    assert.equal(adminResult.body.data[0].currentUnitCost, 12.5);
    assert.equal("normalizedName" in adminResult.body.data[0], false);

    const superAdminResult = await invoke(getAllItems, {
      user: { userType: "superAdmin" },
      query: { isActive: "false" },
    });
    assert.deepEqual(capture.filter, { isActive: false });
    assert.equal(superAdminResult.body.data.length, 1);
    assert.equal(superAdminResult.body.data[0].currentUnitCost, 12.5);

    await assert.rejects(
      invoke(getAllItems, {
        user: { userType: "admin" },
        query: { isActive: "sometimes" },
      }),
      { statusCode: 400 },
    );
  } finally {
    Item.find = originalFind;
  }
});

test("inactive Item can be reactivated without allowing protected-field assignment", async () => {
  const originalFindById = Item.findById;
  const inactive = {
    _id: itemId,
    itemName: "Filter",
    normalizedName: "filter",
    unit: "piece",
    currentUnitCost: 5,
    isActive: false,
    createdBy: "original-creator",
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
    },
  };
  Item.findById = async () => inactive;

  try {
    const result = await invoke(updateItem, {
      params: { id: itemId },
      body: { isActive: true },
      user: { _id: adminId },
    });
    assert.equal(result.status, 200);
    assert.equal(inactive.isActive, true);
    assert.equal(inactive.createdBy, "original-creator");
    assert.equal(inactive.updatedBy, adminId);
    assert.equal(inactive.saveCalls, 1);
    assert.equal("createdAt" in inactive, false);
  } finally {
    Item.findById = originalFindById;
  }
});

test("invalid and nonexistent Item IDs produce distinct client errors", async () => {
  const originalFindById = Item.findById;
  Item.findById = async () => null;

  try {
    const invalid = await captureError(getItemById, {
      params: { id: "not-an-object-id" },
    });
    assert.equal(invalid.statusCode, 400);

    const missing = await captureError(getItemById, {
      params: { id: itemId },
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    Item.findById = originalFindById;
  }
});
