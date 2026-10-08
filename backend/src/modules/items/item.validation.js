import { z } from "zod";

const itemNameSchema = z
  .string()
  .trim()
  .min(1, "Item name is required")
  .max(120, "Item name must be 120 characters or fewer");

const unitSchema = z
  .string()
  .trim()
  .min(1, "Unit is required")
  .max(40, "Unit must be 40 characters or fewer");

const currentUnitCostSchema = z
  .number()
  .finite("Current unit cost must be a finite number")
  .min(0, "Current unit cost cannot be negative");

export const createItemSchema = z
  .object({
    itemName: itemNameSchema,
    unit: unitSchema,
    currentUnitCost: currentUnitCostSchema,
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateItemSchema = z
  .object({
    itemName: itemNameSchema.optional(),
    unit: unitSchema.optional(),
    currentUnitCost: currentUnitCostSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((values) => Object.keys(values).length > 0, {
    message: "At least one Item field must be provided",
  });
