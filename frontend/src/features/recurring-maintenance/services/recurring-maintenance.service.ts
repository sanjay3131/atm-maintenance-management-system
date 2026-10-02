import api from "@/lib/axios";
import type {
  CreateRecurringMaintenancePlanData,
  RecurringMaintenancePlan,
  UpdateRecurringMaintenancePlanData,
} from "../types/recurring-maintenance.types";

export const getRecurringPlans = async (): Promise<
  RecurringMaintenancePlan[]
> => {
  const response = await api.get<{ data: RecurringMaintenancePlan[] }>(
    "/jobs/recurring/plans",
  );
  return response.data.data;
};

export const createRecurringPlan = async (
  data: CreateRecurringMaintenancePlanData,
): Promise<RecurringMaintenancePlan> => {
  const response = await api.post<{ data: RecurringMaintenancePlan }>(
    "/jobs/recurring/plans",
    data,
  );
  return response.data.data;
};

export const updateRecurringPlan = async (
  planId: string,
  data: UpdateRecurringMaintenancePlanData,
): Promise<RecurringMaintenancePlan> => {
  const response = await api.patch<{ data: RecurringMaintenancePlan }>(
    `/jobs/recurring/plans/${planId}`,
    data,
  );
  return response.data.data;
};
