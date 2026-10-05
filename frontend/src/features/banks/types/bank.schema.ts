import { z } from "zod";

export const bankFormSchema = z.object({
  bankName: z.string().trim().min(1, "Bank name is required"),
  bankCode: z.string().trim().min(1, "Bank code is required"),
  contactEmail: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .or(z.literal("")),
  contactPhone: z.string().trim(),
  address: z.string().trim(),
});

export type BankFormSchemaValues = z.infer<typeof bankFormSchema>;
