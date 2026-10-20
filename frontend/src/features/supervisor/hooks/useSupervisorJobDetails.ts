import { useQuery } from "@tanstack/react-query";
import {
  getSupervisorJob,
  getSupervisorJobHistory,
  getSupervisorJobPhotos,
} from "@/services/supervisor.service";

export const useSupervisorJobDetails = (jobId: string, enabled = true) =>
  useQuery({
    queryKey: ["supervisor-job", jobId],
    queryFn: () => getSupervisorJob(jobId),
    enabled: enabled && Boolean(jobId),
    staleTime: 0,
    refetchOnMount: "always",
  });

export const useSupervisorJobHistory = (
  jobId: string,
  enabled = true,
) =>
  useQuery({
    queryKey: ["supervisor-job-history", jobId],
    queryFn: () => getSupervisorJobHistory(jobId),
    enabled: enabled && Boolean(jobId),
    staleTime: 0,
    refetchOnMount: "always",
  });

export const useSupervisorJobPhotos = (jobId: string, enabled = true) =>
  useQuery({
    queryKey: ["supervisor-job-photos", jobId],
    queryFn: () => getSupervisorJobPhotos(jobId),
    enabled: enabled && Boolean(jobId),
    staleTime: 0,
    refetchOnMount: "always",
  });
