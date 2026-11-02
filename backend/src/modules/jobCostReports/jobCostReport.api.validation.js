import { z } from "zod";
import {
  jobCostReportFieldsSchema,
  jobCostReportOverrideSchema,
  jobCostReportServiceVisitSchema,
} from "./jobCostReport.validation.js";

const editableReportFields = jobCostReportFieldsSchema.shape;
const patchField = (field) => field.removeDefault().optional();

export const jobCostReportParamsSchema = z
  .object({
    jobId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Job ID"),
  })
  .strict();

export const refreshJobCostReportSchema = z
  .object({
    expectedDraftRevision: z
      .number()
      .int()
      .min(1, "expectedDraftRevision must be at least 1"),
  })
  .strict();

export const updateJobCostReportSchema = z
  .object({
    expectedDraftRevision: z
      .number()
      .int()
      .min(1, "expectedDraftRevision must be at least 1"),
    serviceLaborCost: patchField(editableReportFields.serviceLaborCost),
    gstRate: patchField(editableReportFields.gstRate),
    bankPurchaseOrderNumber: patchField(
      editableReportFields.bankPurchaseOrderNumber,
    ),
    taxInvoiceNumber: patchField(editableReportFields.taxInvoiceNumber),
    filingPeriod: patchField(editableReportFields.filingPeriod),
    officeBillingStatus: patchField(
      editableReportFields.officeBillingStatus,
    ),
    overrides: jobCostReportOverrideSchema.partial().optional(),
    serviceVisits: z.array(jobCostReportServiceVisitSchema).optional(),
  })
  .strict()
  .refine(
    (payload) =>
      Object.entries(payload).some(
        ([key, value]) =>
          key !== "expectedDraftRevision" &&
          (key !== "overrides" || Object.keys(value).length > 0),
      ),
    {
      message: "At least one editable report field is required",
    },
  );
