import { z } from "zod";

export const createComplaintSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters")
    .max(200, "Title must not exceed 200 characters"),
  description: z
    .string()
    .min(5, "Description must be at least 5 characters")
    .max(2000, "Description must not exceed 2000 characters"),
  atmId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ATM ID"),
  customerId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid customer ID")
    .optional()
    .nullable(),
  reportedBy: z
    .string()
    .min(1, "Reported by is required")
    .max(100, "Reported by must not exceed 100 characters"),
  reportedVia: z
    .enum(["phone", "email", "whatsapp", "in_person", "other"])
    .default("phone"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
});

export const updateComplaintSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters")
    .max(200, "Title must not exceed 200 characters")
    .optional(),
  description: z
    .string()
    .min(5, "Description must be at least 5 characters")
    .max(2000, "Description must not exceed 2000 characters")
    .optional(),
  status: z
    .enum([
      "OPEN",
      "ASSIGNED",
      "IN_PROGRESS",
      "RESOLVED",
      "CLOSED",
      "CANCELLED",
    ])
    .optional(),
  reportedBy: z.string().min(1, "Reported by is required").max(100).optional(),
  reportedVia: z
    .enum(["phone", "email", "whatsapp", "in_person", "other"])
    .optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  resolutionNotes: z.string().max(2000).optional(),
  closureReason: z.string().max(1000).optional(),
});

export const linkJobSchema = z.object({
  jobId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Job ID"),
});
