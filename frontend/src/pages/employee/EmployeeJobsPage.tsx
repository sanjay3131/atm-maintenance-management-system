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
];

function formatLabel(value?: string) {
  if (!value) return "Not available";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

function formatScheduledDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function getRecurringMaintenanceLabel(
  maintenanceType: "DAILY_CLEANING" | "WEEKLY_MOPPING",
) {
  return maintenanceType === "DAILY_CLEANING"
    ? "Daily Cleaning"
    : "Weekly Mopping";
}

function getStatusVariant(status: JobStatus) {
  if (status === "REJECTED") return "destructive" as const;
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

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Could not load your jobs.";
  }
  return error instanceof Error ? error.message : "Could not load your jobs.";
}

function JobsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2" role="status">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="h-52 animate-pulse rounded-lg border bg-muted/40"
        />
      ))}
      <p className="sr-only">Loading your jobs...</p>
    </div>
  );
}

export default function EmployeeJobsPage() {
  const navigate = useNavigate();
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
        <div className="h-9 animate-pulse rounded-lg bg-muted" />
        <JobsSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <main className="p-4 sm:p-6">
        <h1 className="text-2xl font-bold">My Jobs</h1>
        <div className="mt-6 max-w-xl rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <p className="font-medium text-destructive">
            Could not load your jobs.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {getErrorMessage(error)}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? "Retrying..." : "Retry"}
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
          <h1 className="text-2xl font-bold">My Jobs</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {pagination?.total ?? 0} assigned job(s)
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="my-jobs-search"
            className="mb-2 block text-sm font-medium"
          >
            Search this page
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="my-jobs-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Job ID, title, or ATM"
              className="h-9 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium">Status</label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus((value as JobStatus | null) ?? ALL_STATUSES);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
              {jobStatuses.map((jobStatus) => (
                <SelectItem key={jobStatus} value={jobStatus}>
                  {formatLabel(jobStatus)}
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
              ? "No jobs assigned yet."
              : "No jobs found for this status."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Assigned jobs will appear here.
          </p>
        </div>
      ) : visibleJobs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">No jobs on this page match your search.</p>
          <Button
            type="button"
            variant="link"
            className="mt-2"
            onClick={() => setSearch("")}
          >
            Clear search
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
                      {formatLabel(job.status)}
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
                        Returned for rework
                      </p>
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        {job.rejectionReason}
                      </p>
                    </div>
                  )}
                  {job.recurringMaintenance?.source === "RECURRING" && (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">Recurring</Badge>
                        <span className="text-sm font-medium">
                          {getRecurringMaintenanceLabel(
                            job.recurringMaintenance.maintenanceType,
                          )}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Scheduled:{" "}
                        {formatScheduledDate(
                          job.recurringMaintenance.scheduledDate,
                        )}
                      </p>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">ATM</p>
                      <p className="break-words font-medium">
                        {atm?.atmId || "Not available"}
                      </p>
                      {atm?.locationName && (
                        <p className="break-words text-xs text-muted-foreground">
                          {atm.locationName}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Work type</p>
                      <p className="font-medium">{formatLabel(job.workType)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Priority</p>
                      <Badge variant={getPriorityVariant(job.priority)}>
                        {formatLabel(job.priority)}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Created</p>
                      <p className="font-medium">{formatDate(job.createdAt)}</p>
                    </div>
                    {job.assignedAt && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground">
                          Assigned
                        </p>
                        <p className="font-medium">
                          {formatDate(job.assignedAt)}
                        </p>
                      </div>
                    )}
                  </div>
                  {job.isReassigned && (
                    <Badge variant="outline">Reassigned</Badge>
                  )}
                  <div className="border-t pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={() => navigate(`/employee/jobs/${job._id}`)}
                    >
                      View details
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
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => current - 1)}
              disabled={page <= 1 || isFetching}
            >
              <ChevronLeft />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => current + 1)}
              disabled={page >= pagination.totalPages || isFetching}
            >
              Next
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
