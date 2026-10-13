import { useState } from "react";
import { isAxiosError } from "axios";
import {
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMyJobs } from "@/features/jobs/hooks/useMyJobs";
import type {
  Job,
  JobPriority,
  JobStatus,
} from "@/features/jobs/types/job.types";
import {
  employeeDisplayLabel,
  employeeJobStatusLabel,
  useEmployeeLanguage,
} from "@/features/employee-portal/i18n";

const ALL_STATUSES = "ALL";
const PAGE_SIZE = 10;

const jobStatuses: JobStatus[] = [
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

function formatLabel(
  value: string | undefined,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  if (!value) return t("Not available");
  if (jobStatuses.includes(value as JobStatus)) {
    return employeeJobStatusLabel(value, t);
  }
  const formatted = value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const labels: Record<string, Parameters<typeof t>[0]> = {
    "Daily Cleaning": "Daily Cleaning",
    "Weekly Mopping": "Weekly Mopping",
    Repair: "Repair",
    Maintenance: "Maintenance",
    Installation: "Installation",
    Inspection: "Inspection",
    Emergency: "Emergency",
    Low: "Low",
    Medium: "Medium",
    High: "High",
    Critical: "Critical",
  };
  return labels[formatted] ? t(labels[formatted]) : formatted;
}

function formatDate(
  value: string | null | undefined,
  language: "ta" | "en",
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  if (!value) return t("Not available");
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? t("Not available")
    : date.toLocaleString(language === "ta" ? "ta-IN" : "en-IN");
}

function formatScheduledDate(
  value: string,
  language: "ta" | "en",
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? t("Not available")
    : date.toLocaleDateString(language === "ta" ? "ta-IN" : "en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function getRecurringMaintenanceLabel(
  maintenanceType: "DAILY_CLEANING" | "WEEKLY_MOPPING",
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  return maintenanceType === "DAILY_CLEANING"
    ? t("Daily Cleaning")
    : t("Weekly Mopping");
}

function getStatusVariant(status: JobStatus) {
  if (status === "REJECTED") return "destructive" as const;
  if (status === "CANCELLED") return "destructive" as const;
  if (status === "PENDING" || status === "ON_HOLD") return "secondary" as const;
  if (status === "CLOSED") return "outline" as const;
  return "default" as const;
}

function getPriorityVariant(priority: JobPriority) {
  if (priority === "critical" || priority === "high") {
    return "destructive" as const;
  }
  if (priority === "low") return "secondary" as const;
  return "outline" as const;
}

function getATM(job: Job) {
  return typeof job.atmId === "object" && job.atmId !== null ? job.atmId : null;
}

function getErrorMessage(
  error: unknown,
  fallback: string,
  language: "ta" | "en",
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  if (isAxiosError<{ message?: string }>(error)) {
    return employeeDisplayLabel(
      language === "en" ? error.response?.data?.message || fallback : fallback,
      t,
    );
  }
  return language === "en" && error instanceof Error
    ? employeeDisplayLabel(error.message, t)
    : fallback;
}

function JobsSkeleton({ label }: { label: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2" role="status">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="h-52 animate-pulse rounded-lg border bg-muted/40"
        />
      ))}
      <p className="sr-only">{label}</p>
    </div>
  );
}

