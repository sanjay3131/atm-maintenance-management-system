import { useQuery } from "@tanstack/react-query";
import { getRecurringPlans } from "../services/recurring-maintenance.service";

export const RECURRING_PLANS_QUERY_KEY = ["recurring-maintenance-plans"];

export const useRecurringPlans = () =>
  useQuery({
    queryKey: RECURRING_PLANS_QUERY_KEY,
    queryFn: getRecurringPlans,
  });
