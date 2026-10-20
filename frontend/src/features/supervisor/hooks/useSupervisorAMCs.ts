import { useQuery } from "@tanstack/react-query";
import {
  getSupervisorAMCs,
  type SupervisorAMCListQuery,
} from "@/services/supervisor.service";

export const useSupervisorAMCs = (params: SupervisorAMCListQuery) =>
  useQuery({
    queryKey: ["supervisor-amcs", params],
    queryFn: () => getSupervisorAMCs(params),
    staleTime: 0,
    refetchOnMount: "always",
  });
