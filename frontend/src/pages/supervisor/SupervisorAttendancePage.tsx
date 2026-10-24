import { useState } from "react";
import { isAxiosError } from "axios";
import { CalendarClock, Clock3, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useCheckIn,
  useCheckOut,
  useMyAttendance,
  useMyOpenAttendance,
  useRecentMyAttendance,
} from "@/features/attendance/hooks/useEmployeeAttendance";
import type { AttendanceRecord } from "@/services/attendance.service";

const BUSINESS_TIME_ZONE = "Asia/Kolkata";
const PAGE_SIZE = 10;

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

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    dateStyle: "medium",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: BUSINESS_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return (
      error.response?.data?.message ??
      "The attendance request could not be completed. Please try again."
    );
  }
  return error instanceof Error
    ? error.message
    : "The attendance request could not be completed. Please try again.";
}

function AttendanceHistory({ records }: { records: AttendanceRecord[] }) {
  if (records.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No attendance history is available.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[520px] text-left text-sm">
        <caption className="sr-only">Supervisor attendance history</caption>
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Date</th>
            <th scope="col" className="px-4 py-3 font-medium">Check-in</th>
            <th scope="col" className="px-4 py-3 font-medium">Check-out</th>
            <th scope="col" className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.map((record) => (
            <tr key={record._id}>
              <td className="whitespace-nowrap px-4 py-3">
                {formatDate(record.attendanceDate)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {formatTime(record.checkInAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {formatTime(record.checkOutAt)}
              </td>
              <td className="px-4 py-3">
                <Badge variant={record.checkOutAt ? "secondary" : "outline"}>
                  {record.checkOutAt ? "Complete" : "Open"}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SupervisorAttendancePage() {
  const today = getBusinessDate(new Date());
  const [page, setPage] = useState(1);
  const historyQuery = useMyAttendance({ page, limit: PAGE_SIZE });
  const recentQuery = useRecentMyAttendance();
  const openQuery = useMyOpenAttendance();
  const checkInMutation = useCheckIn();
  const checkOutMutation = useCheckOut();
  const recentRecords = recentQuery.data?.records ?? [];
  const openRecord = openQuery.data?.records[0] ?? null;
  const todayRecord = recentRecords.find(
    (record) => record.attendanceDate === today,
  );
  const pagination = historyQuery.data?.pagination;
  const statusLoading = recentQuery.isFetching || openQuery.isFetching;
  const statusUnknown = recentQuery.isError || openQuery.isError;

  const submitAttendance = async (action: "check-in" | "check-out") => {
    const mutation =
      action === "check-in" ? checkInMutation : checkOutMutation;
    try {
      await mutation.mutateAsync();
      toast.success(
        action === "check-in"
          ? "You are checked in."
          : "You are checked out.",
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">My Attendance</h1>
        <p className="text-sm text-muted-foreground">
          Record your workday and review your attendance history. Times are
          shown in {BUSINESS_TIME_ZONE}.
        </p>
      </header>

      <section aria-labelledby="supervisor-current-attendance">
        <div className="mb-3 flex items-center gap-2">
          <Clock3 className="size-5 text-primary" aria-hidden="true" />
          <h2 id="supervisor-current-attendance" className="text-lg font-semibold">
            Current attendance
          </h2>
        </div>
        <Card>
          <CardContent className="grid gap-5 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center sm:p-6">
            <div aria-live="polite">
              <p className="text-sm text-muted-foreground">
                {statusLoading
                  ? "Checking your current status..."
                  : statusUnknown
                    ? "Your current attendance status is unavailable."
                    : openRecord
                      ? `Checked in for ${formatDate(openRecord.attendanceDate)}`
                      : todayRecord
                        ? "Today's attendance is complete."
                        : "You are currently checked out."}
              </p>
              {todayRecord && (
                <dl className="mt-3 grid max-w-md grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Today's check-in</dt>
                    <dd className="mt-1 font-medium">
                      {formatTime(todayRecord.checkInAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Today's check-out</dt>
                    <dd className="mt-1 font-medium">
                      {formatTime(todayRecord.checkOutAt)}
                    </dd>
                  </div>
                </dl>
              )}
              {recentQuery.isError && (
                <Button
                  type="button"
                  variant="link"
                  className="mt-2 h-auto p-0"
                  onClick={() => void recentQuery.refetch()}
                  disabled={recentQuery.isFetching}
                >
                  Retry status
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="min-h-12 w-full sm:w-auto"
                onClick={() => void submitAttendance("check-in")}
                disabled={
                  checkInMutation.isPending ||
                  checkOutMutation.isPending ||
                  statusLoading ||
                  statusUnknown ||
                  Boolean(todayRecord) ||
                  Boolean(openRecord)
                }
              >
                <LogIn aria-hidden="true" />
                {checkInMutation.isPending ? "Checking in..." : "Check In"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-12 w-full sm:w-auto"
                onClick={() => void submitAttendance("check-out")}
                disabled={
                  checkInMutation.isPending ||
                  checkOutMutation.isPending ||
                  statusLoading ||
                  statusUnknown ||
                  !openRecord
                }
              >
                <LogOut aria-hidden="true" />
                {checkOutMutation.isPending ? "Checking out..." : "Check Out"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="supervisor-attendance-history" className="space-y-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-5 text-primary" aria-hidden="true" />
          <h2 id="supervisor-attendance-history" className="text-lg font-semibold">
            Attendance history
          </h2>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recorded attendance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {historyQuery.isError ? (
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p role="alert" className="text-sm text-destructive">
                  {getErrorMessage(historyQuery.error)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void historyQuery.refetch()}
                  disabled={historyQuery.isFetching}
                >
                  Retry
                </Button>
              </div>
            ) : historyQuery.isLoading ? (
              <p role="status" className="py-8 text-center text-sm text-muted-foreground">
                Loading attendance history...
              </p>
            ) : (
              <AttendanceHistory records={historyQuery.data?.records ?? []} />
            )}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {pagination.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1 || historyQuery.isFetching}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPage((current) =>
                        Math.min(pagination.totalPages, current + 1),
                      )
                    }
                    disabled={
                      page >= pagination.totalPages || historyQuery.isFetching
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
