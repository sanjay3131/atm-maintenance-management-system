import type {
  AcSubType,
  JobWorkType,
  SelectableJobWorkType,
} from "../types/job.types.ts";

const WORK_TYPE_LABELS: Record<JobWorkType, string> = {
  carpentry: "Carpentry",
  electrical: "Electrical",
  plumbing: "Plumbing",
  shifting: "Shifting",
  service: "Service",
  installation: "Installation",
  maintenance: "Maintenance",
  repair: "Repair",
  free_of_cost: "For (Free of Cost)",
  renovation: "Renovation",
  dismantling: "Dismantling",
  event: "Event",
  ac: "AC",
  inspection: "Inspection",
  emergency: "Emergency",
};

const AC_SUB_TYPE_LABELS: Record<AcSubType, string> = {
  amc: "AMC",
  town_call: "Town Call",
  installation: "Installation",
};

export const isAcWorkType = (workType?: string | null) =>
  workType === "ac";

export const getAcSubTypeAfterWorkTypeChange = (
  workType: SelectableJobWorkType | undefined,
  currentAcSubType?: AcSubType,
) => (isAcWorkType(workType) ? currentAcSubType : undefined);

export const formatJobWorkType = (workType?: string | null) => {
  if (!workType) return "Not available";
  if (workType in WORK_TYPE_LABELS) {
    return WORK_TYPE_LABELS[workType as JobWorkType];
  }
  return workType
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

export const formatAcSubType = (acSubType?: string | null) => {
  if (!acSubType) return "Not available";
  if (acSubType in AC_SUB_TYPE_LABELS) {
    return AC_SUB_TYPE_LABELS[acSubType as AcSubType];
  }
  return acSubType
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};
