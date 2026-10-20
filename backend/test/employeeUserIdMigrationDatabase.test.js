import test from "node:test";
import assert from "node:assert/strict";
import {
  assertEmployeeUserIdMigrationDatabase,
  EMPLOYEE_USER_ID_MIGRATION_DATABASE,
  employeeUserIdMigrationConnectionOptions,
} from "../scripts/employeeUserIdMigrationDatabase.js";

test("Employee userId migration explicitly selects atm_management", () => {
  assert.equal(EMPLOYEE_USER_ID_MIGRATION_DATABASE, "atm_management");
  assert.equal(
    employeeUserIdMigrationConnectionOptions.dbName,
    "atm_management",
  );
});

test("Employee userId migration guard accepts only the intended database", () => {
  assert.doesNotThrow(() =>
    assertEmployeeUserIdMigrationDatabase("atm_management"),
  );
  assert.throws(
    () => assertEmployeeUserIdMigrationDatabase("test"),
    /requires database "atm_management"/,
  );
  assert.throws(
    () => assertEmployeeUserIdMigrationDatabase(undefined),
    /requires database "atm_management"/,
  );
});
