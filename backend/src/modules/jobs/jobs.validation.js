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
  rejectionReason: z.string().optional(),
});

export const approveJobSchema = z.object({
  action: z.enum(["approve", "reject"]),
  remarks: z.string().optional(),
  rejectionReason: z.string().optional(),
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
