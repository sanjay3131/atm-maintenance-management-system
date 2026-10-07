import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import Customer from "../src/modules/customers/customer.model.js";
import User from "../src/modules/users/user.model.js";
import { createUserWizard } from "../src/modules/users/user.controller.js";
import {
  assignATMCustomerInTransaction,
  softDeleteATMAndUnlinkCustomer,
  softDeleteCustomerIfUnassigned,
  withCustomerAssignmentTransaction,
} from "../src/modules/customers/customerAssignment.service.js";
import {
  createCustomer,
  updateCustomer,
} from "../src/modules/customers/customer.controller.js";

const atmId = "64b000000000000000000001";
const customerAId = "64b000000000000000000002";
const customerBId = "64b000000000000000000003";

function query(value) {
  return {
    session() {
      return Promise.resolve(value);
    },
    select() {
      return this;
    },
  };
}

async function withOverrides(overrides, callback) {
  const originals = overrides.map(([target, key]) => [
    target,
    key,
    target[key],
  ]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    return await callback();
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

function invoke(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
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

function createState({ inactive = false, deleted = false } = {}) {
  const state = {
    atm: {
      _id: atmId,
      isDeleted: false,
      customer: customerAId,
      async save() {},
    },
    customers: new Map([
      [
        customerAId,
        {
          _id: customerAId,
          isActive: true,
          isDeleted: false,
          atmIds: [atmId],
          async save() {},
        },
      ],
      [
        customerBId,
        {
          _id: customerBId,
          isActive: !inactive,
          isDeleted: deleted,
          atmIds: [],
          userId: "user-id",
          async save() {},
        },
      ],
    ]),
    userStatus: "active",
    activeATMFound: false,
    updateManyCalls: [],
  };
  return state;
}

function modelOverrides(state) {
  const session = {
    async withTransaction(operation) {
      return operation(this);
    },
    async endSession() {},
  };
  return [
    [mongoose, "startSession", async () => session],
    [
      ATM,
      "findOne",
      (filter) =>
        query(
          filter.customer
            ? state.activeATMFound
              ? { _id: atmId }
              : null
            : filter._id === atmId && !state.atm.isDeleted
              ? state.atm
              : null,
        ),
    ],
    [
      Customer,
      "findOne",
      (filter) =>
        query(
          [...state.customers.values()].find(
            (customer) =>
              String(customer._id) === String(filter._id) &&
              (!filter.isActive || customer.isActive) &&
              (!Object.hasOwn(filter, "isDeleted") ||
                customer.isDeleted === filter.isDeleted),
          ) ?? null,
        ),
    ],
    [
      Customer,
      "updateMany",
      async (filter, update) => {
        state.updateManyCalls.push({ filter, update });
        for (const customer of state.customers.values()) {
          if (
            (!filter._id?.$ne ||
              String(customer._id) !== String(filter._id.$ne)) &&
            customer.atmIds.some((id) => String(id) === String(atmId))
          ) {
            customer.atmIds = customer.atmIds.filter(
              (id) => String(id) !== String(atmId),
            );
          }
        }
      },
    ],
    [
      User,
      "findByIdAndUpdate",
      async (_id, update) => {
        state.userStatus = update.status;
      },
    ],
  ];
}

const assignment = (state, customerId = customerBId) =>
  assignATMCustomerInTransaction({
    atm: state.atm,
    atmId,
    customerId,
    updatedBy: "admin-id",
    session: {},
  });

test("assigns a valid Customer and keeps both relationship sides synchronized", async () => {
  const state = createState();
  await withOverrides(modelOverrides(state), async () => {
    await withCustomerAssignmentTransaction((session) =>
      assignATMCustomerInTransaction({
        atm: state.atm,
        atmId,
        customerId: customerBId,
        updatedBy: "admin-id",
        session,
      }),
    );
  });

  assert.equal(String(state.atm.customer), customerBId);
  assert.deepEqual(state.customers.get(customerAId).atmIds, []);
  assert.deepEqual(state.customers.get(customerBId).atmIds, [atmId]);
});

test("repeated assignment removes duplicates and retains exactly one reverse ID", async () => {
  const state = createState();
  state.customers.get(customerBId).atmIds = [atmId, atmId];

  await withOverrides(modelOverrides(state), async () => {
    await assignment(state);
    await assignment(state);
  });

  assert.deepEqual(state.customers.get(customerBId).atmIds, [atmId]);
});

test("rejects nonexistent, inactive, and deleted destination Customers without changing links", async (t) => {
  for (const scenario of [
    { name: "nonexistent", state: createState() },
    { name: "inactive", state: createState({ inactive: true }) },
    { name: "deleted", state: createState({ deleted: true }) },
  ]) {
    await t.test(scenario.name, async () => {
      const { state } = scenario;
      const overrides = modelOverrides(state).map(([target, key, value]) =>
        target === Customer && key === "findOne" && scenario.name === "nonexistent"
          ? [target, key, () => query(null)]
          : [target, key, value],
      );
      await withOverrides(overrides, async () => {
        await assert.rejects(assignment(state), /Customer not found/);
      });
      assert.equal(String(state.atm.customer), customerAId);
      assert.deepEqual(state.customers.get(customerAId).atmIds, [atmId]);
      assert.deepEqual(state.customers.get(customerBId).atmIds, []);
    });
  }
});

test("rejects reassignment for a missing or deleted ATM", async () => {
  const state = createState();
  state.atm.isDeleted = true;
  await withOverrides(modelOverrides(state), async () => {
    await assert.rejects(assignment(state), /ATM not found/);
  });
  assert.deepEqual(state.customers.get(customerAId).atmIds, [atmId]);
});

test("ATM soft deletion unlinks reverse references without touching operational models", async () => {
  const state = createState();
  await withOverrides(modelOverrides(state), async () => {
    await softDeleteATMAndUnlinkCustomer({
      atmId,
      updatedBy: "admin-id",
    });
  });

  assert.equal(state.atm.isDeleted, true);
  assert.deepEqual(state.customers.get(customerAId).atmIds, []);
  assert.deepEqual(state.customers.get(customerBId).atmIds, []);
});

test("Customer deletion is rejected while an active ATM references it", async () => {
  const state = createState();
  state.activeATMFound = true;
  await withOverrides(modelOverrides(state), async () => {
    await assert.rejects(
      softDeleteCustomerIfUnassigned({
        customerId: customerAId,
        updatedBy: "admin-id",
      }),
      /active ATMs are assigned/,
    );
  });

  assert.equal(state.customers.get(customerAId).isDeleted, false);
  assert.equal(state.userStatus, "active");
});

test("Customer deletion succeeds when there are no active ATM assignments", async () => {
  const state = createState();
  state.customers.get(customerAId).atmIds = [];
  await withOverrides(modelOverrides(state), async () => {
    await softDeleteCustomerIfUnassigned({
      customerId: customerAId,
      updatedBy: "admin-id",
    });
  });

  assert.equal(state.customers.get(customerAId).isDeleted, true);
  assert.equal(state.userStatus, "inactive");
});

test("Customer update rejects atmIds instead of mutating the reverse index", async () => {
  const customer = {
    _id: customerAId,
    userId: "admin-id",
    isDeleted: false,
  };
  await withOverrides(
    [[Customer, "findById", async () => customer]],
    async () => {
      await assert.rejects(
        new Promise((resolve, reject) =>
          updateCustomer(
            {
              params: { id: customerAId },
              body: { atmIds: [atmId] },
              user: { _id: "admin-id", userType: "admin" },
            },
            { status: () => ({ json: resolve }) },
            reject,
          ),
        ),
        /ATM assignments can only be changed through ATM management/,
      );
    },
  );
});

test("Customer update sends only editable fields and returns a serializable customer DTO", async () => {
  const updatedCustomer = {
    _id: customerBId,
    customerName: "Updated Customer",
    customerPhone: "1234567890",
    bankName: "Example Bank",
    isActive: true,
  };
  const mongoClient = {};
  mongoClient.s = { sessionPool: { client: mongoClient } };
  const mongoQuery = {
    mongoClient,
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(updatedCustomer).then(resolve, reject);
    },
  };
  let capturedUpdate;
  let capturedOptions;

  await withOverrides(
    [
      [
        Customer,
        "findById",
        async () => ({
          _id: customerBId,
          userId: "customer-user-id",
          isDeleted: false,
        }),
      ],
      [
        Customer,
        "findByIdAndUpdate",
        (id, update, options) => {
          assert.equal(id, customerBId);
          capturedUpdate = update;
          capturedOptions = options;
          return mongoQuery;
        },
      ],
    ],
    async () => {
      const { status, body } = await invoke(updateCustomer, {
        params: { id: customerBId },
        body: {
          customerName: updatedCustomer.customerName,
          customerPhone: updatedCustomer.customerPhone,
          bankName: updatedCustomer.bankName,
        },
        user: { _id: "admin-id", userType: "admin" },
      });

      assert.equal(status, 200);
      assert.deepEqual(body.data, updatedCustomer);
      assert.doesNotThrow(() => JSON.stringify(body));
      assert.deepEqual(capturedUpdate, {
        customerName: updatedCustomer.customerName,
        customerPhone: updatedCustomer.customerPhone,
        bankName: updatedCustomer.bankName,
        updatedBy: "admin-id",
      });
      assert.deepEqual(capturedOptions, {
        new: true,
        runValidators: true,
      });
      assert.equal("atmIds" in capturedUpdate, false);
      assert.equal("session" in capturedUpdate, false);
      assert.equal("mongoClient" in capturedUpdate, false);
    },
  );
});

test("Customer creation and the user wizard ignore supplied ATM IDs", async () => {
  const createdCustomers = [];
  const user = {
    _id: "user-id",
    toObject: () => ({
      _id: "user-id",
      firstName: "Customer",
      email: "customer@example.com",
      password: "hashed",
    }),
  };
  const overrides = [
    [User, "findOne", async () => null],
    [User, "create", async () => user],
    [
      Customer,
      "create",
      async (data) => {
        createdCustomers.push(data);
        return data;
      },
    ],
  ];

  await withOverrides(overrides, async () => {
    await invoke(createCustomer, {
      user: { _id: "admin-id", userType: "admin" },
      body: {
        firstName: "Customer",
        email: "customer@example.com",
        password: "password123",
        phoneNumber: "1234567890",
        customerName: "Customer",
        customerPhone: "1234567890",
        bankName: "Bank",
        atmIds: [atmId],
      },
    });
    await invoke(createUserWizard, {
      user: { _id: "admin-id" },
      body: {
        user: {
          firstName: "Customer",
          email: "wizard@example.com",
          password: "password123",
          phoneNumber: "0987654321",
        },
        role: "customer",
        customer: {
          customerName: "Wizard Customer",
          customerEmail: "wizard@example.com",
          customerPhone: "0987654321",
          bankName: "Bank",
          atmIds: [atmId],
        },
      },
    });
  });

  assert.equal(createdCustomers.length, 2);
  assert.deepEqual(
    createdCustomers.map(({ atmIds }) => atmIds),
    [[], []],
  );
});

test("transaction failure rejects the operation and closes its session", async () => {
  let ended = false;
  const session = {
    async withTransaction(operation) {
      await operation(this);
      throw new Error("commit failed");
    },
    async endSession() {
      ended = true;
    },
  };
  await withOverrides(
    [[mongoose, "startSession", async () => session]],
    async () => {
      await assert.rejects(
        withCustomerAssignmentTransaction(async () => "written"),
        /commit failed/,
      );
    },
  );
  assert.equal(ended, true);
});

test("transaction failure after the ATM write leaves both persisted sides unchanged", async () => {
  const persisted = {
    atmCustomer: customerAId,
    customerAAtms: [atmId],
    customerBAtms: [],
  };
  const atm = {
    _id: atmId,
    isDeleted: false,
    customer: customerAId,
    async save({ session }) {
      assert.equal(session, transactionSession);
      persisted.atmCustomer = this.customer;
    },
  };
  const destination = {
    _id: customerBId,
    isActive: true,
    isDeleted: false,
    atmIds: [],
    async save({ session }) {
      assert.equal(session, transactionSession);
      throw new Error("Customer write failed");
    },
  };
  const transactionSession = {
    async withTransaction(operation) {
      const previous = structuredClone(persisted);
      try {
        await operation(this);
      } catch (error) {
        Object.assign(persisted, previous);
        throw error;
      }
    },
    async endSession() {},
  };
  const overrides = [
    [mongoose, "startSession", async () => transactionSession],
    [ATM, "findOne", () => query(atm)],
    [Customer, "findOne", () => query(destination)],
    [Customer, "updateMany", async () => {}],
  ];

  await withOverrides(overrides, async () => {
    await assert.rejects(
      withCustomerAssignmentTransaction((session) =>
        assignATMCustomerInTransaction({
          atmId,
          customerId: customerBId,
          updatedBy: "admin-id",
          session,
        }),
      ),
      /Customer write failed/,
    );
  });

  assert.deepEqual(persisted, {
    atmCustomer: customerAId,
    customerAAtms: [atmId],
    customerBAtms: [],
  });
});
