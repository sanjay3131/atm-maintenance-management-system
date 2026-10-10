import { z } from "zod";

export const createJobSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(200),
  description: z.string().optional(),
  atmId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ATM ID"),
  complaintId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  customerId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  workType: z
    .enum(["repair", "maintenance", "installation", "inspection", "emergency"])
    .optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

export const assignJobSchema = z.object({
  employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Employee ID"),
});

export const updateStatusSchema = z.object({
  status: z.enum([
    "PENDING",
    "ASSIGNED",
    "ACCEPTED",
    "IN_PROGRESS",
    "ON_HOLD",
    "COMPLETED",
    "VERIFIED",
    "APPROVED",
    "CLOSED",
    "REJECTED",
  ]),
  remarks: z.string().optional(),
});

export const completeJobSchema = z.object({
  gps: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().optional(),
  }),
  remarks: z.string().optional(),
});

export const reassignJobSchema = z.object({
  employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Employee ID"),
  reason: z.string().min(5, "Reason must be at least 5 characters"),
});

export const verifyJobSchema = z.object({
  action: z.enum(["verify", "reject"]),
  remarks: z.string().optional(),
});

export const approveJobSchema = z.object({
  action: z.enum(["approve", "reject"]),
  remarks: z.string().optional(),
});

export const cancelJobSchema = z.object({
  reason: z.string().trim().min(1, "Cancellation reason is required").max(1000),
});

export const jobFilterSchema = z
  .object({
    status: z.string().optional(),
    priority: z.string().optional(),
    workType: z.string().optional(),
    employeeId: z.string().optional(),
    atmId: z.string().optional(),
    customerId: z.string().optional(),
    districtId: z.string().optional(),
    bank: z.string().optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
  })
  .optional();

const performanceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Date must be a valid calendar date");

export const myJobPerformanceQuerySchema = z
  .object({
    period: z.enum(["week", "month", "year"]).optional(),
    fromDate: performanceDateSchema.optional(),
    toDate: performanceDateSchema.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    const hasFromDate = query.fromDate !== undefined;
    const hasToDate = query.toDate !== undefined;

    if (hasFromDate !== hasToDate) {
      context.addIssue({
        code: "custom",
        path: [hasFromDate ? "toDate" : "fromDate"],
        message: "fromDate and toDate must be provided together",
      });
    }

    if (hasFromDate && query.period) {
      context.addIssue({
        code: "custom",
        path: ["period"],
        message: "Choose either period or fromDate/toDate",
      });
    }

    if (hasFromDate && hasToDate && query.fromDate > query.toDate) {
      context.addIssue({
        code: "custom",
        path: ["fromDate"],
        message: "fromDate must be on or before toDate",
      });
    }
  });
