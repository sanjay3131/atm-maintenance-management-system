import { z } from "zod";

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

export const createJobFormSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(200),
  description: z.string().optional(),
  atmId: z.string().regex(objectIdPattern, "Select a valid ATM"),
  complaintId: z
    .string()
    .optional()
    .refine((value) => !value || objectIdPattern.test(value), {
      message: "Select a valid complaint",
    }),
  workType: z
    .enum(["repair", "maintenance", "installation", "inspection", "emergency"])
    .optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

export type CreateJobFormValues = z.infer<typeof createJobFormSchema>;
