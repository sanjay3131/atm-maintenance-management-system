import { useState } from "react";
import { isAxiosError } from "axios";
import {
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  employeeLanguageClasses,
  useEmployeeLanguage,
} from "@/features/employee-portal/i18n";
import {
  EMPLOYEE_JOB_STATUSES,
  getEmployeeJobsPage,
  getEmployeeJobsStatusChange,
  parseEmployeeJobStatusFilter,
} from "@/features/jobs/utils/employeeJobs.utils";
import {
  formatAcSubType,
  formatJobWorkType,
} from "@/features/jobs/utils/jobWorkType.utils";

const ALL_STATUSES = "ALL";
const PAGE_SIZE = 10;
const jobStatuses = EMPLOYEE_JOB_STATUSES;

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

function getATM(job: Job) {
  return typeof job.atmId === "object" && job.atmId !== null ? job.atmId : null;
}

function getStatusVariant(status: JobStatus) {
  if (status === "REJECTED" || status === "CANCELLED") {
    return "destructive" as const;
  }
  if (status === "PENDING" || status === "ON_HOLD") {
    return "secondary" as const;
  }
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
    <div className="grid gap-3 xl:grid-cols-2" role="status">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="h-56 animate-pulse rounded-lg border bg-muted/40 motion-reduce:animate-none"
        />
      ))}
      <p className="sr-only">{label}</p>
    </div>
  );
}

