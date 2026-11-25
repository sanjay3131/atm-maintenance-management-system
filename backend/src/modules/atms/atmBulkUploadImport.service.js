import { createHash } from "node:crypto";
import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import Customer from "../customers/customer.model.js";
import { addATMGroupsToCustomersInTransaction } from "../customers/customerAssignment.service.js";
import { withGeographyFence } from "../districts/districtGeography.service.js";
import ATM from "./atm.model.js";
import ATMBulkUploadImport from "./atmBulkUploadImport.model.js";
import { parseAtmBulkUpload, resolveAtmBulkUploadRows } from "./atmBulkUpload.service.js";
import { reserveATMIds } from "./atm.utils.js";

const MAX_IDEMPOTENCY_KEY_BYTES = 256;
const RECEIPT_UNIQUE_INDEX = "uniq_atm_bulk_upload_actor_idempotency_key";
const UNKNOWN_OUTCOME_MESSAGE =
  "The ATM import outcome could not be confirmed. Retry using the same idempotency key.";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const isUnknownCommitResult = (error) =>
  error?.codeName === "UnknownTransactionCommitResult" ||
  error?.hasErrorLabel?.("UnknownTransactionCommitResult") === true ||
  error?.errorLabels?.includes("UnknownTransactionCommitResult") === true;

const isReceiptDuplicateKey = (error) => {
  if (error?.code !== 11000) return false;
  const keyPattern = error.keyPattern ?? {};
  const details = `${error.index ?? ""} ${error.message ?? ""}`;
  return (
    (keyPattern.actorId && keyPattern.idempotencyKeyHash) ||
    details.includes(RECEIPT_UNIQUE_INDEX)
  );
};

const toStoredResult = (receipt, workbookHash) => {
  if (receipt.workbookSha256 !== workbookHash) {
    throw new ApiError(
      409,
      "This idempotency key has already been used for a different workbook",
    );
  }
  if (!receipt.result) {
    throw new ApiError(500, "The stored ATM import receipt is invalid");
  }
  return {
    totalRows: receipt.result.totalRows,
    createdCount: receipt.result.createdCount,
  };
};

const readReceipt = (actorId, idempotencyKeyHash) =>
  ATMBulkUploadImport.findOne({ actorId, idempotencyKeyHash }).lean();

const assertRowsAreValid = (rows) => {
  const errors = rows.flatMap((row) =>
    row.errors.map((error) => ({
      rowNumber: row.rowNumber,
      field: error.field,
      message: error.message,
    })),
  );
  if (errors.length > 0) {
    throw new ApiError(400, "One or more ATM upload rows are invalid", errors);
  }
};

const getResolvedGeographyIds = (rows) => {
  if (
    rows.some(
      (row) =>
        !row.resolved?.bankId ||
        !row.resolved?.regionId ||
        !row.resolved?.districtId,
    )
  ) {
    throw new ApiError(400, "One or more ATM upload rows have unresolved geography");
  }
  return {
    bankIds: [
      ...new Set(rows.map((row) => String(row.resolved.bankId).toLowerCase())),
    ].sort(),
    regionIds: [
      ...new Set(rows.map((row) => String(row.resolved.regionId).toLowerCase())),
    ].sort(),
    districtIds: [
      ...new Set(
        rows.map((row) => String(row.resolved.districtId).toLowerCase()),
      ),
    ].sort(),
  };
};

const sameIds = (left, right) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const validateInput = ({ buffer, actorId, idempotencyKey }) => {
  if (!Buffer.isBuffer(buffer)) {
    throw new ApiError(400, "An XLSX workbook buffer is required");
  }
  if (!mongoose.isValidObjectId(actorId)) {
    throw new ApiError(400, "A valid authenticated actor ID is required");
  }
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim().length === 0 ||
    Buffer.byteLength(idempotencyKey, "utf8") > MAX_IDEMPOTENCY_KEY_BYTES
  ) {
    throw new ApiError(400, "A nonempty idempotency key of at most 256 bytes is required");
  }

  return {
    actorId: new mongoose.Types.ObjectId(actorId),
    idempotencyKeyHash: sha256(idempotencyKey),
    workbookHash: sha256(buffer),
  };
};

const retryableOutcomeError = () =>
  new ApiError(503, UNKNOWN_OUTCOME_MESSAGE);

