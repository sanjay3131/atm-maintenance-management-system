import { useQuery } from "@tanstack/react-query";
import {
  getSupervisorEmployees,
  type SupervisorEmployeeListQuery,
} from "@/services/supervisor.service";

export const useSupervisorEmployees = (params: SupervisorEmployeeListQuery) =>
  useQuery({
    queryKey: ["supervisor-employees", params],
    queryFn: () => getSupervisorEmployees(params),
    staleTime: 0,
    refetchOnMount: "always",
  });
