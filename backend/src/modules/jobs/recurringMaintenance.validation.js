import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid ID");
const dateSchema = z.coerce.date();

export const createRecurringMaintenancePlanSchema = z
  .object({
    atmId: objectIdSchema,
    assignedEmployeeId: objectIdSchema,
    maintenanceType: z.enum(["DAILY_CLEANING", "WEEKLY_MOPPING"]),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    startDate: dateSchema.optional(),
  })
  .superRefine((plan, context) => {
    if (plan.maintenanceType === "WEEKLY_MOPPING" && plan.dayOfWeek == null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayOfWeek"],
        message: "A weekday is required for weekly mopping",
      });
    }
    if (
      plan.maintenanceType === "DAILY_CLEANING" &&
      plan.dayOfWeek !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayOfWeek"],
        message: "Daily cleaning cannot have a weekday",
      });
    }
  });

export const updateRecurringMaintenancePlanSchema = z
  .object({
    assignedEmployeeId: objectIdSchema.optional(),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    startDate: dateSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one plan field must be provided",
  });
