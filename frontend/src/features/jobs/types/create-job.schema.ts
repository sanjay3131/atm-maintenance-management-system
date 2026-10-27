import { z } from "zod";
import {
  AC_SUB_TYPES,
  JOB_WORK_TYPES,
  LEGACY_JOB_WORK_TYPES,
  type SelectableJobWorkType,
} from "./job.types.ts";

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

export const createJobFormSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(200),
  description: z.string().optional(),
  atmId: z.string().regex(objectIdPattern, "Select a valid ATM"),
  complaintId: z
    .string()
    .optional()
    .refine((value) => !value || objectIdPattern.test(value), {
      message: "Select a valid complaint",
    }),
  workType: z.enum(JOB_WORK_TYPES).optional(),
  acSubType: z.enum(AC_SUB_TYPES).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
}).superRefine((job, context) => {
  if (job.workType === "ac" && !job.acSubType) {
    context.addIssue({
      code: "custom",
      path: ["acSubType"],
      message: "Select an AC sub-type",
    });
  }
  if (job.workType !== "ac" && job.acSubType !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["acSubType"],
      message: "AC sub-type is only available for AC work",
    });
  }
});

export const updateJobFormSchema = z
  .object({
    title: z.string().min(3, "Title must be at least 3 characters").max(200),
    description: z.string().optional(),
    workType: z.enum([...JOB_WORK_TYPES, ...LEGACY_JOB_WORK_TYPES]),
    acSubType: z.enum(AC_SUB_TYPES).optional(),
    priority: z.enum(["low", "medium", "high", "critical"]),
  })
  .superRefine((job, context) => {
    if (job.workType === "ac" && !job.acSubType) {
      context.addIssue({
        code: "custom",
        path: ["acSubType"],
        message: "Select an AC sub-type",
      });
    }
    if (job.workType !== "ac" && job.acSubType !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["acSubType"],
        message: "AC sub-type is only available for AC work",
      });
    }
  });

export type CreateJobFormValues = z.infer<typeof createJobFormSchema>;
export type UpdateJobFormValues = z.infer<typeof updateJobFormSchema>;
export type JobWorkTypeFormValue = SelectableJobWorkType;
