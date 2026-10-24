import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import {
  Activity,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileCheck2,
  CalendarClock,
  UserRound,
  type LucideIcon,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonBlock } from "@/features/dashboard/components/DashboardSkeleton";
import { useMyAMC } from "@/features/amc/hooks/useMyAMC";
import { useMyEmployeeProfile } from "@/features/employees/hooks/useMyEmployeeProfile";
import { useMyJobPerformance } from "@/features/jobs/hooks/useMyJobPerformance";
import type { AMCStatus } from "@/services/amc.service";
import type {
  JobPerformancePeriod,
  JobStatus,
} from "@/features/jobs/types/job.types";
import {
  employeeErrorMessage,
  employeeJobStatusLabel,
  employeeLanguageClasses,
  useEmployeeLanguage,
  type EmployeeTranslationKey,
} from "@/features/employee-portal/i18n";
import { getEmployeeJobsStatusHref } from "@/features/jobs/utils/employeeJobs.utils";

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
  const completedAssignedCount =
    (statusCounts?.COMPLETED ?? 0) +
    (statusCounts?.VERIFIED ?? 0) +
    (statusCounts?.APPROVED ?? 0) +
    (statusCounts?.CLOSED ?? 0);
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
  const hasWeeklyActivity = (activityDays ?? []).some(
    ({ assigned, completed }) => assigned > 0 || completed > 0,
  );

  const profile = profileQuery.data;
  const employeeName = [profile?.user?.firstName, profile?.user?.lastName]
    .filter(Boolean)
    .join(" ");
  const summaryCards: Array<{
    label: EmployeeTranslationKey;
    count: number;
    status?: JobStatus;
    Icon: LucideIcon;
    tone: string;
    iconTone: string;
  }> = [
    {
      label: "Total currently assigned",
      count: Math.max(
        0,
        (performanceQuery.data?.currentAssignedJobs.total ?? 0) -
          (statusCounts?.CANCELLED ?? 0),
      ),
      Icon: BriefcaseBusiness,
      tone: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
      iconTone: "bg-blue-100 dark:bg-blue-900/70",
    },
    {
      label: "Pending jobs",
      status: "PENDING",
      count: statusCounts?.PENDING ?? 0,
      Icon: Clock3,
      tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
      iconTone: "bg-amber-100 dark:bg-amber-900/70",
    },
    {
      label: "In-progress jobs",
      status: "IN_PROGRESS",
      count: statusCounts?.IN_PROGRESS ?? 0,
      Icon: Activity,
      tone: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
      iconTone: "bg-violet-100 dark:bg-violet-900/70",
    },
    {
      label: "Completed jobs",
      status: "COMPLETED",
      count: completedAssignedCount,
      Icon: CheckCircle2,
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
      iconTone: "bg-emerald-100 dark:bg-emerald-900/70",
    },
  ];

  return (
    <main
      className={`min-w-0 ${employeeLanguageClasses(
        language,
        "space-y-6",
        "space-y-5",
      )}`}
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <UserRound className="size-6 text-primary" aria-hidden="true" />
            <h1
              className={`min-w-0 break-words text-2xl font-bold tracking-tight sm:text-3xl ${employeeLanguageClasses(language, "", "leading-9")}`}
            >
              {t("Employee Dashboard")}
            </h1>
          </div>
          {profileQuery.isLoading ? (
            <p className="mt-2 text-sm text-muted-foreground" role="status">
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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {employeeName && (
                <p className="text-sm text-muted-foreground">
                  {t("Welcome, {name}", { name: employeeName })}
                </p>
              )}
              {profile.employeeCode && (
                <Badge variant="outline">
                  {t("Employee code: {code}", { code: profile.employeeCode })}
                </Badge>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className={`min-h-12 w-full whitespace-normal leading-5 sm:w-auto ${employeeLanguageClasses(language, "", "h-auto py-3")}`}
            onClick={() => navigate("/employee/attendance")}
          >
            <CalendarClock aria-hidden="true" />
            {t("My Attendance")}
          </Button>
          <Button
            type="button"
            className={`min-h-12 w-full whitespace-normal leading-5 sm:w-auto ${employeeLanguageClasses(language, "", "h-auto py-3")}`}
            onClick={() => navigate("/employee/jobs")}
          >
            <ClipboardList aria-hidden="true" />
            {t("My Jobs")}
          </Button>
        </div>
      </header>

      <section aria-labelledby="assigned-jobs-heading">
        <div className="mb-3 flex min-w-0 items-start gap-2">
          <BriefcaseBusiness
            className="size-5 text-primary"
            aria-hidden="true"
          />
          <h2
            id="assigned-jobs-heading"
            className="min-w-0 warp-break text-lg font-semibold leading-6"
          >
            {t("Currently Assigned Jobs")}11
          </h2>
        </div>

        {performanceQuery.isLoading ? (
          <div
            className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4"
            role="status"
          >
            {Array.from({ length: 4 }, (_, index) => (
              <SkeletonBlock key={index} className="h-28 rounded-xl" />
            ))}
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
          <div
            className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4"
            aria-label={t("Currently assigned jobs by status")}
          >
            {summaryCards.map(
              ({ label, count, status, Icon, tone, iconTone }) => (
                <button
                  key={label}
                  type="button"
                  aria-label={
                    status
                      ? t("View jobs with status: {status}", {
                          status: employeeJobStatusLabel(status, t),
                        })
                      : t("View all assigned jobs")
                  }
                  onClick={() => navigate(getEmployeeJobsStatusHref(status))}
                  className="group min-w-0 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                >
                  <Card
                    className={`h-full min-h-28 min-w-0 border shadow-sm transition-shadow group-hover:shadow-md ${tone}`}
                  >
                    <CardContent
                      className={`flex h-full items-start justify-between gap-2 p-3 sm:items-center sm:gap-3 sm:p-5 ${employeeLanguageClasses(language, "", "sm:p-4")}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium leading-5 text-slate-600 dark:text-slate-300 [overflow-wrap:anywhere]">
                          {t(label)}
                        </p>
                        <p className="mt-2 text-3xl font-bold tabular-nums">
                          {count.toLocaleString(numberLocale)}
                        </p>
                      </div>
                      <span
                        className={`grid size-9 shrink-0 place-items-center rounded-xl sm:size-11 ${iconTone}`}
                      >
                        <Icon className="size-5" aria-hidden="true" />
                      </span>
                    </CardContent>
                  </Card>
                </button>
              ),
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            {t("Assigned-job information is not available.")}
          </p>
        )}
      </section>

      <section
        aria-labelledby="completion-progress-heading"
        className="grid min-w-0 gap-4 lg:grid-cols-5"
      >
        <Card className="min-w-0 shadow-sm lg:col-span-2">
          <CardHeader className="p-4 pb-2 sm:p-5 sm:pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2
                className="size-5 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
              <span id="completion-progress-heading">
                {t("Completion progress")}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2 sm:p-5 sm:pt-2">
            {performanceQuery.isLoading ? (
              <div className="space-y-3" role="status">
                <SkeletonBlock className="h-8 w-24" />
                <SkeletonBlock className="h-3 w-full rounded-full" />
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
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <p className="text-4xl font-bold tabular-nums text-blue-700 dark:text-blue-300">
                    {t("{percent}% completed", {
                      percent:
                        displayedCompletionPercent.toLocaleString(numberLocale),
                    })}
                  </p>
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("{completed} of {eligible} eligible jobs completed", {
                      completed:
                        completedEligibleCount.toLocaleString(numberLocale),
                      eligible:
                        eligibleAssignedCount.toLocaleString(numberLocale),
                    })}
                  </p>
                </div>
                <div
                  className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                  role="progressbar"
                  aria-label={t("Completion progress")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={displayedCompletionPercent}
                >
                  <div
                    className="h-full rounded-full bg-linear-to-r from-blue-600 to-teal-500 transition-[width] duration-500 motion-reduce:transition-none"
                    style={{ width: `${displayedCompletionPercent}%` }}
                  />
                </div>
                {eligibleAssignedCount === 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t("No eligible assigned jobs yet.")}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("Performance information is not available.")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 shadow-sm lg:col-span-3">
          <CardHeader className="p-4 pb-2 sm:p-5 sm:pb-2">
            <CardTitle className="text-base">
              {t("Assigned vs completed")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("Last seven days in Asia/Kolkata")}
            </p>
          </CardHeader>
          <CardContent className="min-w-0 p-4 pt-2 sm:p-5 sm:pt-2">
            {performanceQuery.isLoading ? (
              <SkeletonBlock className="h-56 w-full rounded-xl" />
            ) : performanceQuery.isError ? (
              <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                {t("Performance information is not available.")}
              </p>
            ) : performanceQuery.data ? (
              <>
                {!hasWeeklyActivity && (
                  <p className="mb-3 rounded-lg border border-dashed border-teal-200 bg-teal-50/70 p-3 text-sm text-teal-900 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-200">
                    {t("No job activity in the last seven days.")}
                  </p>
                )}
                <div
                  className="relative h-52 min-h-0 w-full min-w-0 sm:h-60"
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
                            usePointStyle: true,
                            boxWidth: 8,
                            padding: 14,
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
                          ticks: {
                            autoSkip: false,
                            maxRotation: 0,
                            minRotation: 0,
                            font: { size: 10 },
                          },
                        },
                        y: {
                          beginAtZero: true,
                          ticks: { precision: 0, stepSize: 1 },
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
              <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                {t("Performance information is not available.")}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="performance-heading">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="size-5 text-primary" aria-hidden="true" />
              <h2 id="performance-heading" className="text-lg font-semibold">
                {t("Job Performance")}
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "Completion submissions are events; rework may count more than once.",
              )}
            </p>
          </div>
          <div className="w-full sm:w-48">
            <label
              htmlFor="performance-period"
              className="mb-1 block text-sm font-medium"
            >
              {t("Performance period")}
            </label>
            <select
              id="performance-period"
              value={period}
              onChange={(event) =>
                setPeriod(event.target.value as JobPerformancePeriod)
              }
              className="h-12 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Activity className="size-4" aria-hidden="true" />
                  {t("Completion events")}
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
                  {t("Average current-attempt duration")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">
                  {formatDuration(
                    performanceQuery.data.averageCurrentAttemptCompletionHours,
                    language,
                  )}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(
                    "Based on {count} currently assigned completed job(s) with valid timestamps.",
                    {
                      count:
                        performanceQuery.data.averageCurrentAttemptJobCount,
                    },
                  )}
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            {t("Performance information is not available.")}
          </p>
        )}
      </section>

      <section aria-labelledby="amc-progress-heading">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileCheck2
                  className="size-5 text-primary"
                  aria-hidden="true"
                />
                <h2 id="amc-progress-heading" className="text-lg font-semibold">
                  {t("AMC Progress")}
                </h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Monthly AMC records assigned to you.")}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-11 w-fit max-w-full whitespace-normal text-left leading-5"
              onClick={() => navigate("/employee/amcs")}
            >
              {t("View AMC visits")}
            </Button>
          </div>
          <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
            <div>
              <label
                htmlFor="amc-month"
                className="mb-1 block text-sm font-medium"
              >
                {t("Month")}
              </label>
              <select
                id="amc-month"
                value={amcMonth}
                onChange={(event) => setAmcMonth(Number(event.target.value))}
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                className="mb-1 block text-sm font-medium"
              >
                {t("Year")}
              </label>
              <select
                id="amc-year"
                value={amcYear}
                onChange={(event) => setAmcYear(Number(event.target.value))}
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
          <div
            className="rounded-lg border p-5 text-sm text-muted-foreground"
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
            <div className="rounded-lg border border-dashed p-6 text-center">
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
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {AMC_STATUSES.map(({ value, label }) => (
                  <Card key={value}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        {t(label)}
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
                    {t("Monthly completion")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {(
                      ((amcQuery.data.statusCounts.COMPLETED ?? 0) /
                        amcQuery.data.pagination.total) *
                      100
                    ).toLocaleString(language === "ta" ? "ta-IN" : "en-IN", {
                      maximumFractionDigits: 1,
                    })}
                    %
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(
                      "{completed} completed of {total} assigned AMC record(s)",
                      {
                        completed: amcQuery.data.statusCounts.COMPLETED ?? 0,
                        total: amcQuery.data.pagination.total,
                      },
                    )}
                  </p>
                </CardContent>
              </Card>
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
