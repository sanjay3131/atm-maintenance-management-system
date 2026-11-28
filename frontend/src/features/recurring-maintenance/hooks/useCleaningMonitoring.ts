import { useQuery } from "@tanstack/react-query";
import { getCleaningMonitoring } from "../services/recurring-maintenance.service";
import { RECURRING_PLANS_QUERY_KEY } from "./useRecurringPlans";

export const CLEANING_MONITORING_QUERY_KEY = [
  ...RECURRING_PLANS_QUERY_KEY,
  "monitoring",
];

export const useCleaningMonitoring = () =>
  useQuery({
    queryKey: CLEANING_MONITORING_QUERY_KEY,
    queryFn: getCleaningMonitoring,
  });
