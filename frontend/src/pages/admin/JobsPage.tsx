import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  UserRoundPlus,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import CreateJobForm from "@/features/jobs/components/CreateJobForm";
import AssignJobDialog from "@/features/jobs/components/AssignJobDialog";
import { useJobs } from "@/features/jobs/hooks/useJobs";
import type {
  Job,
  JobPriority,
  JobStatus,
  JobWorkType,
} from "@/features/jobs/types/job.types";

const ALL = "ALL";
const PAGE_SIZE = 10;

interface CreateJobContext {
  atmId: string;
  complaintId: string;
  title?: string;
  description?: string;
}

function getCreateJobContext(state: unknown): CreateJobContext | null {
  if (typeof state !== "object" || state === null) return null;

  const context = (state as Record<string, unknown>).createJobContext;
  if (typeof context !== "object" || context === null) return null;

  const { atmId, complaintId, title, description } = context as Record<
    string,
    unknown
  >;
  return typeof atmId === "string" && typeof complaintId === "string"
    ? {
        atmId,
        complaintId,
        ...(typeof title === "string" ? { title } : {}),
        ...(typeof description === "string" ? { description } : {}),
      }
    : null;
}

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

const priorities: JobPriority[] = ["low", "medium", "high", "critical"];
const workTypes: JobWorkType[] = [
  "repair",
  "maintenance",
  "installation",
  "inspection",
  "emergency",
];

function formatLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
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

function getATM(job: Job) {
  return typeof job.atmId === "object" ? job.atmId : null;
}

function getEmployeeName(job: Job) {
  if (!job.assignedEmployeeId) return "Unassigned";
  if (typeof job.assignedEmployeeId === "string") {
    return "Employee details unavailable";
  }

  const name = [
    job.assignedEmployeeId.firstName,
    job.assignedEmployeeId.lastName,
  ]
    .filter(Boolean)
    .join(" ");

  return name || "Employee details unavailable";
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

function JobsTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border" role="status">
      <div className="h-11 animate-pulse border-b bg-muted/50" />
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-4 gap-4 border-b px-4 py-4 last:border-0 md:grid-cols-9"
        >
          {Array.from({ length: 9 }, (_, cellIndex) => (
            <div
              key={cellIndex}
              className="h-4 animate-pulse rounded bg-muted"
            />
          ))}
        </div>
      ))}
      <p className="sr-only">Loading jobs...</p>
    </div>
  );
}

