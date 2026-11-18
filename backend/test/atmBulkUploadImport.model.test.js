import assert from "node:assert/strict";
import { test } from "node:test";
import ATMBulkUploadImport from "../src/modules/atms/atmBulkUploadImport.model.js";

test("declares minimal receipt fields and a unique actor/idempotency index without TTL", () => {
  const schema = ATMBulkUploadImport.schema;
  const indexes = schema.indexes();
  const uniqueIndex = indexes.find(
    ([fields, options]) =>
      fields.actorId === 1 &&
      fields.idempotencyKeyHash === 1 &&
      options.unique === true,
  );

  assert.ok(uniqueIndex);
  assert.deepEqual(uniqueIndex[0], {
    actorId: 1,
    idempotencyKeyHash: 1,
  });
  assert.equal(
    uniqueIndex[1].name,
    "uniq_atm_bulk_upload_actor_idempotency_key",
  );
  assert.equal(schema.options.collection, "atm_bulk_upload_imports");
  assert.equal(schema.path("actorId").instance, "ObjectId");
  assert.equal(schema.path("actorId").options.ref, "User");
  assert.equal(schema.path("actorId").isRequired, true);
  assert.equal(schema.path("idempotencyKeyHash").instance, "String");
  assert.equal(schema.path("idempotencyKeyHash").isRequired, true);
  assert.equal(schema.path("workbookSha256").instance, "String");
  assert.equal(schema.path("workbookSha256").isRequired, true);
  assert.equal(schema.path("result.totalRows").instance, "Number");
  assert.equal(schema.path("result.totalRows").isRequired, true);
  assert.equal(schema.path("result.createdCount").instance, "Number");
  assert.equal(schema.path("result.createdCount").isRequired, true);
  assert.equal(
    indexes.some(([, options]) => options.expireAfterSeconds !== undefined),
    false,
  );
});

const validReceipt = () => ({
  actorId: new ATMBulkUploadImport.base.Types.ObjectId(),
  idempotencyKeyHash: "a".repeat(64),
  workbookSha256: "b".repeat(64),
  result: {
    totalRows: 10,
    createdCount: 10,
  },
});

const hasValidationError = (path) => (error) =>
  Boolean(error?.errors?.[path]);

test("accepts valid 64-character hexadecimal hashes", async () => {
  const receipt = new ATMBulkUploadImport({
    ...validReceipt(),
    idempotencyKeyHash: "A".repeat(64),
    workbookSha256: "B".repeat(64),
  });

  await receipt.validate();

  assert.equal(receipt.idempotencyKeyHash, "a".repeat(64));
  assert.equal(receipt.workbookSha256, "b".repeat(64));
});

test("requires the actor, hashes, and both result counts", async () => {
  const requiredPaths = [
    "actorId",
    "idempotencyKeyHash",
    "workbookSha256",
    "result.totalRows",
    "result.createdCount",
  ];

  for (const path of requiredPaths) {
    const receipt = new ATMBulkUploadImport(validReceipt());
    receipt.set(path, undefined);
    await assert.rejects(receipt.validate(), hasValidationError(path));
  }
});

test("rejects malformed SHA-256 hashes", async () => {
  for (const [path, value] of [
    ["idempotencyKeyHash", "z".repeat(64)],
    ["idempotencyKeyHash", "a".repeat(63)],
    ["workbookSha256", "g".repeat(64)],
    ["workbookSha256", "b".repeat(65)],
  ]) {
    const receipt = new ATMBulkUploadImport({
      ...validReceipt(),
      [path]: value,
    });
    await assert.rejects(receipt.validate(), hasValidationError(path));
  }
});

test("rejects negative, fractional, and unsafe result counts", async () => {
  for (const [path, value] of [
    ["result.totalRows", -1],
    ["result.totalRows", 1.5],
    ["result.totalRows", Number.MAX_SAFE_INTEGER + 1],
    ["result.createdCount", -1],
    ["result.createdCount", 1.5],
    ["result.createdCount", Number.MAX_SAFE_INTEGER + 1],
  ]) {
    const receipt = new ATMBulkUploadImport({
      ...validReceipt(),
      result: { totalRows: 10, createdCount: 10 },
    });
    receipt.set(path, value);
    await assert.rejects(receipt.validate(), hasValidationError(path));
  }
});
