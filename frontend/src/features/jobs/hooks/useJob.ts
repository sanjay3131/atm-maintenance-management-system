import { useQuery } from "@tanstack/react-query";
import { getJobById } from "../services/jobs.service";

export const useJob = (jobId: string) => {
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJobById(jobId),
    enabled: Boolean(jobId),
  });
};
