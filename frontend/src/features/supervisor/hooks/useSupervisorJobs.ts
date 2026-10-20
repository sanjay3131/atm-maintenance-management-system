import { useQuery } from "@tanstack/react-query";
import {
  getSupervisorJobs,
  type SupervisorJobListQuery,
} from "@/services/supervisor.service";

export const useSupervisorJobs = (
  params: SupervisorJobListQuery,
  enabled = true,
) =>
  useQuery({
    queryKey: ["supervisor-jobs", params],
    queryFn: () => getSupervisorJobs(params),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
