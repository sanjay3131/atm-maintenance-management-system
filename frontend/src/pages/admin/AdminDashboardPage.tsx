import {
  AlertCircle,
  AlertTriangle,
  BriefcaseBusiness,
  Monitor,
  Users,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DashboardLoadingSkeleton,
  SkeletonBlock,
} from "@/features/dashboard/components/DashboardSkeleton";
import EmployeePerformance from "@/features/dashboard/components/EmployeePerformance";
import JobTrendsChart from "@/features/dashboard/components/JobTrendsChart";
import OperationsSummary from "@/features/dashboard/components/OperationsSummary";
import { useDashboardStats } from "@/features/dashboard/hooks/useDashboardStats";
import { useRecentActivity } from "@/features/dashboard/hooks/useRecentActivity";
import { getAdminComplaints } from "@/features/complaints/services/complaint.service";
import type { ComplaintStatus } from "@/features/complaints/types/complaint.types";

const UNRESOLVED_COMPLAINT_STATUSES: ComplaintStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
];

function useCriticalUnresolvedComplaints() {
  return useQuery({
    queryKey: ["dashboard-attention", "critical-unresolved-complaints"],
    queryFn: async () => {
      const results = await Promise.all(
        UNRESOLVED_COMPLAINT_STATUSES.map((status) =>
          getAdminComplaints({
            status,
            priority: "CRITICAL",
            page: 1,
            limit: 1,
          }),
        ),
      );
      return results.reduce(
        (total, result) => total + result.pagination.total,
        0,
      );
    },
    staleTime: 1000 * 60,
  });
}

const metricContainerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.07 },
  },
};

const metricVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: "easeOut" as const },
  },
};

const sectionVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: "easeOut" as const },
  },
};

const metricStyles = {
  neutral: {
    icon: "bg-muted text-muted-foreground",
    value: "text-foreground",
  },
  attention: {
    icon: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    value: "text-amber-800 dark:text-amber-200",
  },
};

function DashboardMetric({
  title,
  value,
  description,
  icon: Icon,
  color,
}: {
  title: string;
  value: number;
  description: string;
  icon: typeof BriefcaseBusiness;
  color: keyof typeof metricStyles;
}) {
  const styles = metricStyles[color];
  return (
    <motion.div
      variants={metricVariants}
      className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <span className={`shrink-0 rounded-lg p-2 ${styles.icon}`}>
          <Icon aria-hidden="true" className="size-5" />
        </span>
      </div>
      <p
        className={`mt-4 text-3xl font-semibold tracking-tight tabular-nums ${styles.value}`}
      >
        {value.toLocaleString()}
      </p>
      <p className="mt-1 break-words text-sm text-muted-foreground">
        {description}
      </p>
    </motion.div>
  );
}

