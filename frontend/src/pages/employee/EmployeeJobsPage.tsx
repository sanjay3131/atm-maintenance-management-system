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
    <main className="bg-slate-100 p-3 sm:p-5">
      <div className="mx-auto max-w-[430px] space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white shadow-sm">
                <BriefcaseBusiness className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                  {t("My Jobs")}
                </p>
                <h1 className="text-xl font-bold text-slate-900">
                  {t("My Jobs")}
                </h1>
              </div>
            </div>
            <Badge className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
              {pagination?.total ?? 0}
            </Badge>
          </div>
        </header>

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              id="my-jobs-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Job ID, title, or ATM")}
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-700 outline-none ring-0 placeholder:text-slate-400 focus:border-blue-500"
            />
          </div>
          <div>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus((value as JobStatus | null) ?? ALL_STATUSES);
                setPage(1);
              }}
            >
              <SelectTrigger id="my-jobs-status" className="h-11 w-full rounded-xl border-slate-200 bg-slate-50 text-sm text-slate-700">
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
        <div className="space-y-4">
          {visibleJobs.map((job) => {
            const atm = getATM(job);
            return (
              <Card key={job._id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <CardHeader className="space-y-3 p-4 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                        {job.jobNumber || job.jobId}
                      </p>
                      <CardTitle className="mt-1 break-words text-base font-semibold text-slate-900">
                        {job.title}
                      </CardTitle>
                    </div>
                    <Badge
                      variant={getStatusVariant(job.status)}
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    >
                      {formatLabel(job.status, t)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">
                      {formatLabel(job.workType, t)}
                    </span>
                    <Badge
                      variant={getPriorityVariant(job.priority)}
                      className="rounded-full px-2 py-1 text-xs font-medium"
                    >
                      {formatLabel(job.priority, t)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 p-4 pt-0">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <span className="inline-flex size-6 items-center justify-center rounded-md bg-blue-100 text-blue-700">
                        {atm?.atmId ? "ATM" : "•"}
                      </span>
                      {atm?.atmId || t("Not available")}
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {atm?.locationName || `${t("Location")}: ${t("Not available")}`}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <div className="rounded-lg bg-white px-2 py-2">
                        <p className="font-medium text-slate-500">{t("District")}</p>
                        <p className="mt-1 text-slate-700">
                          {atm?.districtId || t("Not available")}
                        </p>
                      </div>
                      <div className="rounded-lg bg-white px-2 py-2">
                        <p className="font-medium text-slate-500">{t("Region")}</p>
                        <p className="mt-1 text-slate-700">
                          {atm?.regionId || t("Not available")}
                        </p>
                      </div>
                    </div>
                  </div>

                  {job.description && (
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                        {t("Description")}
                      </p>
                      <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-700">
                        {job.description}
                      </p>
                    </div>
                  )}

                  {job.rejectionReason && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800">
                      {job.rejectionReason}
                    </div>
                  )}

                  <div className="border-t border-slate-200 pt-3">
                    <Button
                      type="button"
                      className="min-h-11 w-full rounded-xl bg-blue-600 text-white hover:bg-blue-700"
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
      </div>
    </main>
  );
}
