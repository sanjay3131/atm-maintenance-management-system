import { useQuery } from "@tanstack/react-query";
import { getJobs } from "../services/jobs.service";
import type { JobsQueryParams } from "../types/job.types";

export const useJobs = (params: JobsQueryParams, enabled = true) => {
  return useQuery({
    queryKey: ["jobs", params],
    queryFn: () => getJobs(params),
    enabled,
  });
};