export const importAtmBulkUpload = async ({
  buffer,
  actorId,
  idempotencyKey,
}) => {
  const identity = validateInput({ buffer, actorId, idempotencyKey });
  const existingReceipt = await readReceipt(
    identity.actorId,
    identity.idempotencyKeyHash,
  );
  if (existingReceipt) {
    return toStoredResult(existingReceipt, identity.workbookHash);
  }

  const parsedRows = await parseAtmBulkUpload(buffer);
  if (parsedRows.length === 0) {
    throw new ApiError(400, "The workbook contains no ATM data rows");
  }

  const preliminaryRows = await resolveAtmBulkUploadRows(parsedRows);
  const receiptAfterPreflight = await readReceipt(
    identity.actorId,
    identity.idempotencyKeyHash,
  );
  if (receiptAfterPreflight) {
    return toStoredResult(receiptAfterPreflight, identity.workbookHash);
  }
  assertRowsAreValid(preliminaryRows);
  const fencedGeographyIds = getResolvedGeographyIds(preliminaryRows);

  try {
    return await withGeographyFence(
      {
        bankIds: fencedGeographyIds.bankIds,
        districtIds: fencedGeographyIds.districtIds,
      },
      async (session) => {
        const rows = await resolveAtmBulkUploadRows(parsedRows, { session });
        assertRowsAreValid(rows);
        const resolvedGeographyIds = getResolvedGeographyIds(rows);
        if (
          !sameIds(fencedGeographyIds.bankIds, resolvedGeographyIds.bankIds) ||
          !sameIds(
            fencedGeographyIds.regionIds,
            resolvedGeographyIds.regionIds,
          ) ||
          !sameIds(
            fencedGeographyIds.districtIds,
            resolvedGeographyIds.districtIds,
          )
        ) {
          throw new ApiError(
            409,
            "ATM geography assignments changed while the workbook was being imported",
          );
        }

        const atmIds = await reserveATMIds(rows.length, { session });
        const documents = rows.map((row, index) => ({
          atmId: atmIds[index],
          clientAtmId: row.clientAtmId,
          customer: row.resolved.customerId,
          bankId: row.resolved.bankId,
          geographyStatus: "MAPPED",
          districtId: row.resolved.districtId,
          regionId: row.resolved.regionId,
          locationName: row.locationName,
          city: row.city,
          address: row.address,
          installationType: row.installationType,
          assignedEmployeeId: [],
          createdBy: identity.actorId,
        }));
        const createdATMs = await ATM.insertMany(documents, {
          session,
          ordered: true,
        });
        if (createdATMs.length !== rows.length) {
          throw new Error("ATM import inserted an unexpected number of records");
        }

        const customerGroups = new Map();
        rows.forEach((row, index) => {
          const customerId = String(row.resolved.customerId).toLowerCase();
          const atmGroup = customerGroups.get(customerId) ?? {
            customerId: row.resolved.customerId,
            atmIds: [],
          };
          atmGroup.atmIds.push(createdATMs[index]._id);
          customerGroups.set(customerId, atmGroup);
        });
        await addATMGroupsToCustomersInTransaction({
          customerAtmGroups: [...customerGroups.values()],
          updatedBy: identity.actorId,
          session,
        });

        const result = {
          totalRows: rows.length,
          createdCount: createdATMs.length,
        };
        const [receipt] = await ATMBulkUploadImport.create(
          [
            {
              actorId: identity.actorId,
              idempotencyKeyHash: identity.idempotencyKeyHash,
              workbookSha256: identity.workbookHash,
              result,
            },
          ],
          { session },
        );
        if (!receipt) {
          throw new Error("ATM import receipt was not created");
        }
        return toStoredResult(receipt, identity.workbookHash);
      },
    );
  } catch (error) {
    const receiptDuplicate = isReceiptDuplicateKey(error);
    const ambiguousOutcome = isUnknownCommitResult(error);
    let committedReceipt;
    try {
      committedReceipt = await readReceipt(
        identity.actorId,
        identity.idempotencyKeyHash,
      );
    } catch {
      if (receiptDuplicate || ambiguousOutcome) {
        throw retryableOutcomeError();
      }
      throw error;
    }

    if (committedReceipt) {
      return toStoredResult(committedReceipt, identity.workbookHash);
    }
    if (receiptDuplicate || ambiguousOutcome) {
      throw retryableOutcomeError();
    }
    throw error;
  }
};
