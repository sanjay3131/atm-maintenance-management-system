import { z } from "zod";

export const itemFormSchema = z.object({
  itemName: z
    .string()
    .trim()
    .min(1, "Item name is required")
    .max(120, "Item name must be 120 characters or fewer"),
  unit: z
    .string()
    .trim()
    .min(1, "Unit is required")
    .max(40, "Unit must be 40 characters or fewer"),
  currentUnitCost: z
    .number()
    .finite("Current unit cost must be a finite number")
    .min(0, "Current unit cost cannot be negative"),
  isActive: z.boolean(),
});
