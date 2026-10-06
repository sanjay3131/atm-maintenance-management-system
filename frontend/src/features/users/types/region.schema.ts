import { z } from "zod";

export const regionFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Region name must be at least 2 characters")
    .max(100, "Region name must not exceed 100 characters"),
  code: z.string().trim().max(20, "Region code must not exceed 20 characters"),
  description: z
    .string()
    .trim()
    .max(500, "Description must not exceed 500 characters"),
  isActive: z.boolean(),
});

export type RegionFormSchemaValues = z.infer<typeof regionFormSchema>;
