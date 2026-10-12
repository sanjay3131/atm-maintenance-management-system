import { useState } from "react";
import { isAxiosError } from "axios";
import { CalendarDays, Pencil, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useAdminAttendanceDashboard,
  useAttendanceStatusOverrideAudit,
  useSetAttendanceStatusOverride,
} from "@/features/attendance/hooks/useAdminAttendance";
import type {
  AdminAttendanceDashboardRecord,
  AdminAttendanceStatus,
  AttendanceStatusOverrideAuditEvent,
} from "@/services/attendance.service";

const BUSINESS_TIME_ZONE = "Asia/Kolkata";
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const AUDIT_PAGE_SIZE = 20;
const STATUS_OPTIONS: Array<{
  value: "all" | AdminAttendanceStatus;
  label: string;
}> = [
  { value: "all", label: "All statuses" },
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "incomplete", label: "Incomplete" },
  { value: "unrecorded", label: "Unrecorded" },
];

function getBusinessDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function formatBusinessTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: BUSINESS_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || name === "Unknown employee") return "?";
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase())
    .join("");
}

function getStatusLabel(status: AdminAttendanceStatus) {
  return status.charAt(0).toLocaleUpperCase() + status.slice(1);
}

function getStatusVariant(
  status: AdminAttendanceStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "present") return "default";
  if (status === "absent") return "destructive";
  if (status === "incomplete") return "secondary";
  return "outline";
}

function getOriginLabel(origin: AdminAttendanceDashboardRecord["attendance"]["statusOrigin"]) {
  if (origin === "admin_override") return "Admin override";
  if (origin === "no_record") return "No attendance record";
  return "Recorded";
}

function getErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function SummaryCard({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4 sm:p-5">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Users aria-hidden="true" className="size-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function Avatar({ record }: { record: AdminAttendanceDashboardRecord }) {
  const { name, avatarUrl } = record.employee;
  return (
    <div
      className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground"
      aria-label={`${name} profile`}
    >
      <span aria-hidden="true">{getInitials(name)}</span>
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      )}
    </div>
  );
}

