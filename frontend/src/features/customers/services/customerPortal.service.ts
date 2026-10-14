import api from "@/lib/axios";
import type { Job } from "@/features/jobs/types/job.types";

export interface CustomerPortalATM {
  _id: string;
  atmId: string;
  locationName: string;
  address: string;
  installationType?: string;
  status?: string;
  bank?: string | null;
  district?: string | null;
  region?: string | null;
}

export interface CustomerPortalProfile {
  _id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  bankName: string;
}

export interface CustomerPortalAMC {
  _id: string;
  amcId: string;
  atmId?: {
    _id: string;
    atmId?: string;
    locationName?: string;
    address?: string;
  } | string | null;
  month: number;
  year: number;
  status: string;
  deadlineDate?: string;
  visitDate?: string | null;
  completedAt?: string | null;
  checklistCompleted?: boolean;
  checklist?: Array<{ item: string; response: string; remarks?: string }>;
  photoCount?: number;
  generatedAt?: string;
}

export interface CustomerPortalHistory {
  _id: string;
  action: string;
  fromStatus?: string;
  toStatus?: string;
  performedAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type CustomerJobReportStatus = "VERIFIED" | "APPROVED" | "CLOSED";

export interface CustomerReportFilters {
  fromDate?: string;
  toDate?: string;
  jobStatus?: CustomerJobReportStatus;
}

export interface CustomerReportSummary {
  dateRange: { fromDate: string; toDate: string } | null;
  jobStatus: CustomerJobReportStatus | null;
  totalJobs: number;
  jobsByStatus: Record<CustomerJobReportStatus, number>;
  closedJobs: number;
  completionRate: number;
  completedAMCs: number;
}

const portalPath = "/customers/portal";

const reportParams = (filters: CustomerReportFilters) => {
  const params = new URLSearchParams();
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.jobStatus) params.set("jobStatus", filters.jobStatus);
  return params;
};

export async function getCustomerReportSummary(
  filters: CustomerReportFilters,
) {
  const response = await api.get<{ data: CustomerReportSummary }>(
    `${portalPath}/reports/summary`,
    { params: reportParams(filters) },
  );
  return response.data.data;
}

async function downloadCustomerReport(
  report: "jobs" | "amcs",
  filters: CustomerReportFilters,
) {
  const response = await api.get<Blob>(
    `${portalPath}/reports/${report}.xlsx`,
    {
      params: reportParams(filters),
      responseType: "blob",
    },
  );
  const prefix =
    report === "jobs" ? "customer-job-history" : "customer-completed-amc";
  const expectedFilename = new RegExp(
    `^${prefix}(?:-\\d{4}-\\d{2}-\\d{2}-to-\\d{4}-\\d{2}-\\d{2})?\\.xlsx$`,
  );
  const disposition = response.headers["content-disposition"] ?? "";
  const candidate = disposition.match(/filename="([^"]+)"/)?.[1] ?? "";
  return {
    blob: response.data,
    filename: expectedFilename.test(candidate)
      ? candidate
      : `${prefix}.xlsx`,
  };
}

export const downloadCustomerJobReport = (
  filters: CustomerReportFilters,
) => downloadCustomerReport("jobs", filters);

export const downloadCustomerAMCReport = (
  filters: CustomerReportFilters,
) => downloadCustomerReport("amcs", filters);

export async function getCustomerPortalProfile() {
  const response = await api.get<{
    data: {
      profile: CustomerPortalProfile;
      totalATMs: number;
    };
  }>(`${portalPath}/profile`);
  return response.data.data;
}

export async function getCustomerPortalATMs(page = 1) {
  const response = await api.get<{
    data: { atms: CustomerPortalATM[]; pagination: Pagination };
  }>(`${portalPath}/atms`, { params: { page, limit: 100 } });
  return response.data.data;
}

export async function getCustomerPortalATM(atmId: string) {
  const response = await api.get<{ data: CustomerPortalATM }>(
    `${portalPath}/atms/${encodeURIComponent(atmId)}`,
  );
  return response.data.data;
}

export async function getCustomerPortalJobs(page = 1) {
  const response = await api.get<{
    data: { jobs: Job[]; pagination: Pagination };
  }>(`${portalPath}/jobs`, { params: { page, limit: 100 } });
  return response.data.data;
}

export async function getCustomerPortalJob(jobId: string) {
  const response = await api.get<{ data: Job }>(
    `${portalPath}/jobs/${encodeURIComponent(jobId)}`,
  );
  return response.data.data;
}

export async function getCustomerPortalJobHistory(jobId: string) {
  const response = await api.get<{ data: CustomerPortalHistory[] }>(
    `/jobs/${encodeURIComponent(jobId)}/history`,
  );
  return response.data.data;
}

export async function getCustomerPortalAMCs(page = 1) {
  const response = await api.get<{
    data: { amcs: CustomerPortalAMC[]; pagination: Pagination };
  }>(`${portalPath}/amcs`, { params: { page, limit: 100 } });
  return response.data.data;
}

export async function getCustomerPortalAMC(amcId: string) {
  const response = await api.get<{ data: CustomerPortalAMC }>(
    `/amc/${encodeURIComponent(amcId)}`,
  );
  return response.data.data;
}
