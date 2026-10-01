import { useQuery } from "@tanstack/react-query";
import { getMyJobs } from "../services/jobs.service";
import type { MyJobsQueryParams } from "../types/job.types";

export const useMyJobs = (params: MyJobsQueryParams) => {
  return useQuery({
    queryKey: ["my-jobs", params],
    queryFn: () => getMyJobs(params),
  });
};
