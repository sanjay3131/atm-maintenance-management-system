import { z } from "zod";

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid ID");
const wholeKm = z.number().finite().int().safe().min(0);
const positiveInt = z.number().finite().int().safe().min(1);
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Invalid calendar date");

const page = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(100000))
  .optional()
  .transform((value) => value ?? 1);
const limit = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(100))
  .optional()
  .transform((value) => value ?? 25);

export const vehicleIdParamsSchema = z.object({ vehicleId: objectId }).strict();
export const sessionIdParamsSchema = z.object({ sessionId: objectId }).strict();

export const vehicleListQuerySchema = z
  .object({
    page,
    limit,
    search: z.string().trim().max(100).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .strict();

export const createVehicleSchema = z
  .object({
    registrationNumber: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(
        /^[A-Za-z0-9 -]+$/,
        "Registration may contain only letters, numbers, spaces and hyphens",
      ),
    make: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(100),
    initialOdometerKm: wholeKm,
    purchaseDate: dateOnly.optional(),
    notes: z.string().trim().max(2000).optional(),
    primaryAssignedEmployeeId: objectId.optional(),
  })
  .strict();

export const updateVehicleSchema = z
  .object({
    registrationNumber: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(
        /^[A-Za-z0-9 -]+$/,
        "Registration may contain only letters, numbers, spaces and hyphens",
      )
      .optional(),
    make: z.string().trim().min(1).max(100).optional(),
    model: z.string().trim().min(1).max(100).optional(),
    purchaseDate: dateOnly.nullable().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable vehicle field is required",
  });

export const vehicleStatusSchema = z
  .object({
    status: z.enum(["ACTIVE", "INACTIVE"]),
    expectedVehicleRevision: positiveInt.or(z.literal(0)),
  })
  .strict();
export const assignmentSchema = z
  .object({
    employeeId: objectId,
    expectedVehicleRevision: positiveInt.or(z.literal(0)),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
export const unassignmentSchema = z
  .object({
    expectedVehicleRevision: positiveInt.or(z.literal(0)),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
export const transferSchema = z
  .object({
    employeeId: objectId,
    sourceVehicleId: objectId,
    targetVehicleId: objectId,
    expectedSourceRevision: positiveInt.or(z.literal(0)),
    expectedTargetRevision: positiveInt.or(z.literal(0)),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();

export const startSessionSchema = z
  .object({
    vehicleId: objectId,
    startingOdometerKm: wholeKm,
    expectedVehicleRevision: positiveInt.or(z.literal(0)),
  })
  .strict();

export const completeSessionSchema = z
  .object({
    endingOdometerKm: wholeKm,
    expectedVehicleRevision: positiveInt.or(z.literal(0)),
  })
  .strict();

export const recoverSessionSchema = z
  .object({
    action: z.enum(["RECOVERED_COMPLETED", "CANCELLED"]),
    verifiedEndOdometerKm: wholeKm,
    expectedVehicleRevision: positiveInt.or(z.literal(0)),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export const correctionSchema = z
  .object({
    correctedOdometerKm: wholeKm,
    expectedVehicleRevision: positiveInt.or(z.literal(0)),
    reason: z.string().trim().min(1).max(1000),
    usageSessionId: objectId.optional(),
    correctedField: z.enum(["START", "END"]).optional(),
  })
  .strict()
  .refine(
    ({ usageSessionId, correctedField }) =>
      (usageSessionId === undefined) === (correctedField === undefined),
    { message: "usageSessionId and correctedField must be supplied together" },
  );

export const serviceReviewParamsSchema = z
  .object({ vehicleId: objectId, serviceId: objectId })
  .strict();

export const serviceReviewSchema = z
  .object({
    expectedVehicleRevision: positiveInt.or(z.literal(0)),
    confirmReviewed: z.literal(true),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export const serviceCreateSchema = z
  .object({
    serviceType: z.literal("OIL_CHANGE").default("OIL_CHANGE"),
    serviceDate: dateOnly,
    serviceOdometerKm: wholeKm,
    notes: z.string().trim().max(2000).optional(),
    expectedVehicleRevision: positiveInt.or(z.literal(0)),
  })
  .strict();

export const servicePolicyUpdateSchema = z
  .object({
    serviceType: z.literal("OIL_CHANGE").default("OIL_CHANGE"),
    intervalKm: positiveInt,
    expectedVersion: z.number().finite().int().safe().min(0),
  })
  .strict();

export const historyQuerySchema = z
  .object({
    page,
    limit,
    fromDate: dateOnly.optional(),
    toDate: dateOnly.optional(),
  })
  .strict()
  .refine(
    (value) => (value.fromDate === undefined) === (value.toDate === undefined),
    {
      message: "fromDate and toDate must be supplied together",
    },
  );

export const reportQuerySchema = z
  .object({
    fromDate: dateOnly,
    toDate: dateOnly,
    vehicleId: objectId.optional(),
    employeeId: objectId.optional(),
  })
  .strict()
  .refine((value) => value.fromDate <= value.toDate, {
    message: "fromDate must be on or before toDate",
  });

export const vehicleReportQuerySchema = z
  .object({
    fromDate: dateOnly,
    toDate: dateOnly,
    vehicleId: objectId.optional(),
  })
  .strict()
  .refine((value) => value.fromDate <= value.toDate, {
    message: "fromDate must be on or before toDate",
  });

export const employeeReportQuerySchema = z
  .object({
    fromDate: dateOnly,
    toDate: dateOnly,
    employeeId: objectId.optional(),
  })
  .strict()
  .refine((value) => value.fromDate <= value.toDate, {
    message: "fromDate must be on or before toDate",
  });

export const adminHistoryQuerySchema = historyQuerySchema.extend({
  employeeId: objectId.optional(),
  vehicleId: objectId.optional(),
});
