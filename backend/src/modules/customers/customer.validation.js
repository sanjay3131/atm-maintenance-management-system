import { z } from "zod";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ID");
const uniqueObjectIdArraySchema = z
  .array(objectIdSchema)
  .refine(
    (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
    "Duplicate IDs are not allowed",
  );

export const createCustomerSchema = z.object({
  firstName: z.string().min(1, "First name is required").trim(),
  lastName: z.string().optional(),
  email: z.string().email("Invalid email").toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phoneNumber: z.string().min(10, "Phone number is required"),
  customerName: z.string().min(1, "Customer name is required").optional(),
  customerPhone: z.string().optional(),
  bankName: z.string().trim().optional(),
  districtIds: z.array(objectIdSchema).optional(),
});

export const updateCustomerSchema = z.object({
  customerName: z.string().min(1).optional(),
  customerPhone: z.string().optional(),
  bankName: z.string().optional(),
  bankId: objectIdSchema.nullable().optional(),
  regionId: objectIdSchema.nullable().optional(),
  districtId: objectIdSchema.nullable().optional(),
  regionIds: uniqueObjectIdArraySchema.optional(),
  serviceDistrictIds: uniqueObjectIdArraySchema.optional(),
  districtIds: z.array(objectIdSchema).optional(),
  isActive: z.boolean().optional(),
}).passthrough();

export const addCustomerATMsSchema = z.object({
  atmIds: z
    .array(objectIdSchema)
    .min(1, "Select at least one ATM")
    .refine(
      (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
      "Duplicate ATM assignments are not allowed",
    ),
});
