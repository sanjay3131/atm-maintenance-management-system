import { z } from "zod";

export const createCustomerSchema = z.object({
  firstName: z.string().min(1, "First name is required").trim(),
  lastName: z.string().optional(),
  email: z.string().email("Invalid email").toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phoneNumber: z.string().min(10, "Phone number is required"),
  customerName: z.string().min(1, "Customer name is required").optional(),
  customerPhone: z.string().optional(),
  bankName: z.string().min(1, "Bank name is required"),
  atmIds: z.array(z.string()).optional(),
  districtIds: z.array(z.string()).optional(),
});

export const updateCustomerSchema = z.object({
  customerName: z.string().min(1).optional(),
  customerPhone: z.string().optional(),
  bankName: z.string().optional(),
  atmIds: z.array(z.string()).optional(),
  districtIds: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});
