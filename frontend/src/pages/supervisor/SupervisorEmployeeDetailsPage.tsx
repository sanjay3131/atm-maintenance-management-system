import { useState } from "react";
import { isAxiosError } from "axios";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  MapPin,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SkeletonBlock } from "@/features/dashboard/components/DashboardSkeleton";
import { useSupervisorEmployeeDetails } from "@/features/supervisor/hooks/useSupervisorEmployeeDetails";
import {
  formatAcSubType,
  formatJobWorkType,
} from "@/features/jobs/utils/jobWorkType.utils";
import {
  useSupervisorEmployeeAMC,
  useSupervisorEmployeeAttendance,
  useSupervisorEmployeeJobs,
} from "@/features/supervisor/hooks/useSupervisorEmployeeHistory";
import type {
  SupervisorEmployeeAMC,
  SupervisorAttendanceRecord,
  SupervisorEmployeeJob,
  SupervisorPagination,
} from "@/services/supervisor.service";

const PAGE_SIZE = 10;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const getBusinessMonth = () => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  return {
    month: Number(parts.find((part) => part.type === "month")?.value),
    year: Number(parts.find((part) => part.type === "year")?.value),
  };
};

const formatDate = (value?: string | null) => {
  if (!value) return "Not recorded";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    ...(dateOnly ? { timeZone: "UTC" } : { timeZone: "Asia/Kolkata" }),
  }).format(date);
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

const formatLabel = (value?: string | null) =>
  value
    ? value
        .toLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : "Status unavailable";

const getErrorMessage = (error: unknown) =>
  isAxiosError<{ message?: string }>(error)
    ? error.response?.data?.message || "The request could not be completed."
    : error instanceof Error
      ? error.message
      : "The request could not be completed.";

