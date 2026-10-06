import { z } from "zod";

export const districtFormSchema = z.object({
  districtName: z
    .string()
    .trim()
    .min(2, "District name must be at least 2 characters")
    .max(100, "District name must not exceed 100 characters"),
  pinCode: z
    .string()
    .trim()
    .min(3, "PIN code must be at least 3 characters")
    .max(10, "PIN code must not exceed 10 characters"),
  state: z
    .string()
    .trim()
    .min(2, "State must be at least 2 characters"),
  isActive: z.boolean(),
});

export type DistrictFormSchemaValues = z.infer<typeof districtFormSchema>;
