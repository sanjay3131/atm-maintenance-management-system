import test from "node:test";
import assert from "node:assert/strict";
import { validateBootstrapInput } from "../scripts/bootstrapFirstSuperAdmin.js";

const validEnv = {
  MONGODB_EXPECTED_DATABASE: "test",
  BOOTSTRAP_SUPER_ADMIN_FIRST_NAME: "Initial",
  BOOTSTRAP_SUPER_ADMIN_EMAIL: "admin@example.com",
  BOOTSTRAP_SUPER_ADMIN_PHONE: "9876543210",
  BOOTSTRAP_SUPER_ADMIN_PASSWORD: "a-strong-password-123",
};

test("accepts explicit first-admin bootstrap inputs", () => {
  assert.doesNotThrow(() =>
    validateBootstrapInput(validEnv, "test", "CREATE-FIRST-SUPER-ADMIN"),
  );
});

test("rejects a target database that differs from deployment configuration", () => {
  assert.throws(
    () =>
      validateBootstrapInput(validEnv, "atm-management-stageing", "CREATE-FIRST-SUPER-ADMIN"),
    /match MONGODB_EXPECTED_DATABASE/,
  );
});

test("requires the explicit one-time bootstrap confirmation", () => {
  assert.throws(
    () => validateBootstrapInput(validEnv, "test", "wrong"),
    /Explicit confirmation required/,
  );
});

test("requires all bootstrap identity and credential values", () => {
  assert.throws(
    () =>
      validateBootstrapInput(
        { ...validEnv, BOOTSTRAP_SUPER_ADMIN_PHONE: "" },
        "test",
        "CREATE-FIRST-SUPER-ADMIN",
      ),
    /BOOTSTRAP_SUPER_ADMIN_PHONE/,
  );
});

test("rejects a weak bootstrap password", () => {
  assert.throws(
    () =>
      validateBootstrapInput(
        { ...validEnv, BOOTSTRAP_SUPER_ADMIN_PASSWORD: "short" },
        "test",
        "CREATE-FIRST-SUPER-ADMIN",
      ),
    /at least 12 characters/,
  );
});

test("rejects an invalid bootstrap email", () => {
  assert.throws(
    () =>
      validateBootstrapInput(
        { ...validEnv, BOOTSTRAP_SUPER_ADMIN_EMAIL: "not-an-email" },
        "test",
        "CREATE-FIRST-SUPER-ADMIN",
      ),
    /email address is invalid/,
  );
});
