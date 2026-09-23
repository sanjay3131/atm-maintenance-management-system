import { useQuery } from "@tanstack/react-query";
import { getEmployees } from "@/services/employee.service";

export const useEmployees = () => {
  return useQuery({
    queryKey: ["employees"],
    queryFn: getEmployees,
    staleTime: 1000 * 60,
  });
};
