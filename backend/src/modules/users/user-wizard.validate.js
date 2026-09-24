import { z } from "zod";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ID");

const userSchema = z.object({
  firstName: z.string().trim().min(2, "First name is required"),

  lastName: z.string().trim().optional(),

  email: z.string().trim().email("Invalid email"),

  password: z.string().min(8, "Password must be at least 8 characters"),

  phoneNumber: z.string().trim().min(10, "Phone number is required"),
});

const employeeSchema = z.object({
  designation: z.string().trim().min(2, "Designation is required"),

  department: z.string().trim().min(2, "Department is required"),

  joiningDate: z.coerce.date(),

  employmentType: z.enum(["full-time", "part-time", "contract"]),

  districtIds: z.array(objectIdSchema).default([]),

  assignedAtmIds: z.array(objectIdSchema).default([]),

  regionIds: z.array(objectIdSchema).default([]),

  salary: z.number().nonnegative().optional(),
});

const customerSchema = z.object({
  customerName: z.string().trim().min(2, "Customer name is required"),

  customerEmail: z.string().trim().email("Invalid customer email"),

  customerPhone: z.string().trim().min(10, "Customer phone is required"),

  bankName: z.string().trim().optional(),

  atmIds: z.array(objectIdSchema).default([]),

  districtIds: z.array(objectIdSchema).default([]),
});

export const createUserWizardSchema = z
  .object({
    user: userSchema,

    role: z.enum(["employee", "supervisor", "customer"]),

    employee: employeeSchema.optional(),

    customer: customerSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "employee" && !data.employee) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["employee"],
        message: "Employee details are required",
      });
    }

    if (data.role === "customer" && !data.customer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer"],
        message: "Customer details are required",
      });
    }
  });
