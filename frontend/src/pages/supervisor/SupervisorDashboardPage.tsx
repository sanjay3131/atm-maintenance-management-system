import {
  Activity,
  AlertTriangle,
  BriefcaseBusiness,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  Clock3,
  MapPin,
  RefreshCw,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SkeletonBlock } from "@/features/dashboard/components/DashboardSkeleton";
import { useSupervisorDashboard } from "@/features/supervisor/hooks/useSupervisorDashboard";
import { useAuth } from "@/features/auth/auth-context";
import type {
  SupervisorAmcStatus,
  SupervisorDashboard,
  SupervisorJobStatus,
} from "@/services/supervisor.service";

const jobStatusLabels: Record<SupervisorJobStatus, string> = {
  PENDING: "Pending",
  ASSIGNED: "Assigned",
  ACCEPTED: "Accepted",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  VERIFIED: "Verified",
  APPROVED: "Approved",
  CLOSED: "Closed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const jobStatusTones: Record<SupervisorJobStatus, string> = {
  PENDING: "bg-slate-400",
  ASSIGNED: "bg-blue-500",
  ACCEPTED: "bg-indigo-500",
  IN_PROGRESS: "bg-amber-500",
  ON_HOLD: "bg-orange-500",
  COMPLETED: "bg-cyan-600",
  VERIFIED: "bg-violet-500",
  APPROVED: "bg-teal-600",
  CLOSED: "bg-slate-600",
  REJECTED: "bg-rose-600",
  CANCELLED: "bg-slate-300",
};

const amcStatusLabels: Record<SupervisorAmcStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  OVERDUE: "Overdue",
};

const amcStatusTones: Record<SupervisorAmcStatus, string> = {
  PENDING: "text-amber-800 bg-amber-50",
  IN_PROGRESS: "text-blue-800 bg-blue-50",
  COMPLETED: "text-teal-800 bg-teal-50",
  OVERDUE: "text-rose-800 bg-rose-50",
};

const countValue = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

const formatCount = (value: number | null | undefined) => {
  const count = countValue(value);
  return count === null ? "—" : count.toLocaleString("en-IN");
};

const formatActivityDate = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

const formatAction = (action: string | null | undefined) =>
  action
    ? action
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : "Activity";

function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <Card className="min-w-0 border-slate-200 shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-600">{label}</p>
            <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
              {value}
            </p>
          </div>
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone}`}
          >
            <Icon className="size-5" aria-hidden="true" />
          </span>
        </div>
        <p className="mt-2 text-sm leading-5 text-slate-500">{description}</p>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading supervisor dashboard"
      className="space-y-6"
    >
      <div className="space-y-2">
        <SkeletonBlock className="h-8 w-72 max-w-full" />
        <SkeletonBlock className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonBlock key={index} className="h-36 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonBlock className="h-80 rounded-xl" />
        <SkeletonBlock className="h-80 rounded-xl" />
        <SkeletonBlock className="h-72 rounded-xl lg:col-span-2" />
      </div>
      <span className="sr-only">Loading supervisor dashboard data</span>
    </div>
  );
}

function DashboardError({
  error,
  retry,
  isFetching,
}: {
  error: unknown;
  retry: () => void;
  isFetching: boolean;
}) {
  const responseMessage =
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "message" in error.response.data &&
    typeof error.response.data.message === "string"
      ? error.response.data.message
      : null;

  return (
    <Card className="border-rose-200">
      <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <AlertTriangle
            className="mt-0.5 size-5 shrink-0 text-rose-600"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold text-slate-900">
              Dashboard data could not be loaded
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {responseMessage ||
                "Check your connection and try again. Metrics are not available until the request succeeds."}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={retry}
          disabled={isFetching}
          className="min-h-11 shrink-0"
        >
          <RefreshCw
            className={`size-4 ${isFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {isFetching ? "Retrying..." : "Retry"}
        </Button>
      </CardContent>
    </Card>
  );
}

