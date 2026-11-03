import mongoose from "mongoose";
import { z } from "zod";

const objectIdSchema = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value), "Invalid ObjectId");

const expectedVersionSchema = z.number().int().nonnegative();

export const additionalWorkersJobParamsSchema = z
  .object({ id: objectIdSchema })
  .strict();

export const additionalWorkersEntryParamsSchema = z
  .object({
    id: objectIdSchema,
    workerId: objectIdSchema,
  })
  .strict();

const workerFields = {
  workerType: z
    .string()
    .trim()
    .min(1, "Worker type is required")
    .max(80, "Worker type must be 80 characters or fewer")
    .optional(),
  quantity: z
    .number()
    .int("Quantity must be an integer")
    .positive("Quantity must be greater than zero")
    .optional(),
  notes: z
    .string()
    .trim()
    .max(300, "Notes must be 300 characters or fewer")
    .optional(),
};

export const createAdditionalWorkerSchema = z
  .object({
    ...workerFields,
    workerType: workerFields.workerType.unwrap(),
    quantity: workerFields.quantity.unwrap(),
    expectedVersion: expectedVersionSchema,
  })
  .strict();

export const updateAdditionalWorkerSchema = z
  .object({
    ...workerFields,
    expectedVersion: expectedVersionSchema,
  })
  .strict()
  .refine(
    ({ workerType, quantity, notes }) =>
      workerType !== undefined ||
      quantity !== undefined ||
      notes !== undefined,
    "At least one worker field must be provided",
  );

export const deleteAdditionalWorkerSchema = z
  .object({ expectedVersion: expectedVersionSchema })
  .strict();
