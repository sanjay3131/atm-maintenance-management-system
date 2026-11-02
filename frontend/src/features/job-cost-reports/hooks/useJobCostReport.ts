import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getJobCostReport,
  initializeJobCostReport,
  refreshJobCostReportMaterials,
  updateJobCostReport,
} from "../services/jobCostReport.service";
import type { JobCostReportPatch } from "../types/jobCostReport.types";

export const jobCostReportQueryKey = (jobId: string) => [
  "job-cost-report",
  jobId,
];

export const useJobCostReport = (jobId: string) =>
  useQuery({
    queryKey: jobCostReportQueryKey(jobId),
    queryFn: () => getJobCostReport(jobId),
    enabled: Boolean(jobId),
    retry: false,
  });

export const useInitializeJobCostReport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: initializeJobCostReport,
    onSuccess: (report) => {
      void queryClient.setQueryData(
        jobCostReportQueryKey(report.jobId.toString()),
        report,
      );
    },
  });
};

export const useUpdateJobCostReport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      patch,
    }: {
      jobId: string;
      patch: JobCostReportPatch;
    }) => updateJobCostReport(jobId, patch),
    onSuccess: (report, variables) => {
      void queryClient.setQueryData(
        jobCostReportQueryKey(variables.jobId),
        report,
      );
    },
  });
};

export const useRefreshJobCostReportMaterials = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      expectedDraftRevision,
    }: {
      jobId: string;
      expectedDraftRevision: number;
    }) => refreshJobCostReportMaterials(jobId, expectedDraftRevision),
    onSuccess: (report, variables) => {
      void queryClient.setQueryData(
        jobCostReportQueryKey(variables.jobId),
        report,
      );
    },
  });
};
