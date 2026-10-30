import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import {
  ClipboardList,
  CalendarClock,
} from "lucide-react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SkeletonBlock } from "@/features/dashboard/components/DashboardSkeleton";
import { useMyAMC } from "@/features/amc/hooks/useMyAMC";
import { useMyEmployeeProfile } from "@/features/employees/hooks/useMyEmployeeProfile";
import { useMyJobPerformance } from "@/features/jobs/hooks/useMyJobPerformance";
import type { AMCStatus } from "@/services/amc.service";
import type { JobPerformancePeriod } from "@/features/jobs/types/job.types";
import {
  employeeErrorMessage,
  employeeJobStatusLabel,
  employeeLanguageClasses,
  useEmployeeLanguage,
  type EmployeeTranslationKey,
} from "@/features/employee-portal/i18n";
import {
  EMPLOYEE_JOB_STATUSES,
  getEmployeeJobsStatusHref,
} from "@/features/jobs/utils/employeeJobs.utils";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const PERIODS: Array<{
  value: JobPerformancePeriod;
  label: EmployeeTranslationKey;
}> = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

const AMC_STATUSES: Array<{
  value: AMCStatus;
  label: EmployeeTranslationKey;
}> = [
  { value: "COMPLETED", label: "Completed" },
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "OVERDUE", label: "Overdue" },
];

function formatDuration(
  hours: number | null | undefined,
  language: "ta" | "en",
) {
  if (hours == null || !Number.isFinite(hours)) return "—";
  if (hours < 1) {
    return `${Math.round(hours * 60)} ${language === "ta" ? "நிமி." : "min"}`;
  }
  return `${hours.toLocaleString(language === "ta" ? "ta-IN" : "en-IN", {
    maximumFractionDigits: 2,
  })} ${language === "ta" ? "மணி" : "hr"}`;
}

function getErrorMessage(
  error: unknown,
  fallback: string,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
  language: "ta" | "en",
) {
  if (isAxiosError<{ message?: string }>(error)) {
    return employeeErrorMessage(
      error.response?.data?.message || fallback,
      "Please try again.",
      language,
      t,
    );
  }
  return error instanceof Error
    ? employeeErrorMessage(error.message, "Please try again.", language, t)
    : fallback;
}

function QueryError({
  title,
  message,
  retry,
  isFetching,
  t,
}: {
  title: string;
  message: string;
  retry: () => void;
  isFetching: boolean;
  t: ReturnType<typeof useEmployeeLanguage>["t"];
}) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <p className="font-medium text-destructive">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 min-h-11"
        onClick={retry}
        disabled={isFetching}
      >
        {isFetching ? t("Retrying...") : t("Retry")}
      </Button>
    </div>
  );
}

