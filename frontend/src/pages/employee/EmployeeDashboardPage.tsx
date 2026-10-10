import { useState } from "react";
import { isAxiosError } from "axios";
import {
  Activity,
  BriefcaseBusiness,
  ClipboardList,
  Clock3,
  FileCheck2,
  CalendarClock,
  UserRound,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useMyAMC } from "@/features/amc/hooks/useMyAMC";
import { useMyEmployeeProfile } from "@/features/employees/hooks/useMyEmployeeProfile";
import { useMyJobPerformance } from "@/features/jobs/hooks/useMyJobPerformance";
import { useMyJobs } from "@/features/jobs/hooks/useMyJobs";
import type { AMCStatus } from "@/services/amc.service";
import type {
  JobPerformancePeriod,
  JobStatus,
} from "@/features/jobs/types/job.types";

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

const PERIODS: Array<{ value: JobPerformancePeriod; label: string }> = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

const AMC_STATUSES: Array<{ value: AMCStatus; label: string }> = [
  { value: "COMPLETED", label: "Completed" },
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "OVERDUE", label: "Overdue" },
];

function formatStatus(status: JobStatus) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDuration(hours: number | null | undefined) {
  if (hours == null || !Number.isFinite(hours)) return "Not available";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toLocaleString(undefined, { maximumFractionDigits: 2 })} hr`;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function QueryError({
  title,
  message,
  retry,
  isFetching,
}: {
  title: string;
  message: string;
  retry: () => void;
  isFetching: boolean;
}) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <p className="font-medium text-destructive">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={retry}
        disabled={isFetching}
      >
        {isFetching ? "Retrying..." : "Retry"}
      </Button>
    </div>
  );
}

function EmployeeDashboardPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<JobPerformancePeriod>("month");
  const now = new Date();
  const [amcMonth, setAmcMonth] = useState(now.getMonth() + 1);
  const [amcYear, setAmcYear] = useState(now.getFullYear());
  const profileQuery = useMyEmployeeProfile();
  const jobsQuery = useMyJobs({ page: 1, limit: 1 });
  const performanceQuery = useMyJobPerformance(period);
  const amcQuery = useMyAMC(amcMonth, amcYear);

  const profile = profileQuery.data;
  const employeeName = [profile?.user?.firstName, profile?.user?.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <UserRound className="size-6 text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight">
              Employee Dashboard
            </h1>
          </div>
          {profileQuery.isLoading ? (
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              Loading your profile...
            </p>
          ) : profileQuery.isError ? (
            <div className="mt-3 max-w-xl">
              <QueryError
                title="Could not load your profile."
                message={getErrorMessage(
                  profileQuery.error,
                  "Please try again.",
                )}
                retry={() => void profileQuery.refetch()}
                isFetching={profileQuery.isFetching}
              />
            </div>
          ) : profile ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {employeeName && (
                <p className="text-sm text-muted-foreground">
                  Welcome, {employeeName}
                </p>
              )}
              {profile.employeeCode && (
                <Badge variant="outline">
                  Employee code: {profile.employeeCode}
                </Badge>
              )}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => navigate("/employee/attendance")}
        >
          <CalendarClock aria-hidden="true" />
          My Attendance
        </Button>
        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={() => navigate("/employee/jobs")}
        >
          <ClipboardList aria-hidden="true" />
          My Jobs
        </Button>
      </header>

      <section aria-labelledby="assigned-jobs-heading">
        <div className="mb-3 flex items-center gap-2">
          <BriefcaseBusiness
            className="size-5 text-primary"
            aria-hidden="true"
          />
          <h2 id="assigned-jobs-heading" className="text-lg font-semibold">
            Currently Assigned Jobs
          </h2>
        </div>

        {jobsQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="status">
            <p className="text-sm text-muted-foreground">
              Loading assigned jobs...
            </p>
          </div>
        ) : jobsQuery.isError ? (
          <QueryError
            title="Could not load your assigned jobs."
            message={getErrorMessage(jobsQuery.error, "Please try again.")}
            retry={() => void jobsQuery.refetch()}
            isFetching={jobsQuery.isFetching}
          />
        ) : jobsQuery.data ? (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total currently assigned
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">
                  {jobsQuery.data.pagination.total}
                </p>
              </CardContent>
            </Card>

            {jobsQuery.data.pagination.total === 0 ? (
              <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
                No jobs are currently assigned to you.
              </div>
            ) : (
              <div
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                aria-label="Currently assigned jobs by status"
              >
                {JOB_STATUSES.map((status) => {
                  const count = jobsQuery.data.statusCounts[status];
                  return (
                    <Card key={status}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          {formatStatus(status)}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-semibold">
                          {count ?? 0}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            Assigned-job information is not available.
          </p>
        )}
      </section>

      <section aria-labelledby="performance-heading">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="size-5 text-primary" aria-hidden="true" />
              <h2 id="performance-heading" className="text-lg font-semibold">
                Job Performance
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Completion submissions are events; rework may count more than
              once.
            </p>
          </div>
          <div className="w-full sm:w-48">
            <label
              htmlFor="performance-period"
              className="mb-1 block text-sm font-medium"
            >
              Performance period
            </label>
            <select
              id="performance-period"
              value={period}
              onChange={(event) =>
                setPeriod(event.target.value as JobPerformancePeriod)
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {PERIODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {performanceQuery.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2" role="status">
            <p className="text-sm text-muted-foreground">
              Loading job performance...
            </p>
          </div>
        ) : performanceQuery.isError ? (
          <QueryError
            title="Could not load job performance."
            message={getErrorMessage(
              performanceQuery.error,
              "Please try again.",
            )}
            retry={() => void performanceQuery.refetch()}
            isFetching={performanceQuery.isFetching}
          />
        ) : performanceQuery.data ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Activity className="size-4" aria-hidden="true" />
                  Completion events
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">
                  {performanceQuery.data.completion.completedEventCount}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {performanceQuery.data.completion.range.fromDate} –{" "}
                  {performanceQuery.data.completion.range.toDate} (
                  {performanceQuery.data.completion.range.timezone})
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Clock3 className="size-4" aria-hidden="true" />
                  Average current-attempt duration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">
                  {formatDuration(
                    performanceQuery.data
                      .averageCurrentAttemptCompletionHours,
                  )}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Based on{" "}
                  {performanceQuery.data.averageCurrentAttemptJobCount}{" "}
                  currently assigned completed job(s) with valid timestamps.
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            Performance information is not available.
          </p>
        )}
      </section>

      <section aria-labelledby="amc-progress-heading">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FileCheck2 className="size-5 text-primary" aria-hidden="true" />
              <h2 id="amc-progress-heading" className="text-lg font-semibold">
                AMC Progress
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Monthly AMC records assigned to you.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
            <div>
              <label
                htmlFor="amc-month"
                className="mb-1 block text-sm font-medium"
              >
                Month
              </label>
              <select
                id="amc-month"
                value={amcMonth}
                onChange={(event) => setAmcMonth(Number(event.target.value))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {Array.from({ length: 12 }, (_, index) => {
                  const month = index + 1;
                  return (
                    <option key={month} value={month}>
                      {new Date(2000, index, 1).toLocaleString(undefined, {
                        month: "long",
                      })}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label
                htmlFor="amc-year"
                className="mb-1 block text-sm font-medium"
              >
                Year
              </label>
              <select
                id="amc-year"
                value={amcYear}
                onChange={(event) => setAmcYear(Number(event.target.value))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {Array.from({ length: 6 }, (_, index) => {
                  const year = now.getFullYear() - index;
                  return (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        </div>

        {amcQuery.isLoading ? (
          <div className="rounded-lg border p-5 text-sm text-muted-foreground" role="status">
            Loading AMC progress...
          </div>
        ) : amcQuery.isError ? (
          <QueryError
            title="Could not load your AMC progress."
            message={getErrorMessage(amcQuery.error, "Please try again.")}
            retry={() => void amcQuery.refetch()}
            isFetching={amcQuery.isFetching}
          />
        ) : amcQuery.data ? (
          amcQuery.data.pagination.total === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="font-medium">No AMC records for this period.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                There are no monthly AMC visits assigned to you for{" "}
                {new Date(amcYear, amcMonth - 1, 1).toLocaleString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
                .
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {AMC_STATUSES.map(({ value, label }) => (
                  <Card key={value}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        {label}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-semibold">
                        {amcQuery.data.statusCounts[value] ?? 0}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Monthly completion
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {(
                      ((amcQuery.data.statusCounts.COMPLETED ?? 0) /
                        amcQuery.data.pagination.total) *
                      100
                    ).toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                    })}
                    %
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {amcQuery.data.statusCounts.COMPLETED ?? 0} completed of{" "}
                    {amcQuery.data.pagination.total} assigned AMC record(s)
                  </p>
                </CardContent>
              </Card>
            </div>
          )
        ) : (
          <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            AMC progress is not available.
          </p>
        )}
      </section>
    </main>
  );
}

export default EmployeeDashboardPage;