export default function EmployeeJobsPage() {
  const navigate = useNavigate();
  const { t, language } = useEmployeeLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStatus = searchParams.get("status");
  const parsedStatus = parseEmployeeJobStatusFilter(requestedStatus);
  const status =
    parsedStatus.kind === "valid" ? parsedStatus.status : ALL_STATUSES;
  const hasInvalidStatus = parsedStatus.kind === "invalid";
  const [search, setSearch] = useState("");
  const [paginationState, setPaginationState] = useState({
    status: requestedStatus,
    page: 1,
  });
  const page = getEmployeeJobsPage(
    paginationState.status,
    requestedStatus,
    paginationState.page,
  );
  const { data, isLoading, isError, error, refetch, isFetching } = useMyJobs({
    page,
    limit: PAGE_SIZE,
    ...(status !== ALL_STATUSES ? { status } : {}),
  }, !hasInvalidStatus);

  const updateStatus = (nextStatus: JobStatus | typeof ALL_STATUSES) => {
    const change = getEmployeeJobsStatusChange(nextStatus, page);
    setPaginationState({
      status: change.status === ALL_STATUSES ? null : change.status,
      page: change.page,
    });
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (change.status === ALL_STATUSES) next.delete("status");
      else next.set("status", change.status);
      return next;
    });
  };

  const clearStatusFilter = () => updateStatus(ALL_STATUSES);

  if (hasInvalidStatus) {
    return (
      <main className="min-w-0 space-y-4 p-3 sm:p-5">
        <h1 className="sr-only">{t("My Jobs")}</h1>
        <div
          className="mx-auto flex min-w-0 max-w-7xl flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
          role="alert"
        >
          <p className="min-w-0 break-words text-sm leading-6">
            {t("The requested status filter is invalid.")}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 h-auto whitespace-normal leading-5"
            onClick={clearStatusFilter}
          >
            {t("Clear status filter")}
          </Button>
        </div>
      </main>
    );
  }

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
      <main className={`min-w-0 ${employeeLanguageClasses(language, "p-4 sm:p-6 lg:p-8", "p-3 sm:p-5 lg:p-6")}`}>
        <div className="mx-auto max-w-7xl space-y-4">
          <div className="h-5 w-36 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-24 animate-pulse rounded-lg border bg-muted/40 motion-reduce:animate-none" />
          <JobsSkeleton label={t("Loading your jobs...")} />
        </div>
      </main>
    );
  }

  if (isError) {
    return (
      <main className={`min-w-0 ${employeeLanguageClasses(language, "p-4 sm:p-6", "p-3 sm:p-4")}`}>
        <h1 className="sr-only">{t("My Jobs")}</h1>
        <div className="mt-6 max-w-xl rounded-lg border border-destructive/30 bg-destructive/5 p-5" role="alert">
          <p className="font-medium text-destructive">
            {t("Could not load your jobs.")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {getErrorMessage(error, t("Could not load your jobs."), language, t)}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 min-h-11"
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
    <main className={`min-w-0 bg-background text-foreground ${employeeLanguageClasses(language, "p-3 sm:p-5 lg:p-8", "p-2 sm:p-4 lg:p-6")}`}>
      <div className={`mx-auto max-w-7xl min-w-0 ${employeeLanguageClasses(language, "space-y-4", "space-y-3")}`}>
        <header className="flex min-w-0 flex-wrap items-center gap-2 border-b pb-3">
          <h1 className="sr-only">{t("My Jobs")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Assigned jobs: {count}", {
              count: (pagination?.total ?? 0).toLocaleString(
                language === "ta" ? "ta-IN" : "en-IN",
              ),
            })}
          </p>
        </header>

        <section
          aria-label={t("Search this page")}
          className="grid min-w-0 gap-3 rounded-lg border bg-card p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.55fr)] lg:items-end"
        >
          <label className="min-w-0 space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("Search this page")}
            </span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                id="my-jobs-search"
                type="search"
                aria-label={t("Search this page")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("Job ID, title, or ATM")}
                className="h-11 w-full min-w-0 rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </span>
          </label>
          <div className="min-w-0 space-y-1.5">
            <label
              htmlFor="my-jobs-status"
              className="block text-xs font-medium text-muted-foreground"
            >
              {t("Status")}
            </label>
            <Select
              value={status}
              onValueChange={(value) =>
                updateStatus((value as JobStatus | null) ?? ALL_STATUSES)
              }
            >
              <SelectTrigger
                id="my-jobs-status"
                aria-label={t("Status")}
                className="h-auto min-h-11 w-full min-w-0 whitespace-normal rounded-lg text-left text-sm leading-5"
              >
                <SelectValue className="min-w-0 whitespace-normal break-words">
                  {status === ALL_STATUSES
                    ? t("All statuses")
                    : formatLabel(status, t)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value={ALL_STATUSES}
                  className="min-h-11 whitespace-normal"
                >
                  {t("All statuses")}
                </SelectItem>
                {jobStatuses.map((jobStatus) => (
                  <SelectItem
                    key={jobStatus}
                    value={jobStatus}
                    className="min-h-11 whitespace-normal"
                  >
                    {formatLabel(jobStatus, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        {status !== ALL_STATUSES && (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
            <p className="min-w-0 break-words text-sm leading-5 [overflow-wrap:anywhere]">
              {t("Status")}: {employeeJobStatusLabel(status, t)}
            </p>
            <Button
              type="button"
              variant="ghost"
              className={`min-h-11 whitespace-normal px-2 ${employeeLanguageClasses(language, "", "h-auto py-2 leading-5")}`}
              onClick={clearStatusFilter}
            >
              {t("Clear status filter")}
            </Button>
          </div>
        )}

        {jobs.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card p-6 text-center sm:p-8">
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
          <div className="rounded-lg border border-dashed bg-card p-6 text-center sm:p-8">
            <p className="font-medium">
              {t("No jobs on this page match your search.")}
            </p>
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
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            {visibleJobs.map((job) => {
              const atm = getATM(job);
              return (
                <Card
                  key={job._id}
                  className="min-w-0 overflow-hidden rounded-lg shadow-none"
                >
                  <CardHeader className="space-y-2 p-4 pb-2">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-xs font-medium tracking-wide text-muted-foreground [overflow-wrap:anywhere]">
                          {job.jobNumber || job.jobId}
                        </p>
                      </div>
                      <Badge
                        variant={getStatusVariant(job.status)}
                        className="max-w-[52%] shrink-0 whitespace-normal text-center leading-4 [overflow-wrap:anywhere]"
                      >
                        {formatLabel(job.status, t)}
                      </Badge>
                    </div>
                    <CardTitle className="min-w-0 break-words text-base font-semibold leading-6 [overflow-wrap:anywhere]">
                      {job.title}
                    </CardTitle>
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="max-w-full break-words rounded-md bg-muted px-2 py-1 font-medium leading-5 text-foreground [overflow-wrap:anywhere]">
                        {employeeDisplayLabel(
                          formatJobWorkType(job.workType),
                          t,
                        )}
                      </span>
                      {job.workType === "ac" && job.acSubType && (
                        <span className="max-w-full break-words [overflow-wrap:anywhere]">
                          {employeeDisplayLabel(
                            formatAcSubType(job.acSubType),
                            t,
                          )}
                        </span>
                      )}
                      <Badge
                        variant={getPriorityVariant(job.priority)}
                        className="max-w-full whitespace-normal text-center leading-5 [overflow-wrap:anywhere]"
                      >
                        {formatLabel(job.priority, t)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-1">
                    <div className="min-w-0 border-t pt-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("ATM")}
                      </p>
                      <p className="mt-0.5 min-w-0 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                        {atm?.atmId || t("Not available")}
                      </p>
                      {atm?.locationName || atm?.address ? (
                        <div className="mt-2 min-w-0 space-y-1">
                          {atm.locationName && (
                            <p className="break-words text-sm leading-5 text-foreground [overflow-wrap:anywhere]">
                              {atm.locationName}
                            </p>
                          )}
                          {atm.address && atm.address !== atm.locationName && (
                            <p className="break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                              {atm.address}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 min-w-0 break-words text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                          {t("Location")}: {t("Not available")}
                        </p>
                      )}
                    </div>

                    {job.description && (
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t("Description")}
                        </p>
                        <p className="mt-1 line-clamp-3 break-words text-sm leading-5 text-foreground [overflow-wrap:anywhere]">
                          {job.description}
                        </p>
                      </div>
                    )}

                    {job.rejectionReason && (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
                        {job.rejectionReason}
                      </div>
                    )}

                    <div className="border-t pt-3">
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={t("View details for {job}", {
                          job: job.jobNumber || job.jobId,
                        })}
                        className={`min-h-11 w-full whitespace-normal ${employeeLanguageClasses(language, "", "h-auto py-2 leading-5")}`}
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
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 break-words text-sm text-muted-foreground">
            {t("Page {page} of {pages}", {
              page: pagination.page,
              pages: pagination.totalPages,
            })}
          </p>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal px-2 py-2 leading-5 sm:flex-none"
              onClick={() =>
                setPaginationState({
                  status: requestedStatus,
                  page: page - 1,
                })
              }
              disabled={page <= 1 || isFetching}
            >
              <ChevronLeft />
              {t("Previous")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal px-2 py-2 leading-5 sm:flex-none"
              onClick={() =>
                setPaginationState({
                  status: requestedStatus,
                  page: page + 1,
                })
              }
              disabled={page >= pagination.totalPages || isFetching}
            >
              {t("Next")}
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
      </div>
    </main>
  );
}
