import { z } from "zod";

export const createATMFormSchema = z.object({
  bankId: z.string().min(1, "Bank is required"),

  customerId: z.string().min(1, "Customer is required"),

  districtId: z.string().min(1, "District is required"),

  regionId: z.string().min(1, "Region is required"),

  locationName: z.string().min(1, "Location name is required"),

  address: z.string().min(1, "Address is required"),

  installationType: z.enum(["ONSITE", "OFFSITE"]),

  status: z.enum(["ACTIVE", "INACTIVE", "UNDER_MAINTENANCE", "REMOVED"]),

  assignedEmployeeId: z.array(z.string()),
  location: z
    .object({
      type: z.literal("Point"),
      coordinates: z.tuple([z.number(), z.number()]),
    })
    .optional(),
});

export type CreateATMFormData = z.infer<typeof createATMFormSchema>;
