import type { JobStatus } from "../types/job.types";

export const EMPLOYEE_JOB_STATUSES = [
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
] as const satisfies readonly JobStatus[];

function isJobStatus(value: string): value is JobStatus {
  return (EMPLOYEE_JOB_STATUSES as readonly string[]).includes(value);
}

export type EmployeeJobStatusFilter =
  | { kind: "all" }
  | { kind: "valid"; status: JobStatus }
  | { kind: "invalid" };

export function parseEmployeeJobStatusFilter(
  value: string | null,
): EmployeeJobStatusFilter {
  if (value === null || value === "") return { kind: "all" };
  return isJobStatus(value)
    ? { kind: "valid", status: value }
    : { kind: "invalid" };
}

export function getEmployeeJobsStatusHref(status?: JobStatus) {
  return status
    ? `/employee/jobs?status=${encodeURIComponent(status)}`
    : "/employee/jobs";
}

export function getEmployeeJobsStatusChange(
  status: JobStatus | "ALL",
  currentPage: number,
) {
  return {
    status,
    page: currentPage === 1 ? currentPage : 1,
  };
}

export function getEmployeeJobsPage(
  currentStatus: string | null,
  requestedStatus: string | null,
  currentPage: number,
) {
  return currentStatus === requestedStatus ? currentPage : 1;
}
