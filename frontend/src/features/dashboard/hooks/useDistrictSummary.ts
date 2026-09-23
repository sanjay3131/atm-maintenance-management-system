import { useQuery } from "@tanstack/react-query";
import { getDistrictSummary } from "@/services/dashboard.service";

export const useDistrictSummary = () => {
  return useQuery({
    queryKey: ["dashboard-district-summary"],
    queryFn: getDistrictSummary,
    staleTime: 1000 * 60,
  });
};
