import mongoose from "mongoose";
import { z } from "zod";

const objectIdSchema = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value), "Invalid ObjectId");

const decimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "Must be a non-negative decimal with at most two places");

const optionalDateSchema = z
  .union([z.date(), z.string().datetime({ offset: true })])
  .nullable()
  .optional();

const overrideSchema = (valueSchema) =>
  z
    .object({
      value: valueSchema.nullable(),
      isOverridden: z.boolean(),
    })
    .strict();

export const jobCostReportOverrideSchema = z
  .object({
    bankName: overrideSchema(z.string().trim()),
    branch: overrideSchema(z.string().trim()),
    complaintDescription: overrideSchema(z.string().trim()),
    callLogDate: overrideSchema(
      z.union([z.date(), z.string().datetime({ offset: true })]),
    ),
    atmLocationName: overrideSchema(z.string().trim()),
    atmAddress: overrideSchema(z.string().trim()),
    assignedTechnicianName: overrideSchema(z.string().trim()),
    workType: overrideSchema(z.string().trim()),
  })
  .strict();

export const jobCostReportJobSnapshotSchema = z
  .object({
    jobId: z.string().trim().min(1),
    jobNumber: z.string().trim().nullable(),
    complaintNumber: z.string().trim().nullable(),
    callLogDate: optionalDateSchema,
    bankName: z.string().trim().nullable(),
    branch: z.string().trim().nullable(),
    atmId: z.string().trim().nullable(),
    atmLocationName: z.string().trim().nullable(),
    atmAddress: z.string().trim().nullable(),
    complaintDescription: z.string().trim().nullable(),
    currentStatus: z.string().trim().nullable(),
    assignedTechnicianName: z.string().trim().nullable(),
    assignedEmployeeCode: z.string().trim().nullable(),
    workType: z.string().trim().nullable(),
    completionDate: optionalDateSchema,
    employeeRemarks: z.string().trim().nullable(),
  })
  .strict();

export const jobCostReportFieldsSchema = z
  .object({
    serviceLaborCost: decimalStringSchema.default("0.00"),
    gstRate: decimalStringSchema.default("18.00"),
    bankPurchaseOrderNumber: z.string().trim().max(200).default(""),
    taxInvoiceNumber: z.string().trim().max(200).default(""),
    filingPeriod: z.string().trim().max(200).default(""),
    officeBillingStatus: z.string().trim().max(200).default(""),
    overrides: jobCostReportOverrideSchema,
  })
  .strict();

export const jobCostReportServiceVisitSchema = z
  .object({
    _id: objectIdSchema.optional(),
    sequence: z.number().int().min(1),
    visitDate: optionalDateSchema,
    workPerformed: z.string().trim().max(2000).nullable().optional(),
    status: z.string().trim().max(100).nullable().optional(),
    signOffOrPhotoReference: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional(),
  })
  .strict();

export const jobCostReportMaterialSnapshotSchema = z
  .object({
    usageId: objectIdSchema,
    itemId: objectIdSchema.nullable().optional(),
    itemNameSnapshot: z.string().trim().min(1),
    quantity: z.number().finite().nonnegative(),
    unitSnapshot: z.string().trim().min(1),
    unitCostSnapshot: decimalStringSchema,
    lineCostSnapshot: decimalStringSchema,
    capturedAt: z.union([
      z.date(),
      z.string().datetime({ offset: true }),
    ]),
  })
  .strict();

export const materialSnapshotStatusSchema = z.enum([
  "NOT_REFRESHED",
  "REFRESHED",
]);

export const materialSnapshotRevisionSchema = z
  .object({
    value: z.number().int().nonnegative().nullable(),
    isKnown: z.boolean(),
  })
  .strict()
  .superRefine(({ value, isKnown }, context) => {
    if ((!isKnown && value !== null) || (isKnown && value === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Material revision value must match isKnown",
      });
    }
  });

const uniqueVisitSequences = (visits) => {
  const sequences = visits.map((visit) => visit.sequence);
  return new Set(sequences).size === sequences.length;
};

export const jobCostReportSourceRevisionsSchema = z
  .object({
    materialUsageRevision: z
      .object({
        value: z.number().int().nonnegative().nullable(),
        isKnown: z.boolean(),
      })
      .strict(),
    jobUpdatedAt: optionalDateSchema,
    complaintUpdatedAt: optionalDateSchema,
  })
  .strict()
  .superRefine(({ materialUsageRevision }, context) => {
    const { value, isKnown } = materialUsageRevision;
    if ((!isKnown && value !== null) || (isKnown && value === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materialUsageRevision"],
        message: "Material revision value must match isKnown",
      });
    }
  });

export const jobCostReportSchema = z
  .object({
    jobId: objectIdSchema,
    draftRevision: z.number().int().min(1).default(1),
    status: z.literal("DRAFT").default("DRAFT"),
    jobSnapshot: jobCostReportJobSnapshotSchema,
    reportFields: jobCostReportFieldsSchema,
    serviceVisits: z
      .array(jobCostReportServiceVisitSchema)
      .refine(uniqueVisitSequences, "Service visit sequences must be unique")
      .default([]),
    materialSnapshot: z
      .array(jobCostReportMaterialSnapshotSchema)
      .default([]),
    materialSnapshotStatus: materialSnapshotStatusSchema.default("NOT_REFRESHED"),
    materialSnapshotRevision: materialSnapshotRevisionSchema.default({
      value: null,
      isKnown: false,
    }),
    sourceRevisions: jobCostReportSourceRevisionsSchema,
    createdBy: objectIdSchema,
    updatedBy: objectIdSchema,
  })
  .strict();
