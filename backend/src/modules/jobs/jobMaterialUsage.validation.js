import mongoose from "mongoose";
import { z } from "zod";

const objectIdSchema = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value), "Invalid ObjectId");

export const createJobMaterialUsageSchema = z
  .object({
    itemId: objectIdSchema,
    quantity: z
      .number()
      .finite("Quantity must be a finite number")
      .positive("Quantity must be greater than zero"),
  })
  .strict();
