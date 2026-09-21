import { useQuery } from "@tanstack/react-query";
import { getJobTrends } from "@/services/dashboard.service";

export const useJobTrends = () => {
  return useQuery({
    queryKey: ["dashboard-job-trends"],
    queryFn: () => getJobTrends("week"),
    staleTime: 1000 * 60,
  });
};
