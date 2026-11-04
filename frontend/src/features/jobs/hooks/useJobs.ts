import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { getJobs } from "../services/jobs.service";
import type { JobsListResponse, JobsQueryParams } from "../types/job.types";

export const useJobs = (
  params: JobsQueryParams,
  enabled = true,
  options: Pick<UseQueryOptions<JobsListResponse>, "placeholderData"> = {},
) => {
  return useQuery({
    queryKey: ["jobs", params],
    queryFn: () => getJobs(params),
    enabled,
    ...options,
  });
};
