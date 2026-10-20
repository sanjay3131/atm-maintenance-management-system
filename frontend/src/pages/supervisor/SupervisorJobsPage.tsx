import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import {
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonBlock } from "@/features/dashboard/components/DashboardSkeleton";
import { useSupervisorJobs } from "@/features/supervisor/hooks/useSupervisorJobs";
import {
  formatSupervisorJobLabel,
  isSupervisorJobDateRangeValid,
  SUPERVISOR_JOB_STATUSES,
} from "@/features/supervisor/supervisorJobs.utils";
import type {
  SupervisorEmployeeJob,
  SupervisorJobStatus,
} from "@/services/supervisor.service";

const PAGE_SIZE = 20;

const formatDate = (value?: string | null) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

const statusVariant = (status: SupervisorJobStatus) => {
  if (["COMPLETED", "VERIFIED", "APPROVED", "CLOSED"].includes(status)) {
    return "secondary" as const;
  }
  if (["REJECTED", "CANCELLED"].includes(status)) {
    return "destructive" as const;
  }
  return "outline" as const;
};

const employeeName = (job: SupervisorEmployeeJob) =>
  job.employee?.name?.trim() || "Employee unavailable";

const getErrorMessage = (error: unknown) =>
  isAxiosError<{ message?: string }>(error)
    ? error.response?.data?.message ||
      "Jobs could not be loaded. Please try again."
    : error instanceof Error
      ? error.message
      : "Jobs could not be loaded. Please try again.";

function JobsSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading jobs">
      {Array.from({ length: 5 }, (_, index) => (
        <SkeletonBlock key={index} className="h-32 rounded-xl" />
      ))}
    </div>
  );
}

function JobCard({ job }: { job: SupervisorEmployeeJob }) {
  return (
    <Card className="border-slate-200 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-800">
            <BriefcaseBusiness className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <Link
              to={`/supervisor/jobs/${job._id}`}
              className="font-semibold text-slate-900 hover:text-blue-800 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {job.jobNumber || job.jobId || "Job reference unavailable"}
            </Link>
            <p className="mt-1 break-words text-sm font-medium text-slate-700">
              {job.title || "Untitled job"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(job.status)}>
                {formatSupervisorJobLabel(job.status)}
              </Badge>
              {job.priority && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {formatSupervisorJobLabel(job.priority)} priority
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600 sm:grid-cols-2 lg:min-w-[22rem] lg:border-0 lg:pt-1">
          <p className="truncate">
            <span className="font-medium text-slate-800">Employee: </span>
            {employeeName(job)}
          </p>
          <p className="truncate">
            <span className="font-medium text-slate-800">ATM: </span>
            {job.atm?.atmId || job.atm?.locationName || "Not available"}
          </p>
          <p>
            <span className="font-medium text-slate-800">Type: </span>
            {job.workType ? formatSupervisorJobLabel(job.workType) : "Not available"}
          </p>
          <p>
            <span className="font-medium text-slate-800">
              {job.scheduledDate ? "Scheduled: " : "Created: "}
            </span>
            {formatDate(job.scheduledDate || job.createdAt)}
          </p>
          <Link
            to={`/supervisor/jobs/${job._id}`}
            className={`${buttonVariants({
              variant: "outline",
              size: "sm",
            })} min-h-10 sm:col-span-2 lg:justify-self-end`}
          >
            View job details
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SupervisorJobsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SupervisorJobStatus | "">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const dateRangeInvalid = !isSupervisorJobDateRangeValid(fromDate, toDate);
  const jobsQuery = useSupervisorJobs(
    {
      page,
      limit: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
    },
    !dateRangeInvalid,
  );
  const jobs =
    jobsQuery.isFetchedAfterMount &&
    jobsQuery.isSuccess &&
    !jobsQuery.isError &&
    !jobsQuery.isFetching
    ? jobsQuery.data?.jobs
    : undefined;
  const pagination =
    jobsQuery.isFetchedAfterMount &&
    jobsQuery.isSuccess &&
    !jobsQuery.isError &&
    !jobsQuery.isFetching
    ? jobsQuery.data?.pagination
    : undefined;

  const resetFilters = () => {
    setSearchInput("");
    setSearch("");
    setStatus("");
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
            Read-only monitoring
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Job monitoring
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Review jobs currently assigned to employees on your team.
          </p>
        </div>
        {pagination && (
          <p className="text-sm font-medium text-slate-600">
            {pagination.total.toLocaleString("en-IN")}{" "}
            {pagination.total === 1 ? "job" : "jobs"}
          </p>
        )}
      </header>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
              placeholder="Search job number or title"
              aria-label="Search jobs"
              className="min-h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="sr-only" htmlFor="supervisor-job-status">
              Filter by job status
            </label>
            <select
              id="supervisor-job-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as SupervisorJobStatus | "");
                setPage(1);
              }}
              className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">All statuses</option>
              {SUPERVISOR_JOB_STATUSES.map((jobStatus) => (
                <option key={jobStatus} value={jobStatus}>
                  {formatSupervisorJobLabel(jobStatus)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium text-slate-500"
              htmlFor="supervisor-jobs-from"
            >
              From date
            </label>
            <input
              id="supervisor-jobs-from"
              type="date"
              value={fromDate}
              onChange={(event) => {
                setFromDate(event.target.value);
                setPage(1);
              }}
              className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium text-slate-500"
              htmlFor="supervisor-jobs-to"
            >
              To date
            </label>
            <input
              id="supervisor-jobs-to"
              type="date"
              value={toDate}
              onChange={(event) => {
                setToDate(event.target.value);
                setPage(1);
              }}
              className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {dateRangeInvalid && (
            <p className="text-sm text-rose-700 sm:col-span-2 lg:col-span-5" role="alert">
              The start date must be on or before the end date.
            </p>
          )}
        </CardContent>
      </Card>

      {jobsQuery.isFetching && (
        <JobsSkeleton />
      )}

      {jobsQuery.isError && (
        <Card className="border-rose-200">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div role="alert">
              <p className="font-semibold text-rose-800">
                Could not load supervisor jobs
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {getErrorMessage(jobsQuery.error)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void jobsQuery.refetch()}
              disabled={jobsQuery.isFetching || dateRangeInvalid}
              className="min-h-11 shrink-0"
            >
              {jobsQuery.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      )}

      {jobs && jobs.length > 0 && (
        <section aria-label="Supervisor jobs" className="space-y-3">
          {jobs.map((job) => (
            <JobCard key={job._id} job={job} />
          ))}
        </section>
      )}

      {jobs && jobs.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center px-5 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-700">
              <BriefcaseBusiness className="size-6" aria-hidden="true" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">
              No jobs found
            </h3>
            <p className="mt-1 max-w-md text-sm text-slate-600">
              {search || status || fromDate || toDate
                ? "Try adjusting or clearing your filters."
                : "Jobs currently assigned to your team will appear here."}
            </p>
            {(search || status || fromDate || toDate) && (
              <Button
                type="button"
                variant="ghost"
                onClick={resetFilters}
                className="mt-3 min-h-11"
              >
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1 || jobsQuery.isFetching}
              className="min-h-11 flex-1 sm:flex-none"
            >
              <ChevronLeft aria-hidden="true" />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setPage(Math.min(pagination.totalPages, page + 1))
              }
              disabled={
                page >= pagination.totalPages || jobsQuery.isFetching
              }
              className="min-h-11 flex-1 sm:flex-none"
            >
              Next
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
