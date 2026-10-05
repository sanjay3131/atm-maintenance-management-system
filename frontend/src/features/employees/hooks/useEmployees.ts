import { useQuery } from "@tanstack/react-query";
import { getEmployees } from "@/services/employee.service";

export const useEmployees = (enabled = true) => {
  return useQuery({
    queryKey: ["employees"],
    queryFn: getEmployees,
    enabled,
    staleTime: 1000 * 60,
  });
};
