import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateRecurringPlan } from "../services/recurring-maintenance.service";
import { RECURRING_PLANS_QUERY_KEY } from "./useRecurringPlans";
import type {
  RecurringMaintenancePlan,
  UpdateRecurringMaintenancePlanData,
} from "../types/recurring-maintenance.types";

interface UpdateRecurringPlanVariables {
  planId: string;
  data: UpdateRecurringMaintenancePlanData;
}

export const useUpdateRecurringPlan = () => {
  const queryClient = useQueryClient();

  return useMutation<
    RecurringMaintenancePlan,
    Error,
    UpdateRecurringPlanVariables
  >({
    mutationFn: ({ planId, data }) => updateRecurringPlan(planId, data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: RECURRING_PLANS_QUERY_KEY }),
  });
};
