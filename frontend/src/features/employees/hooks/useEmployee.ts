import { useQuery } from "@tanstack/react-query";
import { getEmployeeById } from "@/services/employee.service";

export const useEmployee = (employeeId: string) => {
  return useQuery({
    queryKey: ["employee", employeeId],
    queryFn: () => getEmployeeById(employeeId),
    enabled: Boolean(employeeId),
    staleTime: 1000 * 60,
  });
};
