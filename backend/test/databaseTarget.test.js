import test from "node:test";
import assert from "node:assert/strict";
import { validateMongoDatabaseTarget } from "../src/config/databaseTarget.js";

test("accepts an explicit matching MongoDB database target", () => {
  assert.equal(
    validateMongoDatabaseTarget({
      mongodbUrl: "mongodb://localhost:27017/test",
      expectedDatabase: "test",
    }),
    "test",
  );
});

test("accepts an encoded database name", () => {
  assert.equal(
    validateMongoDatabaseTarget({
      mongodbUrl: "mongodb://localhost:27017/atm%2Dstage",
      expectedDatabase: "atm-stage",
    }),
    "atm-stage",
  );
});

test("rejects missing expected database", () => {
  assert.throws(
    () =>
      validateMongoDatabaseTarget({
        mongodbUrl: "mongodb://localhost:27017/test",
        expectedDatabase: "",
      }),
    /MONGODB_EXPECTED_DATABASE is required/,
  );
});

test("rejects a URI without an explicit database path", () => {
  assert.throws(
    () =>
      validateMongoDatabaseTarget({
        mongodbUrl: "mongodb://localhost:27017",
        expectedDatabase: "test",
      }),
    /explicit database name/,
  );
});

test("rejects a database mismatch", () => {
  assert.throws(
    () =>
      validateMongoDatabaseTarget({
        mongodbUrl: "mongodb://localhost:27017/atm-management-stageing",
        expectedDatabase: "test",
      }),
    /targets "atm-management-stageing"/,
  );
});

test("rejects non-MongoDB schemes", () => {
  assert.throws(
    () =>
      validateMongoDatabaseTarget({
        mongodbUrl: "https://localhost/test",
        expectedDatabase: "test",
      }),
    /mongodb:\/\/ or mongodb\+srv:\/\//,
  );
});
