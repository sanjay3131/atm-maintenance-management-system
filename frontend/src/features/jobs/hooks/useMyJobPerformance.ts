import { useQuery } from "@tanstack/react-query";
import { getMyJobPerformance } from "../services/jobs.service";
import type { JobPerformancePeriod } from "../types/job.types";

export const useMyJobPerformance = (period: JobPerformancePeriod) => {
  return useQuery({
    queryKey: ["my-job-performance", period],
    queryFn: () => getMyJobPerformance(period),
  });
};
