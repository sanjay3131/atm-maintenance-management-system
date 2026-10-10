import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ATM from "../src/modules/atms/atm.model.js";
import Customer from "../src/modules/customers/customer.model.js";
import District from "../src/modules/districts/district.models.js";
import Employee from "../src/modules/employees/employee.model.js";
import Region from "../src/modules/region/region.model.js";
import User from "../src/modules/users/user.model.js";
import { createATM } from "../src/modules/atms/atm.controller.js";
import { createEmployee } from "../src/modules/employees/employee.controller.js";

const atmId = "64b000000000000000000001";
const employeeId = "64b000000000000000000002";
const userId = "64b000000000000000000003";
const customerId = "64b000000000000000000004";
const districtId = "64b000000000000000000005";
const adminId = "64b000000000000000000006";

const matchesId = (left, right) =>
  String(left?._id ?? left).toLowerCase() ===
  String(right?._id ?? right).toLowerCase();

const query = (value) => ({
  session() {
    return Promise.resolve(value);
  },
  select() {
    return this;
  },
  sort() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
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

async function withCreationMocks(callback, { withEmployee = true } = {}) {
  const state = {
    atms: [],
    employees: withEmployee
      ? [
          {
            _id: employeeId,
            userId,
            status: "active",
            assignedAtmIds: [],
            async save() {},
          },
        ]
      : [],
    customers: [
      {
        _id: customerId,
        isActive: true,
        isDeleted: false,
        atmIds: [],
        async save() {},
      },
    ],
    users: [
      { _id: userId, userType: "employee", status: "active" },
    ],
  };
  const originals = [];
  const override = (target, key, value) => {
    originals.push([target, key, target[key]]);
    target[key] = value;
  };
  const employeeAssignments = () =>
    state.employees.map((employee) => ({
      employee,
      assignedAtmIds: [...(employee.assignedAtmIds ?? [])],
    }));
  const atmAssignments = () =>
    state.atms.map((atm) => ({
      atm,
      assignedEmployeeId: [...(atm.assignedEmployeeId ?? [])],
      customer: atm.customer,
    }));

  override(mongoose, "startSession", async () => ({
    async withTransaction(operation) {
      const atmCount = state.atms.length;
      const employeeCount = state.employees.length;
      const atmSnapshot = atmAssignments();
      const employeeSnapshot = employeeAssignments();
      const customerATMIds = state.customers.map((customer) => [
        customer,
        [...customer.atmIds],
      ]);
      try {
        return await operation(this);
      } catch (error) {
        state.atms.length = atmCount;
        state.employees.length = employeeCount;
        for (const { atm, assignedEmployeeId, customer } of atmSnapshot) {
          atm.assignedEmployeeId = assignedEmployeeId;
          atm.customer = customer;
        }
        for (const { employee, assignedAtmIds } of employeeSnapshot) {
          employee.assignedAtmIds = assignedAtmIds;
        }
        for (const [customer, atmIds] of customerATMIds) {
          customer.atmIds = atmIds;
        }
        throw error;
      }
    },
    async endSession() {},
  }));
  override(District, "findById", () =>
    query({ _id: districtId, isActive: true }),
  );
  override(Region, "countDocuments", async () => 0);
  override(ATM, "findOne", (filter) => {
    if (!filter) return query(null);
    return query(
      state.atms.find(
        (atm) =>
          matchesId(atm._id, filter._id) &&
          (!Object.hasOwn(filter, "isDeleted") ||
            atm.isDeleted === filter.isDeleted),
      ) ?? null,
    );
  });
  override(ATM, "create", async (records) => {
    const created = records.map((record) => ({
      ...record,
      _id: atmId,
      isDeleted: false,
      assignedEmployeeId: [...(record.assignedEmployeeId ?? [])],
      async save() {},
    }));
    state.atms.push(...created);
    return created;
  });
  override(ATM, "find", (filter) =>
    query(
      state.atms.filter((atm) =>
        filter.$or
          ? filter.$or.some(
              (condition) =>
                condition._id?.$in?.some((id) => matchesId(atm._id, id)) ||
                (condition.assignedEmployeeId &&
                  (atm.assignedEmployeeId ?? []).some((id) =>
                    matchesId(id, condition.assignedEmployeeId),
                  )),
            )
          : filter._id.$in.some((id) => matchesId(atm._id, id)),
      ),
    ),
  );
  override(ATM.prototype, "save", async function () {
    return this;
  });
  override(Customer, "findOne", (filter) =>
    query(
      state.customers.find(
        (customer) =>
          matchesId(customer._id, filter._id) &&
          customer.isActive === filter.isActive &&
          customer.isDeleted === filter.isDeleted,
      ) ?? null,
    ),
  );
  override(Customer, "updateMany", async () => {});
  override(Employee, "findById", (id) =>
    query(
      state.employees.find((employee) => matchesId(employee._id, id)) ?? null,
    ),
  );
  override(Employee, "findOne", (filter) =>
    query(
      filter
        ? (state.employees.find((employee) =>
            matchesId(employee.userId, filter.userId),
          ) ?? null)
        : null,
    ),
  );
  override(Employee, "create", async (records) => {
    const created = records.map((record) => ({
      ...record,
      _id: employeeId,
      status: "active",
      assignedAtmIds: [...(record.assignedAtmIds ?? [])],
      async save() {},
    }));
    state.employees.push(...created);
    return created;
  });
  override(Employee, "find", (filter) =>
    query(
      state.employees.filter((employee) =>
        (employee.assignedAtmIds ?? []).some((id) =>
          matchesId(id, filter.assignedAtmIds),
        ),
      ),
    ),
  );
  override(Employee.prototype, "save", async function () {
    return this;
  });
  override(User, "findById", (id) =>
    query(state.users.find((user) => matchesId(user._id, id)) ?? null),
  );

  try {
    await callback(state);
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
}

const atmPayload = {
  bankId: "64b000000000000000000007",
  districtId,
  regionId: null,
  locationName: "Test ATM",
  address: "Test address",
  installationType: "ONSITE",
  customerId,
  status: "INACTIVE",
  assignedEmployeeId: [employeeId],
};

test("ATM creation rejects assigning an Employee to a new inactive ATM atomically", async () => {
  await withCreationMocks(async (state) => {
    await assert.rejects(
      invoke(createATM, {
        user: { _id: adminId },
        body: atmPayload,
      }),
      (error) =>
        error.statusCode === 400 &&
        error.message === "New Employee assignments require an ACTIVE ATM",
    );
    assert.deepEqual(state.atms, []);
    assert.deepEqual(state.employees[0].assignedAtmIds, []);
  });
});

test("Employee creation rejects assignment to an inactive ATM atomically", async () => {
  await withCreationMocks(async (state) => {
    const inactiveATM = {
      _id: atmId,
      isDeleted: false,
      status: "UNDER_MAINTENANCE",
      assignedEmployeeId: [],
      async save() {},
    };
    state.atms.push(inactiveATM);
    const initialEmployeeCount = state.employees.length;
    await assert.rejects(
      invoke(createEmployee, {
        user: { _id: adminId, userType: "admin" },
        params: { userId },
        body: {
          designation: "Technician",
          department: "Maintenance",
          joiningDate: "2026-01-01",
          employmentType: "full-time",
          assignedAtmIds: [atmId],
        },
      }),
      (error) =>
        error.statusCode === 400 &&
        error.message === "New Employee assignments require an ACTIVE ATM",
    );
    assert.equal(state.employees.length, initialEmployeeCount);
    assert.deepEqual(inactiveATM.assignedEmployeeId, []);
  }, { withEmployee: false });
});
