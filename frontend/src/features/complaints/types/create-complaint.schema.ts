import { z } from "zod";

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

export const createComplaintSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Title must be at least 3 characters")
    .max(200, "Title must not exceed 200 characters"),
  description: z
    .string()
    .trim()
    .min(5, "Description must be at least 5 characters")
    .max(2000, "Description must not exceed 2000 characters"),
  atmId: z.string().regex(objectIdPattern, "Select a valid ATM"),
  customerId: z
    .string()
    .optional()
    .refine((value) => !value || objectIdPattern.test(value), {
      message: "Select a valid customer",
    }),
  reportedBy: z
    .string()
    .trim()
    .min(1, "Reported by is required")
    .max(100, "Reported by must not exceed 100 characters"),
  reportedVia: z.enum(["phone", "email", "whatsapp", "in_person", "other"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
});

export type CreateComplaintFormValues = z.infer<typeof createComplaintSchema>;
