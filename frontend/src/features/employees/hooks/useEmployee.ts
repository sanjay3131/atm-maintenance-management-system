import { useQuery } from "@tanstack/react-query";
import { getEmployeeById } from "@/services/employee.service";

export const useEmployee = (employeeId: string) => {
  return useQuery({
    queryKey: ["employee", employeeId],
    queryFn: () => getEmployeeById(employeeId),
    enabled: /^[a-fA-F0-9]{24}$/.test(employeeId),
    staleTime: 1000 * 60,
  });
};