function JobStatusSummary({
  jobs,
}: {
  jobs: SupervisorDashboard["jobs"];
}) {
  const statusCounts = jobs?.byStatus;
  const entries = (
    Object.entries(jobStatusLabels) as Array<[SupervisorJobStatus, string]>
  )
    .map(([status, label]) => ({
      status,
      label,
      count: countValue(statusCounts?.[status]),
    }))
    .filter(
      (
        entry,
      ): entry is {
        status: SupervisorJobStatus;
        label: string;
        count: number;
      } => entry.count !== null,
    );
  const maxCount = Math.max(0, ...entries.map(({ count }) => count));
  const recurringOverdue = countValue(jobs?.overdue);
  const recurringScheduled = countValue(jobs?.scheduledToday);

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="p-4 pb-2 sm:p-5 sm:pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Job status</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Current jobs grouped by their persisted status
            </p>
          </div>
          <BriefcaseBusiness
            className="size-5 text-blue-700"
            aria-hidden="true"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-3 sm:p-5 sm:pt-3">
        {entries.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            Job status data is not available.
          </p>
        ) : (
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {entries.map(({ status, label, count }) => (
              <div key={status} className="min-w-0">
                <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-slate-600">{label}</span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {formatCount(count)}
                  </span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-slate-100"
                  role="img"
                  aria-label={`${label}: ${formatCount(count)} jobs`}
                >
                  <div
                    className={`h-full rounded-full ${jobStatusTones[status]}`}
                    style={{
                      width: `${maxCount > 0 ? (count / maxCount) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        {(recurringOverdue !== null || recurringScheduled !== null) && (
          <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
            {recurringScheduled !== null && (
              <div className="rounded-xl bg-blue-50 p-3">
                <p className="text-xs font-medium text-blue-800">
                  Recurring jobs scheduled today
                </p>
                <p className="mt-1 text-xl font-bold text-blue-950">
                  {formatCount(recurringScheduled)}
                </p>
              </div>
            )}
            {recurringOverdue !== null && (
              <div className="rounded-xl bg-rose-50 p-3">
                <p className="text-xs font-medium text-rose-800">
                  Recurring jobs overdue
                </p>
                <p className="mt-1 text-xl font-bold text-rose-950">
                  {formatCount(recurringOverdue)}
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttendanceSummary({
  dashboard,
}: {
  dashboard: SupervisorDashboard;
}) {
  const attendance = dashboard.attendance;
  const rows = [
    { label: "Attendance records", value: attendance?.records },
    { label: "Checked in", value: attendance?.checkedIn },
    { label: "Checked out", value: attendance?.checkedOut },
    { label: "Still checked in", value: attendance?.open },
  ];
  const date = attendance?.date
    ? new Date(`${attendance.date}T12:00:00+05:30`)
    : null;
  const dateLabel =
    date && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("en-IN", {
          dateStyle: "full",
          timeZone: "Asia/Kolkata",
        }).format(date)
      : null;

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="p-4 pb-2 sm:p-5 sm:pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Team attendance</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              {dateLabel || "Attendance summary"}
            </p>
          </div>
          <CalendarCheck2
            className="size-5 text-teal-700"
            aria-hidden="true"
          />
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-3 sm:p-5 sm:pt-3">
        <div className="grid grid-cols-2 gap-3">
          {rows.map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-slate-100 p-3">
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                {formatCount(value)}
              </p>
            </div>
          ))}
        </div>
        {countValue(dashboard.employees?.total) === 0 && (
          <p className="mt-4 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900">
            No employees are currently assigned to you.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AmcProgress({ amc }: { amc: SupervisorDashboard["amc"] }) {
  const statuses = amc?.byStatus;
  const entries = (
    Object.entries(amcStatusLabels) as Array<[SupervisorAmcStatus, string]>
  )
    .map(([status, label]) => ({
      status,
      label,
      count: countValue(statuses?.[status]),
    }))
    .filter(
      (
        entry,
      ): entry is {
        status: SupervisorAmcStatus;
        label: string;
        count: number;
      } => entry.count !== null,
    );
  const completionRate =
    typeof amc?.completionRate === "number" &&
    Number.isFinite(amc.completionRate)
      ? Math.min(100, Math.max(0, amc.completionRate))
      : null;
  const period =
    amc?.month && amc?.year
      ? new Intl.DateTimeFormat("en-IN", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(amc.year, amc.month - 1, 1)))
      : "Current period";

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="p-4 pb-2 sm:p-5 sm:pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">AMC progress</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              {period} · {formatCount(amc?.total)} records
            </p>
          </div>
          <CalendarClock
            className="size-5 text-teal-700"
            aria-hidden="true"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4 pt-3 sm:p-5 sm:pt-3">
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-600">
              Completion rate
            </span>
            <span className="font-bold tabular-nums text-slate-900">
              {completionRate === null ? "—" : `${completionRate}%`}
            </span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-slate-100"
            role="img"
            aria-label={`AMC completion rate ${
              completionRate === null ? "unavailable" : `${completionRate}%`
            }`}
          >
            {completionRate !== null && (
              <div
                className="h-full rounded-full bg-teal-600"
                style={{ width: `${completionRate}%` }}
              />
            )}
          </div>
        </div>
        {entries.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {entries.map(({ status, label, count }) => (
              <div
                key={status}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${amcStatusTones[status]}`}
              >
                <span>{label}</span>
                <span className="font-bold tabular-nums">
                  {formatCount(count)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            AMC status data is not available.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RecentActivity({
  activity,
}: {
  activity: SupervisorDashboard["recentActivity"];
}) {
  if (!Array.isArray(activity)) return null;

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="p-4 pb-2 sm:p-5 sm:pb-2">
        <div className="flex items-center gap-2">
          <Activity className="size-5 text-blue-700" aria-hidden="true" />
          <CardTitle className="text-base">Recent activity</CardTitle>
        </div>
        <p className="text-sm text-slate-500">
          Latest recorded job history events for your team
        </p>
      </CardHeader>
      <CardContent className="p-4 pt-3 sm:p-5 sm:pt-3">
        {activity.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            No recent job activity is available.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activity.map((item, index) => {
              const dateLabel = formatActivityDate(item.occurredAt);
              const identifier = item.jobNumber || item.jobId;
              return (
                <li
                  key={`${item.jobId || identifier || "activity"}-${item.occurredAt || index}`}
                  className="flex gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-700">
                    {item.toStatus === "COMPLETED" ? (
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                    ) : (
                      <Clock3 className="size-4" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold text-slate-800">
                      {item.title || identifier || "Job activity"}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {formatAction(item.action)}
                      {item.toStatus
                        ? ` · ${item.fromStatus ? `${item.fromStatus} → ` : ""}${item.toStatus}`
                        : ""}
                      {identifier && item.title ? ` · ${identifier}` : ""}
                    </p>
                  </div>
                  {dateLabel && (
                    <time
                      dateTime={item.occurredAt || undefined}
                      className="shrink-0 text-right text-xs text-slate-500"
                    >
                      {dateLabel}
                    </time>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function SupervisorDashboardPage() {
  const { user } = useAuth();
  const dashboardQuery = useSupervisorDashboard();

  if (dashboardQuery.isLoading && !dashboardQuery.data) {
    return <DashboardSkeleton />;
  }

  if (dashboardQuery.isError && !dashboardQuery.data) {
    return (
      <DashboardError
        error={dashboardQuery.error}
        retry={() => void dashboardQuery.refetch()}
        isFetching={dashboardQuery.isFetching}
      />
    );
  }

  const dashboard = dashboardQuery.data;
  if (!dashboard) {
    return (
      <DashboardError
        error={new Error("The supervisor dashboard response was empty.")}
        retry={() => void dashboardQuery.refetch()}
        isFetching={dashboardQuery.isFetching}
      />
    );
  }

  const attendanceRecords = countValue(dashboard.attendance?.records);
  const checkedIn = countValue(dashboard.attendance?.checkedIn);
  const checkedOut = countValue(dashboard.attendance?.checkedOut);
  const attendanceDescription =
    attendanceRecords === null
      ? "Today's attendance summary is not available"
      : `${formatCount(checkedIn)} checked in · ${formatCount(checkedOut)} checked out`;
  const completionRate =
    typeof dashboard.amc?.completionRate === "number" &&
    Number.isFinite(dashboard.amc.completionRate)
      ? `${Math.min(100, Math.max(0, dashboard.amc.completionRate))}%`
      : "—";
  const supervisorName = user?.firstName?.trim();

  return (
    <div className="space-y-6 sm:space-y-7">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
          Team operations
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
          {supervisorName ? `Welcome, ${supervisorName}` : "Welcome"}
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
          A current overview of your assigned team, work status, attendance,
          and monthly AMC progress.
        </p>
      </header>

      {dashboardQuery.isError && (
        <DashboardError
          error={dashboardQuery.error}
          retry={() => void dashboardQuery.refetch()}
          isFetching={dashboardQuery.isFetching}
        />
      )}

      <section
        aria-label="Supervisor overview metrics"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        <MetricCard
          label="Supervised employees"
          value={formatCount(dashboard.employees?.total)}
          description="Employees currently assigned to you"
          icon={Users}
          tone="bg-blue-50 text-blue-700"
        />
        <MetricCard
          label="Assigned ATMs"
          value={formatCount(dashboard.atms?.total)}
          description="ATMs linked to your assigned employees"
          icon={MapPin}
          tone="bg-cyan-50 text-cyan-700"
        />
        <MetricCard
          label="Attendance records"
          value={formatCount(dashboard.attendance?.records)}
          description={attendanceDescription}
          icon={CalendarCheck2}
          tone="bg-teal-50 text-teal-700"
        />
        <MetricCard
          label="Current jobs"
          value={formatCount(dashboard.jobs?.total)}
          description="Jobs across your supervised employees"
          icon={BriefcaseBusiness}
          tone="bg-indigo-50 text-indigo-700"
        />
        <MetricCard
          label="AMC completion"
          value={completionRate}
          description={`${formatCount(dashboard.amc?.total)} records for the reported month`}
          icon={CheckCircle2}
          tone="bg-emerald-50 text-emerald-700"
        />
      </section>

      <section
        aria-label="Team work and attendance"
        className="grid min-w-0 gap-4 xl:grid-cols-2"
      >
        <JobStatusSummary jobs={dashboard.jobs} />
        <AttendanceSummary dashboard={dashboard} />
      </section>

      <section
        aria-label="AMC and team activity"
        className="grid min-w-0 gap-4 xl:grid-cols-2"
      >
        <AmcProgress amc={dashboard.amc} />
        <RecentActivity activity={dashboard.recentActivity} />
      </section>

      {dashboardQuery.isFetching && (
        <p
          className="sr-only"
          role="status"
          aria-live="polite"
        >
          Refreshing supervisor dashboard
        </p>
      )}
    </div>
  );
}
