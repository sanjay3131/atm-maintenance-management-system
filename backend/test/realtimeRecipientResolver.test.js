import assert from "node:assert/strict";
import test from "node:test";
import Customer from "../src/modules/customers/customer.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import User from "../src/modules/users/user.model.js";
import { resolveJobRecipients } from "../src/realtime/recipient-resolver.js";

const userIds = {
  admin: "admin-user",
  employee: "employee-user",
  supervisor: "supervisor-user",
  customerA: "customer-a-user",
  customerB: "customer-b-user",
};

const employeeId = "employee-record";
const customerAId = "customer-a";
const customerBId = "customer-b";

const query = (value) => ({
  select() {
    return this;
  },
  lean: async () => value,
});

const inValues = (value) => value?.$in ?? [];

const withResolverMocks = async (callback) => {
  const users = [
    { _id: userIds.admin, userType: "admin", status: "active" },
    { _id: userIds.employee, userType: "employee", status: "active" },
    { _id: userIds.supervisor, userType: "supervisor", status: "active" },
    { _id: userIds.customerA, userType: "customer", status: "active" },
    { _id: userIds.customerB, userType: "customer", status: "active" },
  ];
  const employees = [
    {
      _id: employeeId,
      userId: userIds.employee,
      supervisorId: userIds.supervisor,
      status: "active",
    },
  ];
  const customers = [
    {
      _id: customerAId,
      userId: userIds.customerA,
      isActive: true,
      isDeleted: false,
    },
    {
      _id: customerBId,
      userId: userIds.customerB,
      isActive: true,
      isDeleted: false,
    },
  ];
  const originals = [
    [User, "find", User.find],
    [Employee, "find", Employee.find],
    [Customer, "findOne", Customer.findOne],
  ];

  User.find = (filter) => {
    const records = filter.userType
      ? users.filter((user) =>
          filter.userType.$in.includes(user.userType),
        )
      : users.filter(
          (user) =>
            user.status === filter.status &&
            inValues(filter._id).includes(user._id),
        );
    return query(records.map(({ _id }) => ({ _id })));
  };
  Employee.find = (filter) => {
    const ids = [
      ...inValues(filter.$or[0]._id),
      ...inValues(filter.$or[1].userId),
    ];
    return query(
      employees.filter(
        (employee) =>
          employee.status === filter.status &&
          (ids.includes(employee._id) || ids.includes(employee.userId)),
      ),
    );
  };
  Customer.findOne = (filter) =>
    query(
      customers.find(
        (customer) =>
          customer._id === filter._id &&
          customer.isActive === filter.isActive &&
          customer.isDeleted === filter.isDeleted,
      ) ?? null,
    );

  try {
    await callback();
  } finally {
    for (const [model, key, original] of originals) model[key] = original;
  }
};

const makeJob = (customerId, status) => ({
  _id: "job-id",
  customerId,
  assignedEmployeeId: userIds.employee,
  createdBy: userIds.admin,
  status,
  isDeleted: false,
});

test("customer-visible job event resolves to its customer", async () => {
  await withResolverMocks(async () => {
    const recipients = await resolveJobRecipients(
      makeJob(customerAId, "VERIFIED"),
    );

    assert.ok(recipients.includes(userIds.customerA));
    assert.ok(recipients.includes(userIds.admin));
    assert.ok(recipients.includes(userIds.employee));
    assert.ok(recipients.includes(userIds.supervisor));
  });
});

test("job hidden from customer REST APIs does not resolve to that customer", async () => {
  await withResolverMocks(async () => {
    const recipients = await resolveJobRecipients(
      makeJob(customerAId, "IN_PROGRESS"),
    );

    assert.equal(recipients.includes(userIds.customerA), false);
    assert.ok(recipients.includes(userIds.admin));
    assert.ok(recipients.includes(userIds.employee));
  });
});

test("customer job event cannot resolve to another customer's account", async () => {
  await withResolverMocks(async () => {
    const recipients = await resolveJobRecipients(
      makeJob(customerAId, "CLOSED"),
    );

    assert.ok(recipients.includes(userIds.customerA));
    assert.equal(recipients.includes(userIds.customerB), false);
  });
});
