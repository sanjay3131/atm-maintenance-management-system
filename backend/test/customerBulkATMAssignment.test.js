import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import ApiError from "../src/utils/ApiError.js";
import Customer from "../src/modules/customers/customer.model.js";
import { addATMGroupsToCustomersInTransaction } from "../src/modules/customers/customerAssignment.service.js";

const CUSTOMER_A_ID = "64b000000000000000000002";
const CUSTOMER_B_ID = "64b000000000000000000003";
const ATM_A_ID = "64b000000000000000000001";
const ATM_B_ID = "64b000000000000000000007";
const ATM_C_ID = "64b000000000000000000008";
const UPDATED_BY_ID = "64b000000000000000000009";

const activeSession = () => ({
  inTransaction: () => true,
});

test("updates each Customer once, deduplicates ATM IDs, and propagates the session", async (t) => {
  const session = activeSession();
  let writeCall;
  t.mock.method(Customer, "bulkWrite", async (...args) => {
    writeCall = args;
    return { matchedCount: 2, modifiedCount: 2 };
  });

  await addATMGroupsToCustomersInTransaction({
    customerAtmGroups: [
      { customerId: CUSTOMER_A_ID, atmIds: [ATM_A_ID, ATM_A_ID, ATM_B_ID] },
      { customerId: CUSTOMER_A_ID, atmIds: [ATM_B_ID, ATM_C_ID] },
      { customerId: CUSTOMER_B_ID, atmIds: [ATM_C_ID] },
    ],
    updatedBy: UPDATED_BY_ID,
    session,
  });

  const [operations, options] = writeCall;
  assert.equal(operations.length, 2);
  assert.deepEqual(
    operations.map(({ updateOne }) => String(updateOne.filter._id)),
    [CUSTOMER_A_ID, CUSTOMER_B_ID],
  );
  assert.deepEqual(
    operations.map(({ updateOne }) =>
      updateOne.update.$addToSet.atmIds.$each.map(String),
    ),
    [
      [ATM_A_ID, ATM_B_ID, ATM_C_ID],
      [ATM_C_ID],
    ],
  );
  assert.ok(
    operations.every(
      ({ updateOne }) =>
        updateOne.filter.isActive === true &&
        updateOne.filter.isDeleted === false &&
        String(updateOne.update.$set.updatedBy) === UPDATED_BY_ID,
    ),
  );
  assert.equal(options.session, session);
});

test("propagates an error when a multi-Customer write has an unmatched Customer", async (t) => {
  const session = activeSession();
  t.mock.method(Customer, "bulkWrite", async (_operations, options) => {
    assert.equal(options.session, session);
    return { matchedCount: 1, modifiedCount: 1 };
  });

  await assert.rejects(
    addATMGroupsToCustomersInTransaction({
      customerAtmGroups: [
        { customerId: CUSTOMER_A_ID, atmIds: [ATM_A_ID] },
        { customerId: CUSTOMER_B_ID, atmIds: [ATM_B_ID] },
      ],
      session,
    }),
    (error) =>
      error instanceof ApiError &&
      error.statusCode === 404 &&
      /missing, inactive, or deleted/.test(error.message),
  );
});

test("rejects a missing session before database access", async (t) => {
  let writeCalls = 0;
  t.mock.method(Customer, "bulkWrite", async () => {
    writeCalls += 1;
    return { matchedCount: 1, modifiedCount: 1 };
  });

  await assert.rejects(
    addATMGroupsToCustomersInTransaction({
      customerAtmGroups: [
        { customerId: CUSTOMER_A_ID, atmIds: [ATM_A_ID] },
      ],
    }),
    /active transaction session is required/,
  );
  assert.equal(writeCalls, 0);
});

test("rejects a session without inTransaction before database access", async (t) => {
  let writeCalls = 0;
  t.mock.method(Customer, "bulkWrite", async () => {
    writeCalls += 1;
    return { matchedCount: 1, modifiedCount: 1 };
  });

  await assert.rejects(
    addATMGroupsToCustomersInTransaction({
      customerAtmGroups: [
        { customerId: CUSTOMER_A_ID, atmIds: [ATM_A_ID] },
      ],
      session: {},
    }),
    /active transaction session is required/,
  );
  assert.equal(writeCalls, 0);
});

test("rejects an inactive transaction session before database access", async (t) => {
  let writeCalls = 0;
  t.mock.method(Customer, "bulkWrite", async () => {
    writeCalls += 1;
    return { matchedCount: 1, modifiedCount: 1 };
  });

  await assert.rejects(
    addATMGroupsToCustomersInTransaction({
      customerAtmGroups: [
        { customerId: CUSTOMER_A_ID, atmIds: [ATM_A_ID] },
      ],
      session: { inTransaction: () => false },
    }),
    /active transaction session is required/,
  );
  assert.equal(writeCalls, 0);
});

test("empty input performs no database operation", async (t) => {
  let writeCalls = 0;
  t.mock.method(Customer, "bulkWrite", async () => {
    writeCalls += 1;
    return { matchedCount: 0, modifiedCount: 0 };
  });

  const result = await addATMGroupsToCustomersInTransaction({
    customerAtmGroups: [],
  });

  assert.equal(result, undefined);
  assert.equal(writeCalls, 0);
});
