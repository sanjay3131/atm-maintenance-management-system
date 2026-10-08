import { z } from "zod";

export const recurringMaintenanceFormSchema = z
  .object({
    atmId: z.string().min(1, "Select an ATM"),
    assignedEmployeeId: z.string().min(1, "Select an eligible employee"),
    maintenanceType: z.enum(["DAILY_CLEANING", "WEEKLY_MOPPING"]),
    startDate: z.string().min(1, "Start date is required"),
    dayOfWeek: z.string(),
  })
  .superRefine((values, context) => {
    if (
      values.maintenanceType === "WEEKLY_MOPPING" &&
      values.dayOfWeek === ""
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayOfWeek"],
        message: "Select a weekday for weekly mopping",
      });
    }

    if (
      values.maintenanceType === "DAILY_CLEANING" &&
      values.dayOfWeek !== ""
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dayOfWeek"],
        message: "Daily cleaning does not use a weekday",
      });
    }
  });

export type RecurringMaintenanceFormValues = z.infer<
  typeof recurringMaintenanceFormSchema
>;
