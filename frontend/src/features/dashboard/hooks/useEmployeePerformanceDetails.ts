import { useQuery } from "@tanstack/react-query";
import { getEmployeePerformanceDetails } from "@/services/dashboard.service";
import type { JobPerformancePeriod } from "@/features/jobs/types/job.types";

export const useEmployeePerformanceDetails = (
  employeeDocumentId: string | null,
  period: JobPerformancePeriod,
) => {
  return useQuery({
    queryKey: [
      "dashboard-employee-performance-details",
      employeeDocumentId,
      period,
    ],
    queryFn: () => {
      if (!employeeDocumentId) {
        throw new Error("Select an employee to load performance details.");
      }
      return getEmployeePerformanceDetails(employeeDocumentId, period);
    },
    enabled: Boolean(employeeDocumentId),
  });
};
