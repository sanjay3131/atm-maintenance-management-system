import type {
  SupervisorJobHistoryEntry,
  SupervisorJobPhoto,
  SupervisorJobStatus,
} from "@/services/supervisor.service";
import {
  formatAcSubType,
  formatJobWorkType,
} from "../jobs/utils/jobWorkType.utils.ts";

export const SUPERVISOR_JOB_STATUSES: SupervisorJobStatus[] = [
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
  "CANCELLED",
];

export const isSupervisorJobId = (jobId: string) =>
  /^[a-f\d]{24}$/i.test(jobId);

export const isSupervisorJobDateRangeValid = (
  fromDate: string,
  toDate: string,
) => !fromDate || !toDate || fromDate <= toDate;

export const formatSupervisorJobLabel = (value?: string | null) =>
  value
    ? value
        .toLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : "Unavailable";

export { formatAcSubType, formatJobWorkType };

export const supervisorJobPhotoUrl = (
  photo: Pick<SupervisorJobPhoto, "url" | "thumbnailUrl">,
) => photo.thumbnailUrl || photo.url || undefined;

export const chronologicalJobHistory = (
  history: readonly SupervisorJobHistoryEntry[],
) => [...history].reverse();
