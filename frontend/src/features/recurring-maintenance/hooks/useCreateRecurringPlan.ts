import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRecurringPlan } from "../services/recurring-maintenance.service";
import { RECURRING_PLANS_QUERY_KEY } from "./useRecurringPlans";
import type {
  CreateRecurringMaintenancePlanData,
  RecurringMaintenancePlan,
} from "../types/recurring-maintenance.types";

export const useCreateRecurringPlan = () => {
  const queryClient = useQueryClient();

  return useMutation<
    RecurringMaintenancePlan,
    Error,
    CreateRecurringMaintenancePlanData
  >({
    mutationFn: createRecurringPlan,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: RECURRING_PLANS_QUERY_KEY }),
  });
};
