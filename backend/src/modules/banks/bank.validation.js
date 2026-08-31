import { z } from "zod";

export const createBankSchema = z.object({
  bankName: z.string().trim().min(1, "Bank name is required"),
  bankCode: z.string().trim().min(1, "Bank code is required"),
  contactEmail: z
    .string()
    .trim()
    .email("Invalid email")
    .optional()
    .or(z.literal("")),
  contactPhone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

export const updateBankSchema = z.object({
  bankName: z.string().trim().min(1, "Bank name is required").optional(),
  bankCode: z.string().trim().min(1, "Bank code is required").optional(),
  contactEmail: z
    .string()
    .trim()
    .email("Invalid email")
    .optional()
    .or(z.literal("")),
  contactPhone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});
