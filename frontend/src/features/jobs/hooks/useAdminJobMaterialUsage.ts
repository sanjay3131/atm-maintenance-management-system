import { useQuery } from "@tanstack/react-query";
import { getAdminJobMaterialUsage } from "../services/jobs.service";

export const useAdminJobMaterialUsage = (jobId: string) =>
  useQuery({
    queryKey: ["admin-job-material-usage", jobId],
    queryFn: () => getAdminJobMaterialUsage(jobId),
    enabled: Boolean(jobId),
    retry: false,
  });
