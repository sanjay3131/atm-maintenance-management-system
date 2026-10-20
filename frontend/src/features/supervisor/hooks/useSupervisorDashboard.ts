import { useQuery } from "@tanstack/react-query";
import { getSupervisorDashboard } from "@/services/supervisor.service";

export const SUPERVISOR_DASHBOARD_QUERY_KEY = ["supervisor-dashboard"];

export const useSupervisorDashboard = () =>
  useQuery({
    queryKey: SUPERVISOR_DASHBOARD_QUERY_KEY,
    queryFn: getSupervisorDashboard,
    staleTime: 1000 * 60,
  });
