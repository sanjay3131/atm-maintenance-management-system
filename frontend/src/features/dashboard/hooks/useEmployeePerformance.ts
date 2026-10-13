import { useQuery } from "@tanstack/react-query";
import { getEmployeePerformance } from "@/services/dashboard.service";

export const useEmployeePerformance = (
  employeeId?: string,
  enabled = true,
) => {
  return useQuery({
    queryKey: employeeId
      ? ["dashboard-employee-performance", employeeId]
      : ["dashboard-employee-performance"],
    queryFn: () => getEmployeePerformance("month", employeeId),
    enabled,
    staleTime: 1000 * 60,
  });
};
