import { useState } from "react";
import { isAxiosError } from "axios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useEmployeePerformanceDetails } from "@/features/dashboard/hooks/useEmployeePerformanceDetails";
import { useEmployeePerformance } from "@/features/dashboard/hooks/useEmployeePerformance";
import { useEmployees } from "@/features/employees/hooks/useEmployees";
import type { JobPerformancePeriod, JobStatus } from "@/features/jobs/types/job.types";

const JOB_STATUSES: JobStatus[] = [
  "PENDING",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "VERIFIED",
  "APPROVED",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
];

const PERFORMANCE_PERIODS: Array<{
  value: JobPerformancePeriod;
  label: string;
}> = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

function formatStatus(status: JobStatus) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDuration(hours: number | null) {
  if (hours === null || !Number.isFinite(hours)) return "Not available";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toLocaleString(undefined, { maximumFractionDigits: 2 })} hr`;
}

function errorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Please try again.";
  }
  return error instanceof Error ? error.message : "Please try again.";
}

export default function EmployeePerformance() {
  const { data, isLoading, error } = useEmployeePerformance();
  const employeesQuery = useEmployees();
  const [selectedEmployeeDocumentId, setSelectedEmployeeDocumentId] = useState<
    string | null
  >(null);
  const [period, setPeriod] = useState<JobPerformancePeriod>("month");
  const detailsQuery = useEmployeePerformanceDetails(
    selectedEmployeeDocumentId,
    period,
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Employee Performance</h2>

        <div className="mt-5 h-48 animate-pulse rounded-lg bg-gray-100" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Employee Performance</h2>

        <p className="mt-4 text-sm text-red-500">
          Failed to load employee performance.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-5">
        <h2 className="font-semibold">Employee Performance</h2>

        <p className="mt-1 text-sm text-gray-500">
          Leaderboard for jobs created this month, grouped by current assignee
          and status. Completion is a current-status rate, not a completion-event
          rate.
        </p>
      </div>

      <div className="mb-5 max-w-md">
        <label
          htmlFor="individual-employee"
          className="mb-1 block text-sm font-medium"
        >
          Select employee for individual performance
        </label>
        <select
          id="individual-employee"
          value={selectedEmployeeDocumentId ?? ""}
          onChange={(event) =>
            setSelectedEmployeeDocumentId(event.target.value || null)
          }
          disabled={employeesQuery.isLoading || employeesQuery.isError}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">
            {employeesQuery.isLoading
              ? "Loading employees..."
              : "Choose an employee"}
          </option>
          {employeesQuery.data?.map((employee) => (
            <option key={employee._id} value={employee._id}>
              {[
                [employee.userId?.firstName, employee.userId?.lastName]
                  .filter(Boolean)
                  .join(" ") || "Name unavailable",
                employee.employeeCode,
              ]
                .filter(Boolean)
                .join(" — ")}
            </option>
          ))}
        </select>
      </div>

      {data.performance.length === 0 ? (
        <p className="text-sm text-gray-500">
          No employee performance data available.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-3 font-medium">Employee</th>

                <th className="pb-3 font-medium">Jobs</th>

                <th className="pb-3 font-medium">Completed</th>

                <th className="pb-3 font-medium">Approved</th>

                <th className="pb-3 font-medium">Rejected</th>

                <th className="pb-3 font-medium">Current-status rate</th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {data.performance.map((employee) => (
                <tr key={employee.employeeId}>
                  <td className="py-4">
                    <div>
                      <p className="font-medium">{employee.name}</p>

                      {employee.employeeCode && (
                        <p className="text-xs text-gray-500">
                          {employee.employeeCode}
                        </p>
                      )}
                    </div>
                  </td>

                  <td className="py-4">{employee.totalJobs}</td>

                  <td className="py-4">{employee.completedJobs}</td>

                  <td className="py-4">{employee.approvedJobs}</td>

                  <td className="py-4">{employee.rejectedJobs}</td>

                  <td className="py-4 font-medium">
                    {employee.completionRate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {employeesQuery.isError && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          Employee records could not be loaded. Individual details are
          unavailable.
        </p>
      )}

      {selectedEmployeeDocumentId && (
        <section
          className="mt-6 border-t pt-5"
          aria-labelledby="individual-performance-title"
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3
                id="individual-performance-title"
                className="text-lg font-semibold"
              >
                Individual Employee Performance
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Completion submissions are events; rework may count more than
                once.
              </p>
            </div>
            <div>
              <label
                htmlFor="individual-performance-period"
                className="mb-1 block text-sm font-medium"
              >
                Completion event period
              </label>
              <select
                id="individual-performance-period"
                value={period}
                onChange={(event) =>
                  setPeriod(event.target.value as JobPerformancePeriod)
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-48"
              >
                {PERFORMANCE_PERIODS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {detailsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading individual performance...
            </p>
          ) : detailsQuery.isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm text-destructive" role="alert">
                Could not load individual performance.{" "}
                {errorMessage(detailsQuery.error)}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void detailsQuery.refetch()}
                disabled={detailsQuery.isFetching}
              >
                {detailsQuery.isFetching ? "Retrying..." : "Retry"}
              </Button>
            </div>
          ) : detailsQuery.data ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{detailsQuery.data.employee.name}</p>
                <Badge variant="outline">
                  Employee code: {detailsQuery.data.employee.employeeCode}
                </Badge>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">
                  Currently assigned jobs:{" "}
                  {detailsQuery.data.currentAssignedJobs.total}
                </p>
                {detailsQuery.data.currentAssignedJobs.total === 0 ? (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    No jobs are currently assigned to this employee.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {JOB_STATUSES.map((status) => (
                      <Card key={status}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">
                            {formatStatus(status)}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-xl font-semibold">
                            {detailsQuery.data.currentAssignedJobs.byStatus[
                              status
                            ] ?? 0}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Completion submission events
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold">
                      {detailsQuery.data.completion.completedEventCount}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {detailsQuery.data.completion.range.fromDate} –{" "}
                      {detailsQuery.data.completion.range.toDate} (
                      {detailsQuery.data.completion.range.timezone})
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Average current-attempt duration
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold">
                      {formatDuration(
                        detailsQuery.data
                          .averageCurrentAttemptCompletionHours,
                      )}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      From{" "}
                      {detailsQuery.data.averageCurrentAttemptJobCount}{" "}
                      currently assigned qualifying job(s); not a historical
                      average.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Individual performance is not available.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
