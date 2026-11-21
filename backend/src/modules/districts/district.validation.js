import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid ID");

export const districtIdParamsSchema = z.object({ id: objectIdSchema });
export const districtRegionParamsSchema = z.object({
  regionId: objectIdSchema,
});
export const districtListQuerySchema = z.object({
  bankId: objectIdSchema.optional(),
  regionId: objectIdSchema.optional(),
  isActive: z.enum(["true", "false"]).optional(),
});

export const createDistrictSchema = z.object({
  regionId: objectIdSchema,
  districtName: z.string().trim().min(2).max(100),
  pinCode: z.string().trim().min(3).max(10),
  state: z.string().trim().min(2).max(100),
  isActive: z.boolean().optional(),
}).strict();

export const updateDistrictSchema = z
  .object({
    districtName: z.string().trim().min(2).max(100).optional(),
    pinCode: z.string().trim().min(3).max(10).optional(),
    state: z.string().trim().min(2).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export const transferDistrictSchema = z.object({
  regionId: objectIdSchema,
  reason: z.string().trim().min(1, "Transfer reason is required").max(1000),
});
