import api from "@/lib/axios";
import type {
  JobCostReport,
  JobCostReportPatch,
} from "../types/jobCostReport.types";
import { getJobCostReportDownloadFilename } from "../utils/jobCostReportExport.utils";

export const getJobCostReport = async (
  jobId: string,
): Promise<JobCostReport> => {
  const response = await api.get<{ data: JobCostReport }>(
    `/jobs/${jobId}/cost-report`,
  );
  return response.data.data;
};

export const initializeJobCostReport = async (
  jobId: string,
): Promise<JobCostReport> => {
  const response = await api.post<{ data: JobCostReport }>(
    `/jobs/${jobId}/cost-report`,
  );
  return response.data.data;
};

export const updateJobCostReport = async (
  jobId: string,
  patch: JobCostReportPatch,
): Promise<JobCostReport> => {
  const response = await api.patch<{ data: JobCostReport }>(
    `/jobs/${jobId}/cost-report`,
    patch,
  );
  return response.data.data;
};

export const refreshJobCostReportMaterials = async (
  jobId: string,
  expectedDraftRevision: number,
): Promise<JobCostReport> => {
  const response = await api.post<{ data: JobCostReport }>(
    `/jobs/${jobId}/cost-report/materials/refresh`,
    { expectedDraftRevision },
  );
  return response.data.data;
};

export const downloadJobCostReport = async (jobId: string) => {
  const response = await api.get<Blob>(
    `/jobs/${jobId}/cost-report/export.xlsx`,
    { responseType: "blob" },
  );

  return {
    blob: response.data,
    filename: getJobCostReportDownloadFilename(
      response.headers["content-disposition"],
      jobId,
    ),
  };
};
