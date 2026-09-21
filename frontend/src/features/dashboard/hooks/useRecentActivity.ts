import { useQuery } from "@tanstack/react-query";
import { getRecentActivity } from "@/services/dashboard.service";

export const useRecentActivity = () => {
  return useQuery({
    queryKey: ["dashboard-recent-activity"],
    queryFn: () => getRecentActivity(10),
    staleTime: 1000 * 30,
  });
};
