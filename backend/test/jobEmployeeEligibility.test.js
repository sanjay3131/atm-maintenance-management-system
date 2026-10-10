import test from "node:test";
import assert from "node:assert/strict";
import Employee from "../src/modules/employees/employee.model.js";
import { findActiveEmployeeByUserId } from "../src/modules/employees/employeeAssignment.service.js";

const userId = "64b000000000000000000001";
const employeeId = "64b000000000000000000002";

async function withEmployee(employee, callback) {
  const originalFindOne = Employee.findOne;
  let receivedFilter;
  Employee.findOne = (filter) => {
    receivedFilter = filter;
    return {
      populate: async () => employee,
    };
  };

  try {
    await callback(() => receivedFilter);
  } finally {
    Employee.findOne = originalFindOne;
  }
}

test("accepts an active Employee whose active User has employee user type", async () => {
  const employee = {
    _id: employeeId,
    status: "active",
    userId: { _id: userId, status: "active", userType: "employee" },
  };

  await withEmployee(employee, async (getFilter) => {
    assert.equal(await findActiveEmployeeByUserId(userId), employee);
    assert.deepEqual(getFilter(), { userId });
  });
});

test("rejects an inactive Employee even when its User is active", async () => {
  await withEmployee(
    {
      _id: employeeId,
      status: "inactive",
      userId: { _id: userId, status: "active", userType: "employee" },
    },
    async () => {
      await assert.rejects(findActiveEmployeeByUserId(userId), {
        statusCode: 400,
        message: "Employee is inactive",
      });
    },
  );
});

test("rejects a missing, inactive, or non-employee User", async (t) => {
  for (const user of [
    null,
    { _id: userId, status: "inactive", userType: "employee" },
    { _id: userId, status: "blocked", userType: "employee" },
    { _id: userId, status: "active", userType: "admin" },
  ]) {
    await t.test(JSON.stringify(user), async () => {
      await withEmployee(
        { _id: employeeId, status: "active", userId: user },
        async () => {
          await assert.rejects(findActiveEmployeeByUserId(userId), {
            statusCode: 400,
            message: "Employee is inactive",
          });
        },
      );
    });
  }
});

test("rejects a User ID that has no Employee record", async () => {
  await withEmployee(null, async () => {
    await assert.rejects(findActiveEmployeeByUserId(userId), {
      statusCode: 404,
      message: "Employee not found",
    });
  });
});
