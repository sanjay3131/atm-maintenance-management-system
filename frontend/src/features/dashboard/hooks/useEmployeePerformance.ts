import { useQuery } from "@tanstack/react-query";
import { getEmployeePerformance } from "@/services/dashboard.service";

export const useEmployeePerformance = () => {
  return useQuery({
    queryKey: ["dashboard-employee-performance"],
    queryFn: () => getEmployeePerformance("month"),
    staleTime: 1000 * 60,
  });
};