function AttendanceStatusDialog({
  record,
  selectedDate,
  open,
  onOpenChange,
}: {
  record: AdminAttendanceDashboardRecord | null;
  selectedDate: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [status, setStatus] = useState<"" | "present" | "absent">("");
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const overrideMutation = useSetAttendanceStatusOverride();
  const auditQuery = useAttendanceStatusOverrideAudit(
    open ? record?.employee.id ?? null : null,
    selectedDate,
    auditPage,
    AUDIT_PAGE_SIZE,
  );
  const auditPagination = auditQuery.data?.pagination;
  const auditTotalPages = Math.max(1, auditPagination?.totalPages ?? 1);

  const close = (nextOpen: boolean) => {
    if (overrideMutation.isPending) return;
    if (!nextOpen) {
      setStatus("");
      setReason("");
      setValidationError("");
    }
    onOpenChange(nextOpen);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!record || (status !== "present" && status !== "absent")) {
      setValidationError("Choose Present or Absent.");
      return;
    }
    if (!reason.trim()) {
      setValidationError("A reason is required.");
      return;
    }
    setValidationError("");
    try {
      await overrideMutation.mutateAsync({
        employeeId: record.employee.id,
        attendanceDate: selectedDate,
        status,
        reason: reason.trim(),
      });
      toast.success("Attendance status updated.");
      close(false);
    } catch (error) {
      setValidationError(
        getErrorMessage(error, "Unable to update attendance status."),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {record && (
          <>
            <DialogTitle>Edit Attendance Status</DialogTitle>
            <DialogDescription>
              {record.employee.name} · {record.employee.employeeCode ?? "Employee code unavailable"} · {selectedDate}
            </DialogDescription>

            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p>
                Recorded check-in:{" "}
                <span className="font-medium">
                  {formatBusinessTime(record.attendance.actualCheckInAt)}
                </span>
              </p>
              <p className="mt-1">
                Recorded check-out:{" "}
                <span className="font-medium">
                  {formatBusinessTime(record.attendance.actualCheckOutAt)}
                </span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                An override changes only the effective attendance status. It
                does not delete or reverse recorded check-in/check-out activity.
              </p>
            </div>

            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <label
                  htmlFor="attendance-override-status"
                  className="text-sm font-medium"
                >
                  Effective status
                </label>
                <select
                  id="attendance-override-status"
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as "" | "present" | "absent")
                  }
                  required
                  disabled={overrideMutation.isPending}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="" disabled>
                    Choose a status
                  </option>
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                </select>
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="attendance-override-reason"
                  className="text-sm font-medium"
                >
                  Reason
                </label>
                <textarea
                  id="attendance-override-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  maxLength={1000}
                  rows={3}
                  disabled={overrideMutation.isPending}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  aria-describedby="attendance-override-reason-hint"
                />
                <p
                  id="attendance-override-reason-hint"
                  className="text-xs text-muted-foreground"
                >
                  Required for the Admin audit history (up to 1000 characters).
                </p>
              </div>

              {validationError && (
                <p role="alert" className="text-sm text-destructive">
                  {validationError}
                </p>
              )}
              {overrideMutation.isSuccess && (
                <p role="status" className="text-sm text-green-700">
                  Status saved.
                </p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => close(false)}
                  disabled={overrideMutation.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={overrideMutation.isPending}>
                  {overrideMutation.isPending ? "Saving..." : "Save status"}
                </Button>
              </div>
            </form>

            <section aria-labelledby="attendance-audit-heading" className="space-y-3 border-t pt-4">
              <div>
                <h3
                  id="attendance-audit-heading"
                  className="font-semibold"
                >
                  Admin status history
                </h3>
                <p className="text-xs text-muted-foreground">
                  Override audit details are available only in this Admin view.
                </p>
              </div>
              {auditQuery.isLoading ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading status history...
                </p>
              ) : auditQuery.isError ? (
                <div className="space-y-2 rounded-lg border border-destructive/30 p-3">
                  <p role="alert" className="text-sm text-destructive">
                    {getErrorMessage(
                      auditQuery.error,
                      "Unable to load status history.",
                    )}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void auditQuery.refetch()}
                    disabled={auditQuery.isFetching}
                  >
                    {auditQuery.isFetching ? "Retrying..." : "Retry history"}
                  </Button>
                </div>
              ) : auditQuery.data?.events.length ? (
                <AuditHistory
                  events={auditQuery.data.events}
                  isFetching={auditQuery.isFetching}
                />
              ) : (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No Admin status changes have been recorded for this date.
                </p>
              )}
              {auditPagination && auditPagination.totalPages > 1 && (
                <nav
                  aria-label="Admin status history pagination"
                  className="flex items-center justify-between gap-2"
                >
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    Page {auditPage} of {auditTotalPages} ·{" "}
                    {auditPagination.total} changes
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setAuditPage((current) => current - 1)}
                      disabled={auditPage <= 1 || auditQuery.isFetching}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setAuditPage((current) => current + 1)}
                      disabled={
                        auditPage >= auditTotalPages || auditQuery.isFetching
                      }
                    >
                      Next
                    </Button>
                  </div>
                </nav>
              )}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AuditHistory({
  events,
  isFetching,
}: {
  events: AttendanceStatusOverrideAuditEvent[];
  isFetching: boolean;
}) {
  return (
    <ol className="space-y-3" aria-busy={isFetching}>
      {events.map((event) => (
        <li key={event._id} className="rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {event.previousEffectiveValues
                ? getStatusLabel(event.previousEffectiveValues.status)
                : "No prior status"}{" "}
              <span aria-hidden="true">→</span>{" "}
              {getStatusLabel(event.newEffectiveValues.status)}
            </p>
            <time
              dateTime={event.changedAt}
              className="text-xs text-muted-foreground"
            >
              {formatBusinessTime(event.changedAt)}
            </time>
          </div>
          <p className="mt-2 text-muted-foreground">{event.reason}</p>
          <p className="mt-2 break-all text-xs text-muted-foreground">
            Admin User ID: {event.actorId}
          </p>
        </li>
      ))}
    </ol>
  );
}

export default function AdminAttendancePage() {
  const [date, setDate] = useState(() => getBusinessDate(new Date()));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | AdminAttendanceStatus>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [selectedRecord, setSelectedRecord] =
    useState<AdminAttendanceDashboardRecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const dashboardQuery = useAdminAttendanceDashboard({
    date,
    ...(search.trim() ? { search: search.trim() } : {}),
    role: "employee",
    status,
    page,
    limit,
  });
  const summary = dashboardQuery.data?.summary.employees;
  const records =
    dashboardQuery.data?.records.filter(
      (record) => record.employee.role === "employee",
    ) ?? [];
  const pagination = dashboardQuery.data?.pagination;
  const totalPages = Math.max(1, pagination?.totalPages ?? 1);
  const currentPage = Math.min(page, totalPages);
  const firstVisible =
    pagination && pagination.total > 0
      ? (currentPage - 1) * pagination.limit + 1
      : 0;
  const lastVisible = Math.min(
    currentPage * (pagination?.limit ?? limit),
    pagination?.total ?? 0,
  );

  const updateFilters = (update: () => void) => {
    update();
    setPage(1);
  };

  const openEditor = (record: AdminAttendanceDashboardRecord) => {
    setSelectedRecord(record);
    setDialogOpen(true);
  };

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Attendance Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review Employee attendance and Admin status overrides.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays aria-hidden="true" className="size-4" />
          Times shown in {BUSINESS_TIME_ZONE}
        </div>
      </header>

      <section aria-label="Employee attendance summary">
        {dashboardQuery.isLoading && !summary ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" role="status">
            {Array.from({ length: 5 }, (_, index) => (
              <div
                key={index}
                className="h-28 animate-pulse rounded-lg border bg-muted/40"
              />
            ))}
            <span className="sr-only">Loading attendance summary...</span>
          </div>
        ) : summary ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCard
              label="Total active Employees"
              value={summary.total}
              description="Active Employee profiles"
            />
            <SummaryCard
              label="Present"
              value={summary.present}
              description="Effective attendance"
            />
            <SummaryCard
              label="Absent"
              value={summary.absent}
              description="Explicit Admin overrides"
            />
            <SummaryCard
              label="Incomplete"
              value={summary.incomplete}
              description="Checked in, no check-out"
            />
            <SummaryCard
              label="Unrecorded"
              value={summary.unrecorded}
              description="No record or override"
            />
          </div>
        ) : null}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Filter attendance</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <label htmlFor="attendance-date" className="text-sm font-medium">
              Business date
            </label>
            <input
              id="attendance-date"
              type="date"
              value={date}
              required
              onChange={(event) => {
                const nextDate = event.target.value;
                if (nextDate) updateFilters(() => setDate(nextDate));
              }}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="attendance-search" className="text-sm font-medium">
              Search Employees
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                id="attendance-search"
                type="search"
                value={search}
                onChange={(event) =>
                  updateFilters(() => setSearch(event.target.value))
                }
                placeholder="Employee code or name"
                className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="attendance-status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="attendance-status"
              value={status}
              onChange={(event) =>
                updateFilters(() =>
                  setStatus(event.target.value as typeof status),
                )
              }
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="attendance-page-size" className="text-sm font-medium">
              Rows per page
            </label>
            <select
              id="attendance-page-size"
              value={limit}
              onChange={(event) =>
                updateFilters(() => {
                  setLimit(Number(event.target.value));
                })
              }
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Employee attendance</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              Selected business date: {date}
            </p>
          </div>
          {dashboardQuery.isFetching && (
            <span role="status" className="text-xs text-muted-foreground">
              Updating...
            </span>
          )}
        </CardHeader>
        <CardContent>
          {dashboardQuery.isError && !dashboardQuery.data ? (
            <div className="space-y-3 rounded-lg border border-destructive/30 p-4">
              <p role="alert" className="text-sm text-destructive">
                {getErrorMessage(
                  dashboardQuery.error,
                  "Unable to load the attendance dashboard.",
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void dashboardQuery.refetch()}
                disabled={dashboardQuery.isFetching}
              >
                {dashboardQuery.isFetching ? "Retrying..." : "Retry"}
              </Button>
            </div>
          ) : dashboardQuery.isError ? (
            <div
              role="alert"
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
            >
              <span>
                {getErrorMessage(
                  dashboardQuery.error,
                  "Unable to refresh attendance.",
                )}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void dashboardQuery.refetch()}
                disabled={dashboardQuery.isFetching}
              >
                Retry
              </Button>
            </div>
          ) : null}

          {dashboardQuery.isLoading ? (
            <div className="space-y-3" role="status">
              <div className="h-12 animate-pulse rounded bg-muted/50" />
              <div className="h-64 animate-pulse rounded bg-muted/40" />
              <span className="sr-only">Loading Employee attendance...</span>
            </div>
          ) : dashboardQuery.data && records.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {pagination?.total === 0
                ? "No Employees match the selected date and filters."
                : "No Employees on this page."}
            </div>
          ) : dashboardQuery.data ? (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <caption className="sr-only">
                    Employee attendance for {date}; {pagination?.total ?? 0}{" "}
                    matching records
                  </caption>
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Employee
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Check-in
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Check-out
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Effective status
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Origin
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {records.map((record) => (
                      <tr key={record.employee.id}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar record={record} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">
                                {record.employee.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {record.employee.employeeCode ??
                                  "Employee code unavailable"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Employee ID: {record.employee.id}
                              </p>
                              {(record.employee.employeeStatus !== "active" ||
                                (record.employee.userStatus &&
                                  record.employee.userStatus !== "active")) && (
                                <p className="text-xs text-amber-700">
                                  Profile: {record.employee.employeeStatus ?? "unknown"} · User: {record.employee.userStatus ?? "unavailable"}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {record.attendance.actualCheckInAt
                            ? formatBusinessTime(
                                record.attendance.actualCheckInAt,
                              )
                            : "No recorded check-in"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {record.attendance.actualCheckOutAt
                            ? formatBusinessTime(
                                record.attendance.actualCheckOutAt,
                              )
                            : "No recorded check-out"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={getStatusVariant(
                              record.attendance.effectiveStatus,
                            )}
                          >
                            {getStatusLabel(
                              record.attendance.effectiveStatus,
                            )}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {getOriginLabel(record.attendance.statusOrigin)}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openEditor(record)}
                            aria-label={`Edit attendance for ${record.employee.name}`}
                          >
                            <Pencil aria-hidden="true" />
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Showing {firstVisible}–{lastVisible} of{" "}
                  {pagination?.total ?? 0} Employees
                </p>
                <nav
                  aria-label="Attendance pagination"
                  className="flex items-center gap-2"
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage <= 1 || dashboardQuery.isFetching}
                  >
                    Previous
                  </Button>
                  <span className="px-2 text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPage(Math.min(totalPages, currentPage + 1))
                    }
                    disabled={
                      currentPage >= totalPages || dashboardQuery.isFetching
                    }
                  >
                    Next
                  </Button>
                </nav>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <AttendanceStatusDialog
        key={`${selectedRecord?.employee.id ?? "none"}-${date}`}
        record={selectedRecord}
        selectedDate={date}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </main>
  );
}
