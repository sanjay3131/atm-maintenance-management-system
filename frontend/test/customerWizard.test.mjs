import test from "node:test";
import assert from "node:assert/strict";
import {
  createCustomerWizardPayload,
  getCustomerBankOptionValue,
  getCustomerWizardSteps,
  prefillCustomerDetails,
} from "../src/features/users/utils/customerWizard.ts";

const initialCustomerDetails = {
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  bankName: "Example Bank",
  atmIds: [],
  districtIds: [],
};

test("customer details are prefilled from the user information step", () => {
  assert.deepEqual(
    prefillCustomerDetails(
      {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phoneNumber: "1234567890",
        password: "password123",
      },
      initialCustomerDetails,
      {},
    ),
    {
      ...initialCustomerDetails,
      customerName: "Ada Lovelace",
      customerEmail: "ada@example.com",
      customerPhone: "1234567890",
    },
  );
});

test("explicit customer-detail edits survive navigation and later user updates", () => {
  const editedDetails = {
    ...initialCustomerDetails,
    customerName: "Preferred Customer Name",
    customerEmail: "contact@example.com",
    customerPhone: "0987654321",
  };
  assert.deepEqual(
    prefillCustomerDetails(
      {
        firstName: "Ada",
        lastName: "Byron",
        email: "new-ada@example.com",
        phoneNumber: "1111111111",
        password: "password123",
      },
      editedDetails,
      {
        customerName: true,
        customerEmail: true,
        customerPhone: true,
      },
    ),
    editedDetails,
  );
});

test("untouched customer fields synchronize when user details are changed", () => {
  assert.deepEqual(
    prefillCustomerDetails(
      {
        firstName: "Ada",
        lastName: "Byron",
        email: "new-ada@example.com",
        phoneNumber: "1111111111",
        password: "password123",
      },
      {
        ...initialCustomerDetails,
        customerName: "Old Name",
        customerEmail: "old@example.com",
        customerPhone: "0000000000",
      },
      {},
    ),
    {
      ...initialCustomerDetails,
      customerName: "Ada Byron",
      customerEmail: "new-ada@example.com",
      customerPhone: "1111111111",
    },
  );
});

test("customer flow has two steps while generic user flow keeps role selection", () => {
  assert.deepEqual(getCustomerWizardSteps(true), [1, 2]);
  assert.deepEqual(getCustomerWizardSteps(false), [1, 2, 3]);
});

test("bank selection and creation payload preserve the backend bankName contract", () => {
  const bank = {
    _id: "bank-id",
    bankName: "Example Bank",
    bankCode: "EXAMPLE",
    isActive: true,
    createdAt: "",
    updatedAt: "",
  };
  const user = {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phoneNumber: "1234567890",
    password: "password123",
  };
  const customer = { ...initialCustomerDetails, bankName: "Example Bank" };

  assert.equal(getCustomerBankOptionValue(bank), bank.bankName);
  assert.deepEqual(createCustomerWizardPayload(user, customer), {
    user,
    customer,
  });
});