export default function JobsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationContext = getCreateJobContext(location.state);
  const [createJobContext, setCreateJobContext] =
    useState<CreateJobContext | null>(navigationContext);
  const consumedNavigationContext = useRef(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<JobStatus | typeof ALL>(ALL);
  const [priority, setPriority] = useState<JobPriority | typeof ALL>(ALL);
  const [workType, setWorkType] = useState<JobWorkType | typeof ALL>(ALL);
  const [page, setPage] = useState(1);
  const [isCreateDialogOpen, setIsCreateDialogOpen] =
    useState(Boolean(navigationContext));
  const [jobToAssign, setJobToAssign] = useState<Job | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (!navigationContext || consumedNavigationContext.current) return;
    consumedNavigationContext.current = true;

    const nextState =
      typeof location.state === "object" && location.state !== null
        ? { ...(location.state as Record<string, unknown>) }
        : {};
    delete nextState.createJobContext;

    navigate(
      `${location.pathname}${location.search}${location.hash}`,
      {
        replace: true,
        state: Object.keys(nextState).length > 0 ? nextState : null,
      },
    );
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
    navigationContext,
  ]);

  const { data, isLoading, isError, refetch, isFetching } = useJobs({
    page,
    limit: PAGE_SIZE,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(status !== ALL ? { status } : {}),
    ...(priority !== ALL ? { priority } : {}),
    ...(workType !== ALL ? { workType } : {}),
  });

  const jobs = data?.jobs ?? [];
  const pagination = data?.pagination;
  const hasActiveFilters =
    Boolean(search.trim()) ||
    status !== ALL ||
    priority !== ALL ||
    workType !== ALL;

  const resetPage = () => setPage(1);
  const closeCreateDialog = () => {
    setIsCreateDialogOpen(false);
    setCreateJobContext(null);
  };
  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setStatus(ALL);
    setPriority(ALL);
    setWorkType(ALL);
    resetPage();
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6" role="status">
        <div>
          <div className="h-8 w-36 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-64 animate-pulse rounded bg-muted" />
        </div>
        <JobsTableSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Jobs</h1>
        <div className="mt-6 max-w-2xl rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <p className="font-medium text-destructive">Failed to load jobs.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Please try again.
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
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Jobs</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {pagination?.total ?? 0} total jobs
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setCreateJobContext(null);
            setIsCreateDialogOpen(true);
          }}
        >
          <Plus />
          Create Job
        </Button>
      </div>

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsCreateDialogOpen(true);
          } else {
            closeCreateDialog();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogTitle>Create Job</DialogTitle>
          <DialogDescription className="mt-1">
            Add a job for an ATM location.
          </DialogDescription>
          {isCreateDialogOpen && (
            <CreateJobForm
              initialAtmId={createJobContext?.atmId}
              initialComplaintId={createJobContext?.complaintId}
              initialTitle={createJobContext?.title}
              initialDescription={createJobContext?.description}
              onCancel={closeCreateDialog}
              onCreated={() => {
                closeCreateDialog();
                clearFilters();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {jobToAssign && (
        <AssignJobDialog
          job={jobToAssign}
          onClose={() => setJobToAssign(null)}
        />
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="md:col-span-2">
          <label
            htmlFor="jobs-search"
            className="mb-2 block text-sm font-medium"
          >
            Search jobs
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="jobs-search"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetPage();
              }}
              placeholder="Job ID or title"
              className="h-9 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">Status</label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus((value as JobStatus | null) ?? ALL);
              resetPage();
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {jobStatuses.map((jobStatus) => (
                <SelectItem key={jobStatus} value={jobStatus}>
                  {formatLabel(jobStatus)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">Priority</label>
          <Select
            value={priority}
            onValueChange={(value) => {
              setPriority((value as JobPriority | null) ?? ALL);
              resetPage();
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All priorities</SelectItem>
              {priorities.map((jobPriority) => (
                <SelectItem key={jobPriority} value={jobPriority}>
                  {formatLabel(jobPriority)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">Work type</label>
          <Select
            value={workType}
            onValueChange={(value) => {
              setWorkType((value as JobWorkType | null) ?? ALL);
              resetPage();
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All work types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All work types</SelectItem>
              {workTypes.map((jobWorkType) => (
                <SelectItem key={jobWorkType} value={jobWorkType}>
                  {formatLabel(jobWorkType)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {hasActiveFilters && (
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              onClick={clearFilters}
              className="w-full md:w-auto"
            >
              Clear filters
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Job list</CardTitle>
            {pagination && pagination.totalPages > 0 && (
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Job ID</th>
                  <th className="px-4 py-3 text-left font-medium">Title</th>
                  <th className="px-4 py-3 text-left font-medium">ATM</th>
                  <th className="px-4 py-3 text-left font-medium">
                    Assigned employee
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Work type</th>
                  <th className="px-4 py-3 text-left font-medium">Priority</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Created</th>
                  <th className="px-4 py-3 text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                    >
                      {hasActiveFilters
                        ? "No jobs match these filters."
                        : "No jobs have been created yet."}
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => {
                    const atm = getATM(job);

                    return (
                      <tr key={job._id} className="border-b last:border-0">
                        <td className="whitespace-nowrap px-4 py-3 font-medium">
                          <Link
                            to={`/admin/jobs/${job._id}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {job.jobNumber || job.jobId}
                          </Link>
                        </td>
                        <td className="min-w-44 px-4 py-3">
                          <div>{job.title}</div>
                          {job.recurringMaintenance?.source === "RECURRING" && (
                            <div className="mt-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="secondary">Recurring</Badge>
                                <span className="text-xs text-muted-foreground">
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
                        </td>
                        <td className="min-w-36 px-4 py-3">
                          <div>{atm?.atmId || "ATM unavailable"}</div>
                          {atm?.locationName && (
                            <div className="text-xs text-muted-foreground">
                              {atm.locationName}
                            </div>
                          )}
                        </td>
                        <td className="min-w-40 px-4 py-3">
                          {getEmployeeName(job)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {formatLabel(job.workType)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={getPriorityVariant(job.priority)}>
                            {formatLabel(job.priority)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={getStatusVariant(job.status)}>
                            {formatLabel(job.status)}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {formatDate(job.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          {(job.status === "PENDING" ||
                            job.status === "REJECTED") && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setJobToAssign(job)}
                            >
                              <UserRoundPlus />
                              {job.status === "REJECTED" ? "Reassign" : "Assign"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {pagination.total} jobs
              </p>
              <div className="flex items-center gap-2">
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
        </CardContent>
      </Card>
    </div>
  );
}
