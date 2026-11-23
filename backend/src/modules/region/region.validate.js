import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid ID");

export const regionIdParamsSchema = z.object({ id: objectIdSchema });
export const regionBankParamsSchema = z.object({ bankId: objectIdSchema });
export const regionDistrictParamsSchema = z.object({
  districtId: objectIdSchema,
});
export const regionListQuerySchema = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
});
export const regionSummaryQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  bankId: objectIdSchema.optional(),
});

export const createRegionSchema = z.object({
  bankId: objectIdSchema,
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().max(20).optional(),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
});

export const updateRegionSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    code: z.string().trim().max(20).optional(),
    description: z.string().trim().max(500).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
