import { z } from "zod";

const clientAtmIdSchema = z
  .string()
  .trim()
  .min(1, "Client ATM ID is required")
  .transform((value) => value.toUpperCase());

const citySchema = z.string().trim().min(1, "City is required");

const optionalClientAtmIdSchema = z.union([
  z.literal("").transform(() => undefined),
  clientAtmIdSchema,
]);

const optionalCitySchema = z.union([
  z.literal("").transform(() => undefined),
  citySchema,
]);

const atmFormFields = {
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
};

export const createATMFormSchema = z.object({
  ...atmFormFields,
  clientAtmId: clientAtmIdSchema,
  city: citySchema,
});

export const updateATMFormSchema = z.object({
  ...atmFormFields,
  clientAtmId: optionalClientAtmIdSchema,
  city: optionalCitySchema,
});

export type ATMFormValues = z.input<typeof createATMFormSchema>;
export type ATMFormData = z.output<typeof updateATMFormSchema>;
