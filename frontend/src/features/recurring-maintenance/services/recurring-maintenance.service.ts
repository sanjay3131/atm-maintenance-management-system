import api from "@/lib/axios";
import type {
  CleaningMonitoringRecord,
  RecurringCleaningExportQuery,
  RecurringCleaningHistoryQuery,
  RecurringCleaningPlanHistory,
  CreateRecurringMaintenancePlanData,
  RecurringMaintenancePlan,
  UpdateRecurringMaintenancePlanData,
} from "../types/recurring-maintenance.types";

export const getCleaningMonitoring = async (): Promise<
  CleaningMonitoringRecord[]
> => {
  const response = await api.get<{ data: CleaningMonitoringRecord[] }>(
    "/jobs/recurring/monitoring",
  );
  return response.data.data;
};

export const downloadRecurringCleaningExport = async (
  params: RecurringCleaningExportQuery,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> => {
  const fallbackFilename =
    `recurring-cleaning-${params.fromDate}-to-${params.toDate}.xlsx`;
  const response = await api.get<Blob>(
    "/jobs/recurring/cleaning-export.xlsx",
    {
      params,
      responseType: "blob",
      signal,
    },
  );
  const disposition = response.headers["content-disposition"] ?? "";
  const filenameMatch = disposition.match(
    /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i,
  );
  const extractedFilename =
    (filenameMatch?.[1] ?? filenameMatch?.[2])?.trim();
  const isValidFilename = (value: string | undefined): value is string => {
    if (!value || value.length > 255) return false;
    if ([...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ||
        character === "/" || character === "\\";
    })) return false;
    const match =
      /^recurring-cleaning-(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})\.xlsx$/.exec(
        value,
      );
    if (!match) return false;
    return [match[1], match[2]].every((date) => {
      const parsed = new Date(`${date}T00:00:00.000Z`);
      return (
        Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === date
      );
    });
  };

  return {
    blob: response.data,
    filename: isValidFilename(extractedFilename)
      ? extractedFilename
      : fallbackFilename,
  };
};

export const getRecurringPlans = async (): Promise<
  RecurringMaintenancePlan[]
> => {
  const response = await api.get<{ data: RecurringMaintenancePlan[] }>(
    "/jobs/recurring/plans",
  );
  return response.data.data;
};

export const getRecurringCleaningPlanHistory = async (
  planId: string,
  params: RecurringCleaningHistoryQuery,
): Promise<RecurringCleaningPlanHistory> => {
  const response = await api.get<{ data: RecurringCleaningPlanHistory }>(
    `/jobs/recurring/plans/${encodeURIComponent(planId)}/cleaning-history`,
    { params },
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
