import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import Bank from "../src/modules/banks/bank.model.js";
import District from "../src/modules/districts/district.models.js";
import Customer from "../src/modules/customers/customer.model.js";
import CustomerCodeSequence from "../src/modules/customers/customerCodeSequence.model.js";
import Region from "../src/modules/region/region.model.js";
import User from "../src/modules/users/user.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import { CustomerCodeSequenceError } from "../src/modules/customers/customerCode.service.js";
import { mapCustomerCodeError } from "../src/modules/customers/customerCode.errors.js";
import {
  createCustomerUserWizard,
  createUserWizard,
} from "../src/modules/users/user.controller.js";
import {
  addCustomerATMsSchema,
} from "../src/modules/customers/customer.validation.js";
import {
  createCustomerUserWizardSchema,
} from "../src/modules/users/user-wizard.validate.js";
import {
  addATMsToCustomerInTransaction,
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
const secondAtmId = "64b000000000000000000007";
const existingCustomerAtmId = "64b000000000000000000008";

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
      bankId: "64b000000000000000000004",
      districtId: "64b000000000000000000005",
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
          bankName: "Example Bank",
          districtIds: [],
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
        Bank,
        "findOne",
        () => query({
          _id: "64b000000000000000000004",
          bankName: "Example Bank",
          isActive: true,
        }),
    ],
    [
      Customer,
      "updateMany",
      async (filter, update) => {
        state.updateManyCalls.push({ filter, update });
        const assignedATMId = filter.atmIds;
        for (const customer of state.customers.values()) {
          if (
            (!filter._id?.$ne ||
              String(customer._id) !== String(filter._id.$ne)) &&
            customer.atmIds.some(
              (id) => String(id) === String(assignedATMId),
            )
          ) {
            customer.atmIds = customer.atmIds.filter(
              (id) => String(id) !== String(assignedATMId),
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

test("adding multiple ATMs appends ownership and keeps ATM and customer links reciprocal", async () => {
  const state = createState();
  const secondATM = {
    ...state.atm,
    _id: secondAtmId,
    async save() {},
  };
  state.customers.get(customerAId).atmIds.push(secondAtmId);
  state.customers.get(customerBId).atmIds = [existingCustomerAtmId];
  const overrides = modelOverrides(state).map(([target, key, value]) =>
    target === ATM && key === "findOne"
      ? [
          target,
          key,
          (filter) =>
            query(
              filter._id === secondAtmId
                ? secondATM
                : filter._id === atmId
                  ? state.atm
                  : null,
            ),
        ]
      : [target, key, value],
  );
  await withOverrides(overrides, async () => {
    await withCustomerAssignmentTransaction((session) =>
      addATMsToCustomerInTransaction({
        customerId: customerBId,
        atmIds: [atmId, secondAtmId],
        updatedBy: "admin-id",
        session,
      }),
    );
  });

  assert.equal(String(state.atm.customer), customerBId);
  assert.equal(String(secondATM.customer), customerBId);
  assert.deepEqual(state.customers.get(customerAId).atmIds, []);
  assert.deepEqual(state.customers.get(customerBId).atmIds, [
    existingCustomerAtmId,
    atmId,
    secondAtmId,
  ]);
});

test("customer ATM assignment rejects duplicate IDs and incompatible bank ownership", async () => {
  const duplicateIds = addCustomerATMsSchema.safeParse({
    atmIds: [atmId, atmId.toUpperCase()],
  });
  assert.equal(duplicateIds.success, false);

  const state = createState();
  state.atm.bankId = "64b000000000000000000006";
  await withOverrides(modelOverrides(state), async () => {
    await assert.rejects(
      addATMsToCustomerInTransaction({
        customerId: customerBId,
        atmIds: [atmId],
        updatedBy: "admin-id",
        session: {},
      }),
      /ATM bank does not match/,
    );
  });
  assert.equal(String(state.atm.customer), customerAId);
  assert.deepEqual(state.customers.get(customerAId).atmIds, [atmId]);
  assert.deepEqual(state.customers.get(customerBId).atmIds, []);
});

test("customer ATM assignment rejects ATMs outside the customer's assigned districts", async () => {
  const state = createState();
  state.customers.get(customerBId).serviceDistrictIds = [state.atm.districtId];
  state.customers.get(customerBId).districtIds = [
    "64b000000000000000000009",
  ];
  await withOverrides(modelOverrides(state), async () => {
    await assert.rejects(
      addATMsToCustomerInTransaction({
        customerId: customerBId,
        atmIds: [atmId],
        updatedBy: "admin-id",
        session: {},
      }),
      /ATM district is not assigned/,
    );
  });
  assert.equal(String(state.atm.customer), customerAId);
  assert.deepEqual(state.customers.get(customerAId).atmIds, [atmId]);
});

test("customer-specific user wizard ignores a client-supplied role", async () => {
  const user = {
    _id: "user-id",
    userType: "customer",
    toObject: () => ({
      _id: "user-id",
      firstName: "Wizard",
      email: "wizard-customer@example.com",
      userType: "customer",
    }),
  };
  let createdUser;
  let createdCustomer;
  const payload = {
    user: {
      firstName: "Wizard",
      lastName: "Customer",
      email: "wizard-customer@example.com",
      password: "password123",
      phoneNumber: "1234567890",
    },
    customer: {
      customerName: "Wizard Customer",
      customerEmail: "wizard-customer@example.com",
      customerPhone: "1234567890",
      bankName: "Example Bank",
      districtIds: [],
    },
    role: "supervisor",
  };
  const parsed = createCustomerUserWizardSchema.safeParse(payload);
  assert.equal(parsed.success, true);
  assert.equal("role" in parsed.data, false);
  const customerWithoutBank = {
    ...payload,
    customer: { ...payload.customer, bankName: undefined },
  };
  assert.equal(
    createCustomerUserWizardSchema.safeParse(customerWithoutBank).success,
    true,
  );

  await withOverrides(
    [
      [User, "findOne", async () => null],
      [
        Bank,
        "findOne",
        async () => ({
          _id: "64b000000000000000000004",
          bankName: "Example Bank",
          isActive: true,
        }),
      ],
      [
        User,
        "create",
        async (data) => {
          createdUser = data;
          return user;
        },
      ],
      [CustomerCodeSequence, "findOneAndUpdate", async () => ({ value: 91 })],
      [
        Customer,
        "create",
        async (data) => {
          createdCustomer = data;
          return data;
        },
      ],
    ],
    async () => {
      await invoke(createCustomerUserWizard, {
        user: { _id: "admin-id" },
        body: payload,
      });
    },
  );

  assert.equal(createdUser.userType, "customer");
  assert.equal(createdCustomer.userId, "user-id");
  assert.equal(createdCustomer.customerCode, "CUS-000091");
  assert.equal(createdCustomer.bankName, "Example Bank");
});

test("customer-specific user wizard creates a Customer without a Bank", async () => {
  const createdCustomer = {};
  const user = {
    _id: "customer-without-bank-user",
    toObject: () => ({ _id: "customer-without-bank-user" }),
  };

  await withOverrides(
    [
      [User, "findOne", async () => null],
      [
        Bank,
        "findOne",
        () => {
          throw new Error("Bank lookup should be skipped when no Bank is selected");
        },
      ],
      [User, "create", async () => user],
      [CustomerCodeSequence, "findOneAndUpdate", async () => ({ value: 95 })],
      [
        Customer,
        "create",
        async (data) => {
          Object.assign(createdCustomer, data);
          return data;
        },
      ],
    ],
    async () => {
      const { status } = await invoke(createCustomerUserWizard, {
        user: { _id: "admin-id" },
        body: {
          user: {
            firstName: "No",
            lastName: "Bank",
            email: "customer-without-bank@example.com",
            password: "password123",
            phoneNumber: "1234567890",
          },
          customer: {
            customerName: "No Bank Customer",
            customerEmail: "customer-without-bank@example.com",
            customerPhone: "1234567890",
            districtIds: [],
          },
        },
      });

      assert.equal(status, 201);
    },
  );

  assert.equal(createdCustomer.bankName, "");
  assert.equal("bankId" in createdCustomer, false);
});

test("direct customer creation cleans up its new User when Customer creation fails", async () => {
  const user = { _id: "direct-user-id" };
  const customerError = new Error("customer insert failed");
  let deletedUserId;
  await withOverrides(
    [
      [User, "findOne", async () => null],
      [CustomerCodeSequence, "findOneAndUpdate", async () => ({ value: 92 })],
      [User, "create", async () => user],
      [
        User,
        "findByIdAndDelete",
        async (userId) => {
          deletedUserId = userId;
        },
      ],
      [Customer, "create", async () => { throw customerError; }],
    ],
    async () => {
      await assert.rejects(
        invoke(createCustomer, {
          user: { _id: "admin-id", userType: "admin" },
          body: {
            firstName: "Customer",
            email: "customer-cleanup@example.com",
            password: "password123",
            phoneNumber: "1234567890",
            customerName: "Customer",
            customerPhone: "1234567890",
            bankName: "Bank",
          },
        }),
        (error) => error === customerError,
      );
    },
  );
  assert.equal(deletedUserId, user._id);
});

test("direct customer creation retains both errors if User cleanup fails", async () => {
  const customerError = new Error("customer insert failed");
  const cleanupError = new Error("user cleanup failed");
  await withOverrides(
    [
      [User, "findOne", async () => null],
      [CustomerCodeSequence, "findOneAndUpdate", async () => ({ value: 93 })],
      [User, "create", async () => ({ _id: "direct-user-id" })],
      [User, "findByIdAndDelete", async () => { throw cleanupError; }],
      [Customer, "create", async () => { throw customerError; }],
    ],
    async () => {
      await assert.rejects(
        invoke(createCustomer, {
          user: { _id: "admin-id", userType: "admin" },
          body: {
            firstName: "Customer",
            email: "customer-cleanup-failure@example.com",
            password: "password123",
            phoneNumber: "1234567890",
            customerName: "Customer",
            customerPhone: "1234567890",
            bankName: "Bank",
          },
        }),
        (error) =>
          error instanceof AggregateError &&
          error.errors[0] === customerError &&
          error.errors[1] === cleanupError &&
          error.cause === customerError,
      );
    },
  );
});

test("customer wizard cleans up its new User when Customer creation fails", async () => {
  const customerError = new Error("customer insert failed");
  let deletedUserId;
  await withOverrides(
    [
      [User, "findOne", async () => null],
      [CustomerCodeSequence, "findOneAndUpdate", async () => ({ value: 94 })],
      [User, "create", async () => ({ _id: "wizard-user-id" })],
      [
        User,
        "findByIdAndDelete",
        async (userId) => {
          deletedUserId = userId;
        },
      ],
      [Customer, "create", async () => { throw customerError; }],
    ],
    async () => {
      await assert.rejects(
        invoke(createUserWizard, {
          user: { _id: "admin-id" },
          body: {
            user: {
              firstName: "Wizard",
              email: "wizard-cleanup@example.com",
              password: "password123",
              phoneNumber: "1234567891",
            },
            role: "customer",
            customer: {
              customerName: "Wizard Customer",
              customerEmail: "wizard-cleanup@example.com",
              customerPhone: "1234567891",
              bankName: "Bank",
              districtIds: [],
            },
          },
        }),
        (error) => error === customerError,
      );
    },
  );
  assert.equal(deletedUserId, "wizard-user-id");
});

test("employee and supervisor wizard paths do not allocate customer codes", async () => {
  let customerCodeAllocations = 0;
  const user = {
    _id: "wizard-user-id",
    toObject: () => ({ _id: "wizard-user-id", userType: "employee" }),
  };
  await withOverrides(
    [
      [User, "findOne", async () => null],
      [User, "create", async () => user],
      [
        CustomerCodeSequence,
        "findOneAndUpdate",
        async () => {
          customerCodeAllocations += 1;
          throw new Error("customer code generation must not run");
        },
      ],
      [
        Employee,
        "findOne",
        () => ({ sort: async () => null }),
      ],
      [Employee, "create", async () => ({ _id: "employee-id" })],
    ],
    async () => {
      await invoke(createUserWizard, {
        user: { _id: "admin-id" },
        body: {
          user: {
            firstName: "Employee",
            email: "employee-no-customer-code@example.com",
            password: "password123",
            phoneNumber: "1234567892",
          },
          role: "employee",
          employee: {
            designation: "Technician",
            department: "Maintenance",
            employmentType: "full-time",
            districtIds: [],
            assignedAtmIds: [],
            regionIds: [],
          },
        },
      });
      await invoke(createUserWizard, {
        user: {
          _id: "admin-id",
        },
        body: {
          user: {
            firstName: "Supervisor",
            email: "supervisor-no-customer-code@example.com",
            password: "password123",
            phoneNumber: "1234567893",
          },
          role: "supervisor",
        },
      });
    },
  );
  assert.equal(customerCodeAllocations, 0);
});

test("customer-code sequence errors map to 503", () => {
  for (const code of [
    "CUSTOMER_CODE_SEQUENCE_NOT_INITIALIZED",
    "CUSTOMER_CODE_SEQUENCE_INVALID",
    "CUSTOMER_CODE_SEQUENCE_EXHAUSTED",
  ]) {
    const mapped = mapCustomerCodeError(
      new CustomerCodeSequenceError("sequence unavailable", code),
    );
    assert.equal(mapped.statusCode, 503);
    assert.equal(mapped.message, "sequence unavailable");
  }
});

test("only customerCode duplicate-key errors map to 409", () => {
  for (const duplicateError of [
    Object.assign(new Error("duplicate"), {
      code: 11000,
      keyPattern: { customerCode: 1 },
    }),
    Object.assign(new Error("duplicate"), {
      code: 11000,
      keyValue: { customerCode: "CUS-000001" },
    }),
    Object.assign(
      new Error("E11000 duplicate key error index: customerCode_1 dup key"),
      { code: 11000 },
    ),
  ]) {
    assert.equal(mapCustomerCodeError(duplicateError).statusCode, 409);
  }

  for (const otherDuplicate of [
    Object.assign(new Error("duplicate userId"), {
      code: 11000,
      keyPattern: { userId: 1 },
    }),
    Object.assign(new Error("duplicate customerEmail"), {
      code: 11000,
      keyValue: { customerEmail: "customer@example.com" },
    }),
  ]) {
    assert.equal(mapCustomerCodeError(otherDuplicate), otherDuplicate);
  }
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
      [Bank, "findOne", async () => null],
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
      assert.deepEqual(body.data, {
        ...updatedCustomer,
        regionIds: [],
        serviceDistrictIds: [],
      });
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

test("Customer geography updates validate hierarchy and preserve districtIds", async () => {
  const bankId = "64b000000000000000000010";
  const oldRegionId = "64b000000000000000000011";
  const oldDistrictId = "64b000000000000000000012";
  const existingDistrictScope = ["64b000000000000000000013"];
  const customer = {
    _id: customerBId,
    userId: "customer-user-id",
    bankId: "64b000000000000000000014",
    regionId: oldRegionId,
    districtId: oldDistrictId,
    districtIds: existingDistrictScope,
    bankName: "Old Bank",
    isDeleted: false,
  };
  const updatedCustomer = {
    ...customer,
    bankId,
    regionId: null,
    districtId: null,
    bankName: "New Bank",
  };
  const mongoQuery = {
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(updatedCustomer).then(resolve, reject);
    },
  };
  let capturedUpdate;

  await withOverrides(
    [
      [Customer, "findById", async () => customer],
      [
        Bank,
        "findById",
        async (id) => ({
          _id: id,
          bankName: "New Bank",
          isActive: true,
        }),
      ],
      [Region, "findById", async () => null],
      [District, "findById", async () => null],
      [
        Customer,
        "findByIdAndUpdate",
        (_id, update) => {
          capturedUpdate = update;
          return mongoQuery;
        },
      ],
    ],
    async () => {
      const { status } = await invoke(updateCustomer, {
        params: { id: customerBId },
        body: { bankId },
        user: { _id: "admin-id", userType: "admin" },
      });

      assert.equal(status, 200);
      assert.equal(capturedUpdate.bankId, bankId);
      assert.equal(capturedUpdate.regionId, null);
      assert.equal(capturedUpdate.districtId, null);
      assert.equal(capturedUpdate.bankName, "New Bank");
      assert.equal("districtIds" in capturedUpdate, false);
      assert.deepEqual(customer.districtIds, existingDistrictScope);
    },
  );
});

test("Customer geography rejects a region belonging to another bank", async () => {
  const bankId = "64b000000000000000000015";
  const regionId = "64b000000000000000000016";
  const customer = {
    _id: customerBId,
    bankId: null,
    regionId: null,
    districtId: null,
    isDeleted: false,
  };

  await withOverrides(
    [
      [Customer, "findById", async () => customer],
      [
        Bank,
        "findById",
        async () => ({ _id: bankId, bankName: "Selected Bank", isActive: true }),
      ],
      [
        Region,
        "find",
        async () => [{
          _id: regionId,
          bankId: "64b000000000000000000017",
          isActive: true,
          geographyStatus: "MAPPED",
        }],
      ],
      [District, "find", async () => []],
      [
        Customer,
        "findByIdAndUpdate",
        () => {
          throw new Error("Customer should not be updated");
        },
      ],
    ],
    async () => {
      await assert.rejects(
        invoke(updateCustomer, {
          params: { id: customerBId },
          body: { bankId, regionIds: [regionId] },
          user: { _id: "admin-id", userType: "admin" },
        }),
        /Every region must be active, mapped, and belong to the selected bank/,
      );
    },
  );
});

test("Customer geography accepts a consistent Bank, Region, and District", async () => {
  const bankId = "64b000000000000000000019";
  const regionId = "64b000000000000000000020";
  const secondRegionId = "64b000000000000000000022";
  const districtId = "64b000000000000000000021";
  const secondDistrictId = "64b000000000000000000023";
  const customer = {
    _id: customerBId,
    isDeleted: false,
  };
  let capturedUpdate;
  const mongoQuery = {
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve({ _id: customerBId }).then(resolve, reject);
    },
  };

  await withOverrides(
    [
      [Customer, "findById", async () => customer],
      [
        Bank,
        "findById",
        async () => ({ _id: bankId, bankName: "Example Bank", isActive: true }),
      ],
      [
        Region,
        "find",
        async () => [
          {
            _id: regionId,
            bankId,
            isActive: true,
            geographyStatus: "MAPPED",
          },
          {
            _id: secondRegionId,
            bankId,
            isActive: true,
            geographyStatus: "MAPPED",
          },
        ],
      ],
      [
        District,
        "find",
        async () => [
          {
            _id: districtId,
            bankId,
            regionId,
            isActive: true,
            geographyStatus: "MAPPED",
          },
          {
            _id: secondDistrictId,
            bankId,
            regionId: secondRegionId,
            isActive: true,
            geographyStatus: "MAPPED",
          },
        ],
      ],
      [
        Customer,
        "findByIdAndUpdate",
        (_id, update) => {
          capturedUpdate = update;
          return mongoQuery;
        },
      ],
    ],
    async () => {
      const { status } = await invoke(updateCustomer, {
        params: { id: customerBId },
        body: {
          bankId,
          regionIds: [regionId, secondRegionId],
          serviceDistrictIds: [districtId, secondDistrictId],
        },
        user: { _id: "admin-id", userType: "admin" },
      });

      assert.equal(status, 200);
      assert.equal(capturedUpdate.bankId, bankId);
      assert.deepEqual(capturedUpdate.regionIds, [regionId, secondRegionId]);
      assert.deepEqual(capturedUpdate.serviceDistrictIds, [
        districtId,
        secondDistrictId,
      ]);
      assert.equal(capturedUpdate.regionId, null);
      assert.equal(capturedUpdate.districtId, null);
      assert.equal(capturedUpdate.bankName, "Example Bank");
    },
  );
});

test("Customer geography rejects a service district outside the selected regions", async () => {
  const bankId = "64b000000000000000000024";
  const regionId = "64b000000000000000000025";
  const otherRegionId = "64b000000000000000000026";
  const districtId = "64b000000000000000000027";
  const customer = { _id: customerBId, isDeleted: false };

  await withOverrides(
    [
      [Customer, "findById", async () => customer],
      [
        Bank,
        "findById",
        async () => ({ _id: bankId, bankName: "Example Bank", isActive: true }),
      ],
      [
        Region,
        "find",
        async () => [
          {
            _id: regionId,
            bankId,
            isActive: true,
            geographyStatus: "MAPPED",
          },
        ],
      ],
      [
        District,
        "find",
        async () => [
          {
            _id: districtId,
            bankId,
            regionId: otherRegionId,
            isActive: true,
            geographyStatus: "MAPPED",
          },
        ],
      ],
      [
        Customer,
        "findByIdAndUpdate",
        () => {
          throw new Error("Customer should not be updated");
        },
      ],
    ],
    async () => {
      await assert.rejects(
        invoke(updateCustomer, {
          params: { id: customerBId },
          body: {
            bankId,
            regionIds: [regionId],
            serviceDistrictIds: [districtId],
          },
          user: { _id: "admin-id", userType: "admin" },
        }),
        /Every service district must be active, mapped, and belong to the selected bank and one of its regions/,
      );
    },
  );
});

test("Customer self-updates cannot modify geography references", async () => {
  const customer = {
    _id: customerBId,
    userId: "customer-user-id",
    isDeleted: false,
  };
  const mongoQuery = {
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(customer).then(resolve, reject);
    },
  };
  let capturedUpdate;

  await withOverrides(
    [
      [Customer, "findOne", async () => customer],
      [Customer, "findById", async () => customer],
      [
        Customer,
        "findByIdAndUpdate",
        (_id, update) => {
          capturedUpdate = update;
          return mongoQuery;
        },
      ],
    ],
    async () => {
      const { status } = await invoke(updateCustomer, {
        params: { id: customerBId },
        body: {
          customerName: "Updated",
          bankId: "64b000000000000000000018",
          regionId: null,
          districtId: null,
        },
        user: {
          _id: "customer-user-id",
          userType: "customer",
          status: "active",
        },
      });

      assert.equal(status, 200);
      assert.equal(capturedUpdate.customerName, "Updated");
      assert.equal("bankId" in capturedUpdate, false);
      assert.equal("regionId" in capturedUpdate, false);
      assert.equal("districtId" in capturedUpdate, false);
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
  let generatedCodeCount = 0;
  const overrides = [
    [User, "findOne", async () => null],
    [
      CustomerCodeSequence,
      "findOneAndUpdate",
      async () => ({ value: 40 + ++generatedCodeCount }),
    ],
    [
      User,
      "create",
      async () => {
        assert.equal(generatedCodeCount, createdCustomers.length + 1);
        return user;
      },
    ],
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
  assert.deepEqual(
    createdCustomers.map(({ customerCode }) => customerCode),
    ["CUS-000041", "CUS-000042"],
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