export default function EmployeeJobsPage() {
  const navigate = useNavigate();
  const { t, language } = useEmployeeLanguage();
  const [status, setStatus] = useState<JobStatus | typeof ALL_STATUSES>(
    ALL_STATUSES,
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch, isFetching } = useMyJobs({
    page,
    limit: PAGE_SIZE,
    ...(status !== ALL_STATUSES ? { status } : {}),
  });

  const jobs = data?.jobs ?? [];
  const pagination = data?.pagination;
  const searchTerm = search.trim().toLowerCase();
  const visibleJobs = jobs.filter((job) => {
    if (!searchTerm) return true;
    const atm = getATM(job);
    return [job.jobId, job.jobNumber, job.title, atm?.atmId, atm?.locationName]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(searchTerm));
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 sm:p-6" role="status">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-11 animate-pulse rounded-lg bg-muted" />
        <JobsSkeleton label={t("Loading your jobs...")} />
      </div>
    );
  }

  if (isError) {
    return (
      <main className="p-4 sm:p-6">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("My Jobs")}</h1>
        <div className="mt-6 max-w-xl rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <p className="font-medium text-destructive">
            {t("Could not load your jobs.")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {getErrorMessage(error, t("Could not load your jobs."), language, t)}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? t("Retrying...") : t("Retry")}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-5 p-4 sm:space-y-6 sm:p-6">
      <header>
        <div className="flex items-center gap-3">
          <BriefcaseBusiness
            className="size-6 text-primary"
            aria-hidden="true"
          />
          <h1 className="text-2xl font-bold sm:text-3xl">{t("My Jobs")}</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Assigned jobs: {count}", { count: pagination?.total ?? 0 })}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="my-jobs-search"
            className="mb-2 block text-sm font-medium"
          >
            {t("Search this page")}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="my-jobs-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Job ID, title, or ATM")}
              className="h-12 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        </div>
        <div>
          <label
            htmlFor="my-jobs-status"
            className="mb-2 block text-sm font-medium"
          >
            {t("Status")}
          </label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus((value as JobStatus | null) ?? ALL_STATUSES);
              setPage(1);
            }}
          >
            <SelectTrigger id="my-jobs-status" className="min-h-12 w-full text-base">
              <SelectValue placeholder={t("All statuses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>{t("All statuses")}</SelectItem>
              {jobStatuses.map((jobStatus) => (
                <SelectItem key={jobStatus} value={jobStatus}>
                  {formatLabel(jobStatus, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">
            {status === ALL_STATUSES
              ? t("No jobs assigned yet.")
              : t("No jobs found for this status.")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Assigned jobs will appear here.")}
          </p>
        </div>
      ) : visibleJobs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">{t("No jobs on this page match your search.")}</p>
          <Button
            type="button"
            variant="link"
            className="mt-2 min-h-11"
            onClick={() => setSearch("")}
          >
            {t("Clear search")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visibleJobs.map((job) => {
            const atm = getATM(job);
            return (
              <Card key={job._id}>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">
                        {job.jobNumber || job.jobId}
                      </p>
                      <CardTitle className="mt-1 break-words text-base">
                        {job.title}
                      </CardTitle>
                    </div>
                    <Badge variant={getStatusVariant(job.status)}>
                      {formatLabel(job.status, t)}
                    </Badge>
                  </div>
                  {job.description && (
                    <p className="line-clamp-3 text-sm text-muted-foreground">
                      {job.description}
                    </p>
                  )}
                  {job.rejectionReason && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                        {t("Returned for rework")}
                      </p>
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        {job.rejectionReason}
                      </p>
                    </div>
                  )}
                  {job.recurringMaintenance?.source === "RECURRING" && (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{t("Recurring")}</Badge>
                        <span className="text-sm font-medium">
                          {getRecurringMaintenanceLabel(
                            job.recurringMaintenance.maintenanceType,
                            t,
                          )}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("Scheduled")}:{" "}
                        {formatScheduledDate(
                          job.recurringMaintenance.scheduledDate,
                          language,
                          t,
                        )}
                      </p>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{t("ATM")}</p>
                      <p className="break-words font-medium">
                        {atm?.atmId || t("Not available")}
                      </p>
                      {atm?.locationName && (
                        <p className="break-words text-xs text-muted-foreground">
                          {atm.locationName}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t("Work type")}</p>
                      <p className="font-medium">{formatLabel(job.workType, t)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t("Priority")}</p>
                      <Badge variant={getPriorityVariant(job.priority)}>
                        {formatLabel(job.priority, t)}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t("Created")}</p>
                      <p className="font-medium">
                        {formatDate(job.createdAt, language, t)}
                      </p>
                    </div>
                    {job.assignedAt && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground">
                          {t("Assigned")}
                        </p>
                        <p className="font-medium">
                          {formatDate(job.assignedAt, language, t)}
                        </p>
                      </div>
                    )}
                  </div>
                  {job.isReassigned && (
                    <Badge variant="outline">{t("Reassigned")}</Badge>
                  )}
                  <div className="border-t pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full sm:w-auto"
                      onClick={() => navigate(`/employee/jobs/${job._id}`)}
                    >
                      {t("View details")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            {t("Page {page} of {pages}", {
              page: pagination.page,
              pages: pagination.totalPages,
            })}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => setPage((current) => current - 1)}
              disabled={page <= 1 || isFetching}
            >
              <ChevronLeft />
              {t("Previous")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => setPage((current) => current + 1)}
              disabled={page >= pagination.totalPages || isFetching}
            >
              {t("Next")}
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