function StatusMetric({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-background/70 p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${color}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function RecentActivitySkeleton() {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-label="Loading recent activity"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBlock className="h-4 w-2/3" />
            <SkeletonBlock className="h-3 w-1/2" />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <SkeletonBlock className="h-5 w-20" />
            <SkeletonBlock className="h-5 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

function AttentionRequired({
  reducedMotion,
}: {
  reducedMotion: boolean | null;
}) {
  const {
    data: criticalUnresolvedCount,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useCriticalUnresolvedComplaints();

  return (
    <motion.section
      aria-labelledby="attention-required-title"
      variants={sectionVariants}
      initial={reducedMotion ? false : "hidden"}
      animate="visible"
      className="min-w-0"
    >
      <Card className="min-w-0 border-t-2 border-t-amber-500 shadow-sm">
        <CardHeader className="p-4 sm:p-5">
          <CardTitle
            id="attention-required-title"
            className="flex items-center gap-2 text-base"
          >
            <AlertCircle
              aria-hidden="true"
              className="size-5 text-amber-600 dark:text-amber-400"
            />
            Attention Required
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Items needing operational follow-up.
          </p>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
          {isLoading && criticalUnresolvedCount === undefined ? (
            <div
              className="space-y-3"
              role="status"
              aria-label="Loading attention items"
            >
              <SkeletonBlock className="h-16 w-full" />
            </div>
          ) : isError && criticalUnresolvedCount === undefined ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
              role="alert"
            >
              <p className="text-sm text-destructive">
                Could not load attention items.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                {isFetching ? "Retrying..." : "Retry"}
              </Button>
            </div>
          ) : criticalUnresolvedCount === undefined ? (
            <p className="text-sm text-muted-foreground" role="status">
              Critical complaint count is unavailable.
            </p>
          ) : criticalUnresolvedCount === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No critical unresolved complaints.
            </p>
          ) : (
            <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-amber-300/70 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300"
                />
                <div className="min-w-0">
                  <p className="font-medium">
                    {criticalUnresolvedCount.toLocaleString()} critical
                    unresolved{" "}
                    {criticalUnresolvedCount === 1 ? "complaint" : "complaints"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Open, assigned, and in-progress critical complaints.
                  </p>
                </div>
              </div>
              <Link
                to="/admin/complaints?priority=CRITICAL"
                className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Review complaints
              </Link>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Overdue-job and recurring-maintenance counts are not available
            through the current read-only dashboard data.
          </p>
        </CardContent>
      </Card>
    </motion.section>
  );
}

function activityStatusVariant(status: string) {
  const normalizedStatus = status.toUpperCase();
  if (
    ["COMPLETED", "VERIFIED", "APPROVED", "CLOSED", "RESOLVED"].includes(
      normalizedStatus,
    )
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  }
  if (["IN_PROGRESS", "ACCEPTED"].includes(normalizedStatus)) {
    return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200";
  }
  if (["PENDING", "ON_HOLD", "REJECTED"].includes(normalizedStatus)) {
    return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";
  }
  if (["CANCELLED"].includes(normalizedStatus)) {
    return "border-muted-foreground/30 bg-muted text-muted-foreground";
  }
  if (["ASSIGNED"].includes(normalizedStatus)) {
    return "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-200";
  }
  if (["OPEN"].includes(normalizedStatus)) {
    return "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-200";
  }
  return "border-border bg-background text-foreground";
}

export default function AdminDashboardPage() {
  const { data, isLoading } = useDashboardStats();
  const {
    data: activityData,
    isLoading: isActivityLoading,
    isError: isActivityError,
  } = useRecentActivity();
  const reducedMotion = useReducedMotion();

  if (isLoading && !data) {
    return <DashboardLoadingSkeleton />;
  }

  if (!data) {
    return (
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          Failed to load dashboard data. Please try again.
        </div>
      </main>
    );
  }

  const cards = [
    {
      title: "Total Jobs",
      value: data.jobs.total,
      description: `${data.jobs.pending.toLocaleString()} pending`,
      icon: BriefcaseBusiness,
      color: "neutral",
    },
    {
      title: "Total ATMs",
      value: data.atms.total,
      description: `${data.atms.active.toLocaleString()} active`,
      icon: Monitor,
      color: "neutral",
    },
    {
      title: "Employees",
      value: data.employees.total,
      description: `${data.employees.workingToday.toLocaleString()} working today`,
      icon: Users,
      color: "neutral",
    },
    {
      title: "Open Complaints",
      value: data.complaints.open,
      description: `${data.complaints.criticalOpen.toLocaleString()} critical`,
      icon: AlertTriangle,
      color: "attention",
    },
  ] as const;

  return (
    <motion.main
      initial={reducedMotion ? false : "hidden"}
      animate="visible"
      variants={sectionVariants}
      className="min-w-0 space-y-6 p-4 sm:p-6 lg:p-8"
    >
      <header>
        <p className="text-sm font-medium text-muted-foreground">
          Operations overview
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your ATM maintenance operations.
        </p>
      </header>

      <motion.section
        aria-label="Key operational metrics"
        variants={metricContainerVariants}
        initial={reducedMotion ? false : "hidden"}
        animate="visible"
        className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {cards.map((card) => (
          <DashboardMetric
            key={card.title}
            title={card.title}
            value={card.value}
            description={card.description}
            icon={card.icon}
            color={card.color}
          />
        ))}
      </motion.section>

      <AttentionRequired reducedMotion={reducedMotion} />

      <section
        aria-label="Operational details"
        className="grid min-w-0 items-start gap-4 md:grid-cols-2 lg:grid-cols-4"
      >
        <motion.div
          variants={sectionVariants}
          initial={reducedMotion ? false : "hidden"}
          animate="visible"
          className="min-w-0 lg:col-span-2"
        >
          <Card className="min-w-0 border-t-2 border-t-amber-400 shadow-sm">
            <CardHeader className="p-4 pb-0 sm:p-5 sm:pb-0">
              <CardTitle className="text-base">Job Status</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5">
              <StatusMetric
                label="Pending"
                value={data.jobs.pending}
                color="text-amber-700 dark:text-amber-300"
              />
              <StatusMetric
                label="Assigned"
                value={data.jobs.assigned}
                color="text-sky-700 dark:text-sky-300"
              />
              <StatusMetric
                label="In Progress"
                value={data.jobs.inProgress}
                color="text-blue-700 dark:text-blue-300"
              />
              <StatusMetric
                label="Completed"
                value={data.jobs.completed}
                color="text-emerald-700 dark:text-emerald-300"
              />
              <StatusMetric
                label="Cancelled"
                value={data.jobs.cancelled}
                color="text-muted-foreground"
              />
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          variants={sectionVariants}
          initial={reducedMotion ? false : "hidden"}
          animate="visible"
          className="min-w-0 lg:col-span-2"
        >
          <Card className="min-w-0 border-t-2 border-t-rose-400 shadow-sm">
            <CardHeader className="p-4 pb-0 sm:p-5 sm:pb-0">
              <CardTitle className="text-base">Complaints</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5">
              <StatusMetric
                label="Open"
                value={data.complaints.open}
                color="text-rose-700 dark:text-rose-300"
              />
              <StatusMetric
                label="Assigned"
                value={data.complaints.assigned}
                color="text-sky-700 dark:text-sky-300"
              />
              <StatusMetric
                label="In Progress"
                value={data.complaints.inProgress}
                color="text-blue-700 dark:text-blue-300"
              />
              <StatusMetric
                label="Resolved"
                value={data.complaints.resolved}
                color="text-emerald-700 dark:text-emerald-300"
              />
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          variants={sectionVariants}
          initial={reducedMotion ? false : "hidden"}
          animate="visible"
          className="min-w-0 md:col-span-2 lg:col-span-4"
        >
          <JobTrendsChart />
        </motion.div>

        <motion.div
          variants={sectionVariants}
          initial={reducedMotion ? false : "hidden"}
          animate="visible"
          className="min-w-0 md:col-span-2 lg:col-span-4"
        >
          <EmployeePerformance />
        </motion.div>

        <motion.div
          variants={sectionVariants}
          initial={reducedMotion ? false : "hidden"}
          animate="visible"
          className="min-w-0 md:col-span-2 lg:col-span-2"
        >
          <OperationsSummary />
        </motion.div>

        <motion.div
          variants={sectionVariants}
          initial={reducedMotion ? false : "hidden"}
          animate="visible"
          className="min-w-0 md:col-span-2 lg:col-span-2"
        >
          <Card className="min-w-0 shadow-sm">
            <CardHeader className="p-4 sm:p-5">
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <p className="text-sm text-muted-foreground">
                Latest jobs and complaints.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
              {isActivityLoading && !activityData ? (
                <RecentActivitySkeleton />
              ) : isActivityError && !activityData ? (
                <p className="text-sm text-destructive" role="alert">
                  Failed to load recent activity.
                </p>
              ) : !activityData?.activities.length ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No recent activity.
                </p>
              ) : (
                <div className="divide-y">
                  {activityData.activities.map((activity) => (
                    <div
                      key={`${activity.type}-${activity.id}`}
                      className="flex min-w-0 items-start justify-between gap-3 py-3 sm:gap-4 sm:py-4"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">
                          {activity.title}
                        </p>
                        <p className="mt-1 whitespace-normal break-words text-xs text-muted-foreground">
                          {activity.atmName}
                          {activity.employeeName
                            ? ` · ${activity.employeeName}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge
                          variant="outline"
                          className={activityStatusVariant(activity.status)}
                        >
                          {activity.status.replaceAll("_", " ")}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="border-border bg-muted/60 text-foreground"
                        >
                          {activity.priority}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </section>
    </motion.main>
  );
}
