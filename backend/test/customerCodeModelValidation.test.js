import assert from "node:assert/strict";
import mongoose from "mongoose";
import { test } from "node:test";
import Customer from "../src/modules/customers/customer.model.js";

const createCustomer = (customerCode) =>
  new Customer({
    userId: new mongoose.Types.ObjectId(),
    customerName: "Example Customer",
    customerCode,
    customerEmail: "customer@example.com",
    customerPhone: "1234567890",
    createdBy: new mongoose.Types.ObjectId(),
  });

test("allows an omitted customerCode for legacy-compatible documents", async () => {
  await createCustomer(undefined).validate();
});

test("accepts positive safe-integer customer codes with at least six digits", async () => {
  for (const customerCode of [
    "CUS-000001",
    "CUS-999999",
    "CUS-1000000",
    `CUS-${Number.MAX_SAFE_INTEGER}`,
    "  CUS-000001  ",
  ]) {
    await createCustomer(customerCode).validate();
  }
});

test("rejects zero, malformed, and unsafe customer-code suffixes", async () => {
  for (const customerCode of [
    "CUS-000000",
    "CUS-00000",
    "cus-000001",
    "CUS-00001A",
    "CUS-000001\n",
    `CUS-${BigInt(Number.MAX_SAFE_INTEGER) + 1n}`,
  ]) {
    await assert.rejects(createCustomer(customerCode).validate(), (error) =>
      Boolean(error.errors.customerCode),
    );
  }
});
