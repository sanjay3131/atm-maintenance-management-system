import { useQuery } from "@tanstack/react-query";
import {
  getSupervisorEmployee,
  type SupervisorEmployeeDetailsResponse,
} from "@/services/supervisor.service";

export const useSupervisorEmployeeDetails = (
  employeeId: string,
  enabled = true,
) =>
  useQuery<SupervisorEmployeeDetailsResponse>({
    queryKey: ["supervisor-employee", employeeId],
    queryFn: () => getSupervisorEmployee(employeeId),
    enabled: enabled && Boolean(employeeId),
    staleTime: 0,
    refetchOnMount: "always",
  });
