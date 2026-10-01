import { useQuery } from "@tanstack/react-query";
import { getJobHistory } from "../services/jobs.service";

export const useJobHistory = (jobId: string) => {
  return useQuery({
    queryKey: ["job-history", jobId],
    queryFn: () => getJobHistory(jobId),
    enabled: Boolean(jobId),
  });
};