function EmployeeDashboardPage() {
  const navigate = useNavigate();
  const { t, language } = useEmployeeLanguage();
  const [period, setPeriod] = useState<JobPerformancePeriod>("month");
  const now = new Date();
  const [amcMonth, setAmcMonth] = useState(now.getMonth() + 1);
  const [amcYear, setAmcYear] = useState(now.getFullYear());
  const profileQuery = useMyEmployeeProfile();
  const performanceQuery = useMyJobPerformance(period);
  const amcQuery = useMyAMC(amcMonth, amcYear);
  const statusCounts = performanceQuery.data?.currentAssignedJobs.byStatus;
  const totalAssignedCount = Math.max(
    0,
    (performanceQuery.data?.currentAssignedJobs.total ?? 0) -
      (statusCounts?.CANCELLED ?? 0),
  );
  const eligibleAssignedCount =
    performanceQuery.data?.eligibleAssignedJobCount ?? 0;
  const completedEligibleCount = performanceQuery.data?.completedJobCount ?? 0;
  const completionPercent =
    eligibleAssignedCount > 0
      ? (completedEligibleCount / eligibleAssignedCount) * 100
      : 0;
  const displayedCompletionPercent = Math.round(
    Math.min(100, Math.max(0, completionPercent)),
  );
  const numberLocale = language === "ta" ? "ta-IN" : "en-IN";
  const activityDays = performanceQuery.data?.lastSevenDays.days;
  const chartDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(numberLocale, {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Kolkata",
      }),
    [numberLocale],
  );
  const chartData = useMemo(
    () => ({
      labels: (activityDays ?? []).map((day) =>
        chartDateFormatter.format(new Date(`${day.date}T12:00:00+05:30`)),
      ),
      datasets: [
        {
          label: t("Assigned jobs"),
          data: (activityDays ?? []).map((day) => day.assigned),
          backgroundColor: "#2563EB",
          borderRadius: 5,
          maxBarThickness: 28,
        },
        {
          label: t("Completed job count"),
          data: (activityDays ?? []).map((day) => day.completed),
          backgroundColor: "#0D9488",
          borderRadius: 5,
          maxBarThickness: 28,
        },
      ],
    }),
    [activityDays, chartDateFormatter, t],
  );
  const employeeTheme = document.querySelector(".employee-portal-shell");
  const chartTheme = getComputedStyle(
    employeeTheme ?? document.documentElement,
  );
  const chartForeground = chartTheme.getPropertyValue("--foreground").trim();
  const chartMutedForeground = chartTheme
    .getPropertyValue("--muted-foreground")
    .trim();
  const chartBorder = chartTheme.getPropertyValue("--border").trim();
  const hasWeeklyActivity = (activityDays ?? []).some(
    ({ assigned, completed }) => assigned > 0 || completed > 0,
  );

  const profile = profileQuery.data;
  const employeeName = [profile?.user?.firstName, profile?.user?.lastName]
    .filter(Boolean)
    .join(" ");
  return (
    <main
      className={`min-w-0 ${employeeLanguageClasses(
        language,
        "space-y-6",
        "space-y-5",
      )}`}
    >
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="min-w-0">
            <h1
              className={`min-w-0 break-words text-xl font-semibold tracking-tight sm:text-2xl ${employeeLanguageClasses(language, "", "leading-7")}`}
            >
              {employeeName
                ? t("Welcome, {name}", { name: employeeName })
                : t("Employee portal")}
            </h1>
          </div>
          {profileQuery.isLoading ? (
            <p className="mt-1 text-sm text-muted-foreground" role="status">
              {t("Loading your profile...")}
            </p>
          ) : profileQuery.isError ? (
            <div className="mt-3 max-w-xl">
              <QueryError
                title={t("Could not load your profile.")}
                message={getErrorMessage(
                  profileQuery.error,
                  t("Please try again."),
                  t,
                  language,
                )}
                retry={() => void profileQuery.refetch()}
                isFetching={profileQuery.isFetching}
                t={t}
              />
            </div>
          ) : profile ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {profile.employeeCode && (
                <p className="break-words text-sm text-muted-foreground">
                  {t("Employee code: {code}", { code: profile.employeeCode })}
                </p>
              )}
            </div>
          ) : null}
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex">
          <Button
            type="button"
            className={`min-h-11 w-full whitespace-normal px-2 leading-5 sm:w-auto sm:px-4 ${employeeLanguageClasses(language, "", "h-auto py-2")}`}
            onClick={() => navigate("/employee/jobs")}
          >
            <ClipboardList aria-hidden="true" className="hidden sm:inline" />
            {t("My Jobs")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={`min-h-11 w-full whitespace-normal px-2 leading-5 sm:w-auto sm:px-4 ${employeeLanguageClasses(language, "", "h-auto py-2")}`}
            onClick={() => navigate("/employee/attendance")}
          >
            <CalendarClock aria-hidden="true" className="hidden sm:inline" />
            {t("My Attendance")}
          </Button>
        </div>
      </header>

      <section aria-labelledby="assigned-jobs-heading">
        <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
          <h2
            id="assigned-jobs-heading"
            className="min-w-0 break-words text-base font-semibold leading-6"
          >
            {t("Currently Assigned Jobs")}
          </h2>
        </div>

        {performanceQuery.isLoading ? (
          <div className="rounded-lg border bg-card px-4" role="status">
            <SkeletonBlock className="my-4 h-10 w-full" />
            <div className="grid grid-cols-2 gap-x-5 border-t py-2 xl:grid-cols-3">
              {Array.from(
                { length: EMPLOYEE_JOB_STATUSES.length },
                (_, index) => (
                  <SkeletonBlock
                    key={index}
                    className="my-1 h-9 w-full"
                  />
                ),
              )}
            </div>
            <span className="sr-only">{t("Loading assigned jobs...")}</span>
          </div>
        ) : performanceQuery.isError ? (
          <QueryError
            title={t("Could not load your assigned jobs.")}
            message={getErrorMessage(
              performanceQuery.error,
              t("Please try again."),
              t,
              language,
            )}
            retry={() => void performanceQuery.refetch()}
            isFetching={performanceQuery.isFetching}
            t={t}
          />
        ) : performanceQuery.data ? (
          <div className="overflow-hidden rounded-lg border bg-card">
            <button
              type="button"
              aria-label={t("View all assigned jobs")}
              onClick={() => navigate(getEmployeeJobsStatusHref())}
              className="group flex min-h-16 w-full min-w-0 items-center justify-between gap-4 px-4 py-3 text-left transition-colors motion-reduce:transition-none hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <span className="min-w-0 break-words text-sm font-medium leading-5">
                {t("Total currently assigned")}
              </span>
              <span className="shrink-0 text-2xl font-semibold tabular-nums tracking-tight">
                {totalAssignedCount.toLocaleString(numberLocale)}
              </span>
            </button>

            <div className="grid grid-cols-2 gap-x-5 border-t px-4 py-1 xl:grid-cols-3">
              {EMPLOYEE_JOB_STATUSES.map((status) => {
                const statusLabel = employeeJobStatusLabel(status, t);
                const statusVariant =
                  status === "REJECTED" || status === "CANCELLED"
                    ? "destructive"
                    : status === "PENDING" || status === "ON_HOLD"
                      ? "secondary"
                      : status === "CLOSED"
                        ? "outline"
                        : "default";
                const statusDot =
                  statusVariant === "destructive"
                    ? "bg-destructive"
                    : statusVariant === "secondary"
                      ? "bg-amber-500 dark:bg-amber-400"
                      : statusVariant === "outline"
                        ? "bg-muted-foreground/50"
                        : "bg-primary";

                return (
                  <button
                    key={status}
                    type="button"
                    aria-label={t("View jobs with status: {status}", {
                      status: statusLabel,
                    })}
                    onClick={() =>
                      navigate(getEmployeeJobsStatusHref(status))
                    }
                    className="flex min-h-11 min-w-0 items-center justify-between gap-2 border-b border-border/70 py-2 text-left transition-colors motion-reduce:transition-none hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <span className="flex min-w-0 flex-1 items-start gap-2">
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${statusDot}`}
                      />
                      <span className="min-w-0 break-words text-sm leading-5">
                        {statusLabel}
                      </span>
                    </span>
                    <span className="min-w-5 shrink-0 text-right text-sm font-semibold tabular-nums">
                      {statusCounts?.[status]?.toLocaleString(numberLocale) ??
                        "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
            {t("Assigned-job information is not available.")}
          </p>
        )}
      </section>

      <section
        aria-labelledby="completion-progress-heading"
        className="grid min-w-0 gap-5 border-b pb-5 xl:grid-cols-5"
      >
        <div className="min-w-0 xl:col-span-2">
          <h2
            id="completion-progress-heading"
            className="text-base font-semibold"
          >
            {t("Completion progress")}
          </h2>
          <div className="mt-3">
            {performanceQuery.isLoading ? (
              <div className="space-y-3" role="status">
                <SkeletonBlock className="h-8 w-24" />
                <SkeletonBlock className="h-2.5 w-full rounded-full" />
                <SkeletonBlock className="h-4 w-3/4" />
                <span className="sr-only">
                  {t("Loading job performance...")}
                </span>
              </div>
            ) : performanceQuery.isError ? (
              <p className="text-sm text-muted-foreground" role="alert">
                {t("Performance information is not available.")}
              </p>
            ) : performanceQuery.data ? (
              <>
                <p className="text-3xl font-semibold tabular-nums tracking-tight">
                  {t("{percent}% completed", {
                    percent:
                      displayedCompletionPercent.toLocaleString(numberLocale),
                  })}
                </p>
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {t("{completed} of {eligible} eligible jobs completed", {
                    completed:
                      completedEligibleCount.toLocaleString(numberLocale),
                    eligible: eligibleAssignedCount.toLocaleString(numberLocale),
                  })}
                </p>
                <div
                  className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label={t("Completion progress")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={displayedCompletionPercent}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                    style={{ width: `${displayedCompletionPercent}%` }}
                  />
                </div>
                {eligibleAssignedCount === 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("No eligible assigned jobs yet.")}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("Performance information is not available.")}
              </p>
            )}
          </div>
        </div>

        <div className="min-w-0 border-t pt-4 xl:col-span-3 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <h3 className="text-base font-semibold">
            {t("Assigned vs completed")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Last seven days in Asia/Kolkata")}
          </p>
          <div className="mt-2 min-w-0">
            {performanceQuery.isLoading ? (
              <SkeletonBlock className="h-52 w-full" />
            ) : performanceQuery.isError ? (
              <p className="py-4 text-sm text-muted-foreground">
                {t("Performance information is not available.")}
              </p>
            ) : performanceQuery.data ? (
              <>
                {!hasWeeklyActivity && (
                  <p className="mb-2 text-sm text-muted-foreground">
                    {t("No job activity in the last seven days.")}
                  </p>
                )}
                <div
                  className="relative h-52 min-h-0 w-full min-w-0 sm:h-56"
                  role="img"
                  aria-label={t(
                    "Assigned and completed jobs for the last seven days",
                  )}
                  aria-describedby="employee-weekly-chart-data"
                >
                  <Bar
                    data={chartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      interaction: { mode: "index", intersect: false },
                      plugins: {
                        legend: {
                          position: "bottom",
                          labels: {
                            color: chartForeground,
                            usePointStyle: true,
                            boxWidth: 8,
                            padding: 8,
                            font: { size: 12 },
                          },
                        },
                        tooltip: {
                          callbacks: {
                            title: (items) => {
                              const day =
                                activityDays?.[items[0]?.dataIndex ?? -1];
                              return day
                                ? new Intl.DateTimeFormat(numberLocale, {
                                    dateStyle: "medium",
                                    timeZone: "Asia/Kolkata",
                                  }).format(
                                    new Date(`${day.date}T12:00:00+05:30`),
                                  )
                                : "";
                            },
                          },
                        },
                      },
                      scales: {
                        x: {
                          grid: { display: false },
                          border: { display: false },
                          ticks: {
                            color: chartMutedForeground,
                            autoSkip: true,
                            maxTicksLimit: 4,
                            maxRotation: 0,
                            minRotation: 0,
                            font: { size: 12 },
                          },
                        },
                        y: {
                          beginAtZero: true,
                          grid: { color: chartBorder, drawTicks: false },
                          border: { display: false },
                          ticks: {
                            color: chartMutedForeground,
                            precision: 0,
                            stepSize: 1,
                          },
                        },
                      },
                    }}
                  />
                </div>
                <ul id="employee-weekly-chart-data" className="sr-only">
                  {(activityDays ?? []).map((day) => (
                    <li key={day.date}>
                      {day.date}: {t("Assigned jobs")} {day.assigned},{" "}
                      {t("Completed job count")} {day.completed}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                {t("Performance information is not available.")}
              </p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="performance-heading">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 id="performance-heading" className="text-base font-semibold">
              {t("Job Performance")}
            </h2>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {t(
                "Completion submissions are events; rework may count more than once.",
              )}
            </p>
          </div>
          <div className="w-full sm:w-44 sm:shrink-0">
            <label
              htmlFor="performance-period"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              {t("Performance period")}
            </label>
            <select
              id="performance-period"
              value={period}
              onChange={(event) =>
                setPeriod(event.target.value as JobPerformancePeriod)
              }
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {PERIODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {performanceQuery.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2" role="status">
            <p className="text-sm text-muted-foreground">
              {t("Loading job performance...")}
            </p>
          </div>
        ) : performanceQuery.isError ? (
          <QueryError
            title={t("Could not load job performance.")}
            message={getErrorMessage(
              performanceQuery.error,
              t("Please try again."),
              t,
              language,
            )}
            retry={() => void performanceQuery.refetch()}
            isFetching={performanceQuery.isFetching}
            t={t}
          />
        ) : performanceQuery.data ? (
          <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 sm:gap-0 sm:p-0">
            <div className="min-w-0 border-b pb-4 sm:border-b-0 sm:py-4 sm:pr-5">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("Completion events")}
                </p>
                <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
                  {performanceQuery.data.completion.completedEventCount}
                </p>
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {performanceQuery.data.completion.range.fromDate} –{" "}
                  {performanceQuery.data.completion.range.toDate} (
                  {performanceQuery.data.completion.range.timezone})
                </p>
              </div>
            </div>

            <div className="min-w-0 sm:border-l sm:border-border/70 sm:py-4 sm:pl-5">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("Average current-attempt duration")}
                </p>
                <p className="mt-2 break-words text-3xl font-semibold tabular-nums tracking-tight">
                  {formatDuration(
                    performanceQuery.data.averageCurrentAttemptCompletionHours,
                    language,
                  )}
                </p>
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {t(
                    "Based on {count} currently assigned completed job(s) with valid timestamps.",
                    {
                      count:
                        performanceQuery.data.averageCurrentAttemptJobCount,
                    },
                  )}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
            {t("Performance information is not available.")}
          </p>
        )}
      </section>

      <section aria-labelledby="amc-progress-heading">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 id="amc-progress-heading" className="text-base font-semibold">
              {t("AMC Progress")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Monthly AMC records assigned to you.")}
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:items-end lg:gap-3">
            <div>
              <label
                htmlFor="amc-month"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                {t("Month")}
              </label>
              <select
                id="amc-month"
                value={amcMonth}
                onChange={(event) => setAmcMonth(Number(event.target.value))}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 lg:w-32"
              >
                {Array.from({ length: 12 }, (_, index) => {
                  const month = index + 1;
                  return (
                    <option key={month} value={month}>
                      {new Date(2000, index, 1).toLocaleString(
                        language === "ta" ? "ta-IN" : "en-IN",
                        {
                          month: "long",
                        },
                      )}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label
                htmlFor="amc-year"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                {t("Year")}
              </label>
              <select
                id="amc-year"
                value={amcYear}
                onChange={(event) => setAmcYear(Number(event.target.value))}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 lg:w-24"
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
            <Button
              type="button"
              variant="outline"
              className="col-span-2 h-auto min-h-11 w-full min-w-0 whitespace-normal leading-5 lg:col-span-1 lg:w-40"
              onClick={() => navigate("/employee/amcs")}
            >
              {t("View AMC visits")}
            </Button>
          </div>
        </div>

        {amcQuery.isLoading ? (
          <div
            className="rounded-lg border p-4 text-sm text-muted-foreground"
            role="status"
          >
            {t("Loading AMC progress...")}
          </div>
        ) : amcQuery.isError ? (
          <QueryError
            title={t("Could not load your AMC progress.")}
            message={getErrorMessage(
              amcQuery.error,
              t("Please try again."),
              t,
              language,
            )}
            retry={() => void amcQuery.refetch()}
            isFetching={amcQuery.isFetching}
            t={t}
          />
        ) : amcQuery.data ? (
          amcQuery.data.pagination.total === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center">
              <p className="font-medium">
                {t("No AMC records for this period.")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(
                  "There are no monthly AMC visits assigned to you for {period}.",
                  {
                    period: new Date(amcYear, amcMonth - 1, 1).toLocaleString(
                      language === "ta" ? "ta-IN" : "en-IN",
                      {
                        month: "long",
                        year: "numeric",
                      },
                    ),
                  },
                )}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("Monthly completion")}
                  </p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                    {(
                      ((amcQuery.data.statusCounts.COMPLETED ?? 0) /
                        amcQuery.data.pagination.total) *
                      100
                    ).toLocaleString(language === "ta" ? "ta-IN" : "en-IN", {
                      maximumFractionDigits: 1,
                    })}
                    %
                  </p>
                </div>
                <p className="max-w-sm break-words text-sm text-muted-foreground">
                  {t(
                    "{completed} completed of {total} assigned AMC record(s)",
                    {
                      completed: amcQuery.data.statusCounts.COMPLETED ?? 0,
                      total: amcQuery.data.pagination.total,
                    },
                  )}
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-5 border-t pt-2 sm:grid-cols-4">
                {AMC_STATUSES.map(({ value, label }) => (
                  <div
                    key={value}
                    className="flex min-h-14 items-center justify-between gap-2 border-b border-border/70 py-2 sm:border-b-0"
                  >
                    <span className="min-w-0 break-words text-sm text-muted-foreground">
                      {t(label)}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {amcQuery.data.statusCounts[value] ?? 0}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            {t("AMC progress is not available.")}
          </p>
        )}
      </section>
    </main>
  );
}

export default EmployeeDashboardPage;
