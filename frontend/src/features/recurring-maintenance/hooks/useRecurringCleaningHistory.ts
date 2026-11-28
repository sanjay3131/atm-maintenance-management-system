import { useQuery } from "@tanstack/react-query";
import { getRecurringCleaningPlanHistory } from "../services/recurring-maintenance.service";
import type { RecurringCleaningHistoryQuery } from "../types/recurring-maintenance.types";
import { RECURRING_PLANS_QUERY_KEY } from "./useRecurringPlans";

export const RECURRING_CLEANING_HISTORY_QUERY_KEY = [
  ...RECURRING_PLANS_QUERY_KEY,
  "cleaning-history",
];

export const useRecurringCleaningHistory = (
  planId: string,
  params: RecurringCleaningHistoryQuery,
  enabled = true,
) =>
  useQuery({
    queryKey: [...RECURRING_CLEANING_HISTORY_QUERY_KEY, planId, params],
    queryFn: () => getRecurringCleaningPlanHistory(planId, params),
    enabled: Boolean(planId) && enabled,
  });