const getEmployeeName = (
  employee?: {
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null,
) =>
  employee?.name?.trim() ||
  [employee?.firstName, employee?.lastName].filter(Boolean).join(" ").trim() ||
  "Employee";

const statusVariant = (status?: string | null) => {
  if (["COMPLETED", "VERIFIED", "APPROVED", "CLOSED"].includes(status ?? "")) {
    return "secondary" as const;
  }
  if (["OVERDUE", "REJECTED", "CANCELLED"].includes(status ?? "")) {
    return "destructive" as const;
  }
  return "outline" as const;
};

function LoadingPanel({ label }: { label: string }) {
  return (
    <Card role="status" aria-label={`Loading ${label}`}>
      <CardHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
        <SkeletonBlock className="h-5 w-36" />
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
        <SkeletonBlock className="h-12 w-full" />
        <SkeletonBlock className="h-12 w-full" />
      </CardContent>
    </Card>
  );
}

function SectionError({
  title,
  error,
  retry,
  isFetching,
}: {
  title: string;
  error: unknown;
  retry: () => void;
  isFetching: boolean;
}) {
  return (
    <Card className="border-rose-200">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="alert">
          <p className="font-semibold text-rose-800">{title} unavailable</p>
          <p className="mt-1 text-sm text-slate-600">
            {getErrorMessage(error)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={retry}
          disabled={isFetching}
          className="min-h-11 shrink-0"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          {isFetching ? "Retrying..." : "Retry"}
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyPanel({ children }: { children: string }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-200 px-4 py-7 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}

function SectionPagination({
  pagination,
  page,
  setPage,
  isFetching,
}: {
  pagination?: SupervisorPagination;
  page: number;
  setPage: (page: number) => void;
  isFetching: boolean;
}) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
      <p className="text-xs text-slate-500">
        Page {pagination.page} of {pagination.totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10"
          onClick={() => setPage(Math.max(page - 1, 1))}
          disabled={page <= 1 || isFetching}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10"
          onClick={() => setPage(Math.min(page + 1, pagination.totalPages))}
          disabled={page >= pagination.totalPages || isFetching}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function AttendanceList({
  records,
}: {
  records: SupervisorAttendanceRecord[];
}) {
  if (!records.length) return <EmptyPanel>No attendance records found.</EmptyPanel>;
  return (
    <ul className="divide-y divide-slate-100">
      {records.map((record) => (
        <li
          key={record._id}
          className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <CalendarDays
              className="size-4 shrink-0 text-teal-700"
              aria-hidden="true"
            />
            {formatDate(record.attendanceDate)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <span>Check-in: {formatDateTime(record.checkInAt)}</span>
            <span>Check-out: {formatDateTime(record.checkOutAt)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function JobList({ jobs }: { jobs: SupervisorEmployeeJob[] }) {
  if (!jobs.length) return <EmptyPanel>No job history found.</EmptyPanel>;
  return (
    <ul className="space-y-3">
      {jobs.map((job) => (
        <li
          key={job._id}
          className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 sm:p-4"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">
                {job.title || job.jobNumber || job.jobId || "Maintenance job"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {[
                  job.jobNumber || job.jobId,
                  job.workType ? formatJobWorkType(job.workType) : undefined,
                  job.workType === "ac"
                    ? formatAcSubType(job.acSubType)
                    : undefined,
                  job.priority,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Job details unavailable"}
              </p>
            </div>
            <Badge variant={statusVariant(job.status)}>
              {formatLabel(job.status)}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5 text-teal-700" aria-hidden="true" />
              Scheduled: {formatDate(job.scheduledDate)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="size-3.5 text-teal-700" aria-hidden="true" />
              Completed: {formatDateTime(job.completedAt)}
            </span>
            {job.atm && (
              <span className="inline-flex min-w-0 items-center gap-1.5 sm:col-span-2">
                <MapPin className="size-3.5 shrink-0 text-teal-700" aria-hidden="true" />
                <span className="truncate">
                  {[job.atm.atmId, job.atm.locationName, job.atm.address]
                    .filter(Boolean)
                    .join(" · ") || "ATM details unavailable"}
                </span>
              </span>
            )}
          </div>
          {job.completionEvidence?.employeeRemarks && (
            <p className="mt-3 border-t border-slate-200 pt-3 text-sm leading-5 text-slate-600">
              {job.completionEvidence.employeeRemarks}
            </p>
          )}
          {job.completionEvidence && (
            <p className="mt-2 text-xs text-slate-500">
              Completion photos:{" "}
              {(job.completionEvidence.beforePhotos?.length ?? 0) +
                (job.completionEvidence.afterPhotos?.length ?? 0)}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function AmcList({ amcs }: { amcs: SupervisorEmployeeAMC[] }) {
  if (!amcs.length) return <EmptyPanel>No AMC records for this month.</EmptyPanel>;
  return (
    <ul className="space-y-3">
      {amcs.map((amc) => (
        <li
          key={amc._id}
          className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 sm:p-4"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold text-slate-900">
                {amc.atm?.locationName || amc.atm?.atmId || amc.amcId || "AMC visit"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {amc.amcId || `Period ${amc.month}/${amc.year}`}
              </p>
            </div>
            <Badge variant={statusVariant(amc.status)}>
              {formatLabel(amc.status)}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5 text-teal-700" aria-hidden="true" />
              Visit: {formatDate(amc.visitDate)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="size-3.5 text-teal-700" aria-hidden="true" />
              Deadline: {formatDate(amc.deadlineDate)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ClipboardCheck className="size-3.5 text-teal-700" aria-hidden="true" />
              Checklist:{" "}
              {amc.checklistCompleted
                ? "Complete"
                : `${amc.checklist?.length ?? 0} items`}
            </span>
            <span>Evidence photos: {amc.photoCount ?? amc.photos?.length ?? 0}</span>
          </div>
          {amc.employeeRemarks && (
            <p className="mt-3 border-t border-slate-200 pt-3 text-sm leading-5 text-slate-600">
              {amc.employeeRemarks}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function SupervisorEmployeeDetailsPage() {
  const { employeeId = "" } = useParams();
  const isValidEmployeeId = OBJECT_ID_PATTERN.test(employeeId);
  const [attendancePage, setAttendancePage] = useState(1);
  const [jobsPage, setJobsPage] = useState(1);
  const [amcPage, setAmcPage] = useState(1);
  const currentPeriod = getBusinessMonth();
  const [amcMonth, setAmcMonth] = useState(currentPeriod.month);
  const [amcYear, setAmcYear] = useState(currentPeriod.year);

  const employeeQuery = useSupervisorEmployeeDetails(
    employeeId,
    isValidEmployeeId,
  );
  const canLoadHistory =
    isValidEmployeeId &&
    employeeQuery.isFetchedAfterMount &&
    employeeQuery.isSuccess &&
    Boolean(employeeQuery.data);
  const historyIdentity = { employeeId, limit: PAGE_SIZE };
  const attendanceQuery = useSupervisorEmployeeAttendance(
    { ...historyIdentity, page: attendancePage },
    canLoadHistory,
  );
  const jobsQuery = useSupervisorEmployeeJobs(
    { ...historyIdentity, page: jobsPage },
    canLoadHistory,
  );
  const amcQuery = useSupervisorEmployeeAMC(
    {
      ...historyIdentity,
      page: amcPage,
      month: amcMonth,
      year: amcYear,
    },
    canLoadHistory,
  );

  const employee = employeeQuery.data?.employee;
  const assignedAtms =
    employeeQuery.data?.assignedAtms ?? employee?.assignedAtms ?? [];
  const employeeName = getEmployeeName(employee);

  if (!isValidEmployeeId) {
    return (
      <div className="space-y-5">
        <BackLink />
        <Card className="border-rose-200">
          <CardContent className="p-5" role="alert">
            <h2 className="font-semibold text-rose-800">Invalid employee</h2>
            <p className="mt-1 text-sm text-slate-600">
              The employee reference in this link is not valid.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (
    employeeQuery.isLoading ||
    (!employeeQuery.isFetchedAfterMount && employeeQuery.isFetching)
  ) {
    return (
      <div className="space-y-5">
        <BackLink />
        <div role="status" aria-label="Loading employee details">
          <SkeletonBlock className="h-28 rounded-xl" />
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <LoadingPanel label="attendance" />
            <LoadingPanel label="job history" />
            <LoadingPanel label="AMC history" />
          </div>
        </div>
      </div>
    );
  }

  if (employeeQuery.isError || !employee) {
    const isUnavailable =
      isAxiosError(employeeQuery.error) &&
      [403, 404].includes(employeeQuery.error.response?.status ?? 0);
    return (
      <div className="space-y-5">
        <BackLink />
        <Card className="border-rose-200">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div role="alert">
              <h2 className="font-semibold text-rose-800">
                {isUnavailable
                  ? "Employee is unavailable"
                  : "Could not load employee details"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {isUnavailable
                  ? "This employee may no longer be assigned to you."
                  : getErrorMessage(employeeQuery.error)}
              </p>
            </div>
            {!isUnavailable && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void employeeQuery.refetch()}
                disabled={employeeQuery.isFetching}
                className="min-h-11 shrink-0"
              >
                Retry
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <Card className="overflow-hidden border-blue-100 shadow-sm">
        <div className="h-1.5 bg-gradient-to-r from-blue-700 to-teal-500" />
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-800">
                <UserRound className="size-6" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">
                  Employee profile
                </p>
                <h2 className="mt-1 break-words text-2xl font-bold tracking-tight text-slate-950">
                  {employeeName}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {employee.employeeCode || "Employee code unavailable"}
                  {employee.designation ? ` · ${employee.designation}` : ""}
                </p>
              </div>
            </div>
            <Badge variant={statusVariant(employee.status)}>
              {formatLabel(employee.status)}
            </Badge>
          </div>
          <dl className="mt-5 grid gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {employee.email && (
              <div className="min-w-0">
                <dt className="text-xs font-medium text-slate-500">Email</dt>
                <dd className="mt-1 break-all font-medium text-slate-800">
                  {employee.email}
                </dd>
              </div>
            )}
            {employee.phoneNumber && (
              <div>
                <dt className="text-xs font-medium text-slate-500">Phone</dt>
                <dd className="mt-1 font-medium text-slate-800">
                  {employee.phoneNumber}
                </dd>
              </div>
            )}
            {employee.department && (
              <div>
                <dt className="text-xs font-medium text-slate-500">Department</dt>
                <dd className="mt-1 font-medium text-slate-800">
                  {employee.department}
                </dd>
              </div>
            )}
            {employee.employmentType && (
              <div>
                <dt className="text-xs font-medium text-slate-500">
                  Employment type
                </dt>
                <dd className="mt-1 font-medium text-slate-800">
                  {formatLabel(employee.employmentType)}
                </dd>
              </div>
            )}
            {employee.joiningDate && (
              <div>
                <dt className="text-xs font-medium text-slate-500">
                  Joining date
                </dt>
                <dd className="mt-1 font-medium text-slate-800">
                  {formatDate(employee.joiningDate)}
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            Profile details reflect fields currently available from the
            supervisor API.
          </p>
        </CardContent>
      </Card>

      <section aria-labelledby="assigned-atms-title">
        <Card>
          <CardHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
            <CardTitle id="assigned-atms-title" className="text-base">
              Assigned ATMs
              <span className="ml-2 text-sm font-normal text-slate-500">
                {assignedAtms.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 sm:px-5 sm:pb-5">
            {assignedAtms.length === 0 ? (
              <EmptyPanel>No active ATM assignments found.</EmptyPanel>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {assignedAtms.map((atm) => (
                  <li
                    key={atm._id}
                    className="flex min-w-0 gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3"
                  >
                    <MapPin
                      className="mt-0.5 size-4 shrink-0 text-teal-700"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {atm.locationName || atm.atmId || "ATM location unavailable"}
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-600">
                        {[atm.atmId, atm.address].filter(Boolean).join(" · ") ||
                          "Address unavailable"}
                      </p>
                      {atm.status && (
                        <p className="mt-1 text-xs text-slate-500">
                          {formatLabel(atm.status)}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <section aria-labelledby="attendance-title" className="min-w-0">
          <Card>
            <CardHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
              <CardTitle id="attendance-title" className="text-base">
                Attendance history
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
              {attendanceQuery.isLoading ? (
                <div role="status" aria-label="Loading attendance">
                  <SkeletonBlock className="h-16 w-full" />
                  <SkeletonBlock className="mt-3 h-16 w-full" />
                </div>
              ) : attendanceQuery.isError && !attendanceQuery.data ? (
                <SectionError
                  title="Attendance history"
                  error={attendanceQuery.error}
                  retry={() => void attendanceQuery.refetch()}
                  isFetching={attendanceQuery.isFetching}
                />
              ) : (
                <>
                  {attendanceQuery.isError && (
                    <p role="alert" className="text-sm text-rose-700">
                      Refresh failed; showing the last loaded records.
                    </p>
                  )}
                  <AttendanceList
                    records={attendanceQuery.data?.records ?? []}
                  />
                  <SectionPagination
                    pagination={attendanceQuery.data?.pagination}
                    page={attendancePage}
                    setPage={setAttendancePage}
                    isFetching={attendanceQuery.isFetching}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="jobs-title" className="min-w-0">
          <Card>
            <CardHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
              <CardTitle id="jobs-title" className="text-base">
                Job history
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
              {jobsQuery.isLoading ? (
                <div role="status" aria-label="Loading job history">
                  <SkeletonBlock className="h-28 w-full" />
                  <SkeletonBlock className="mt-3 h-28 w-full" />
                </div>
              ) : jobsQuery.isError && !jobsQuery.data ? (
                <SectionError
                  title="Job history"
                  error={jobsQuery.error}
                  retry={() => void jobsQuery.refetch()}
                  isFetching={jobsQuery.isFetching}
                />
              ) : (
                <>
                  {jobsQuery.isError && (
                    <p role="alert" className="text-sm text-rose-700">
                      Refresh failed; showing the last loaded records.
                    </p>
                  )}
                  <JobList jobs={jobsQuery.data?.jobs ?? []} />
                  <SectionPagination
                    pagination={jobsQuery.data?.pagination}
                    page={jobsPage}
                    setPage={setJobsPage}
                    isFetching={jobsQuery.isFetching}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="amc-title" className="min-w-0 xl:col-span-2">
          <Card>
            <CardHeader className="flex flex-col gap-3 px-4 pb-3 pt-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pt-5">
              <CardTitle id="amc-title" className="text-base">
                AMC history
              </CardTitle>
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="amc-month">
                  AMC month
                </label>
                <select
                  id="amc-month"
                  value={amcMonth}
                  onChange={(event) => {
                    setAmcMonth(Number(event.target.value));
                    setAmcPage(1);
                  }}
                  className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  {Array.from({ length: 12 }, (_, index) => index + 1).map(
                    (month) => (
                      <option key={month} value={month}>
                        {new Intl.DateTimeFormat("en-IN", {
                          month: "long",
                        }).format(new Date(2020, month - 1, 1))}
                      </option>
                    ),
                  )}
                </select>
                <label className="sr-only" htmlFor="amc-year">
                  AMC year
                </label>
                <select
                  id="amc-year"
                  value={amcYear}
                  onChange={(event) => {
                    setAmcYear(Number(event.target.value));
                    setAmcPage(1);
                  }}
                  className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  {[currentPeriod.year, currentPeriod.year - 1].map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
              {amcQuery.isLoading ? (
                <div role="status" aria-label="Loading AMC history">
                  <SkeletonBlock className="h-28 w-full" />
                  <SkeletonBlock className="mt-3 h-28 w-full" />
                </div>
              ) : amcQuery.isError && !amcQuery.data ? (
                <SectionError
                  title="AMC history"
                  error={amcQuery.error}
                  retry={() => void amcQuery.refetch()}
                  isFetching={amcQuery.isFetching}
                />
              ) : (
                <>
                  {amcQuery.isError && (
                    <p role="alert" className="text-sm text-rose-700">
                      Refresh failed; showing the last loaded records.
                    </p>
                  )}
                  {amcQuery.data && (
                    <p className="text-sm text-slate-600">
                      {amcQuery.data.statusCounts.total} records ·{" "}
                      {amcQuery.data.statusCounts.COMPLETED ?? 0} completed
                    </p>
                  )}
                  <AmcList amcs={amcQuery.data?.amcs ?? []} />
                  <SectionPagination
                    pagination={amcQuery.data?.pagination}
                    page={amcPage}
                    setPage={setAmcPage}
                    isFetching={amcQuery.isFetching}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/supervisor/employees"
      className={buttonVariants({
        variant: "ghost",
        className: "-ml-2 min-h-11 text-slate-600",
      })}
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to employees
    </Link>
  );
}
