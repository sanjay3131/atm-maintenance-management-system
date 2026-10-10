import { useQuery } from "@tanstack/react-query";
import { getMyEmployeeProfile } from "@/services/employee.service";

export const useMyEmployeeProfile = () => {
  return useQuery({
    queryKey: ["my-employee-profile"],
    queryFn: getMyEmployeeProfile,
    staleTime: 1000 * 60,
  });
};
