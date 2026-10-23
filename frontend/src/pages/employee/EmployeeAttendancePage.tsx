import { useState } from "react";
import { isAxiosError } from "axios";
import { ArrowLeft, CalendarClock, Clock3, LogIn, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
  useCheckIn,
  useCheckOut,
  useMyAttendance,
  useRecentMyAttendance,
} from "@/features/attendance/hooks/useEmployeeAttendance";
import type { AttendanceRecord } from "@/services/attendance.service";
import {
  employeeErrorMessage,
  useEmployeeLanguage,
} from "@/features/employee-portal/i18n";

const BUSINESS_TIME_ZONE = "Asia/Kolkata";
const HISTORY_PAGE_SIZE = 10;
const STATUS_HISTORY_LIMIT = 100;

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

function formatBusinessDate(value: string, language: "ta" | "en") {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat(language === "ta" ? "ta-IN" : "en-IN", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatBusinessTime(value: string | null, language: "ta" | "en") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "ta" ? "ta-IN" : "en-IN", {
    timeZone: BUSINESS_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getErrorMessage(
  error: unknown,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
  language: "ta" | "en",
) {
  if (isAxiosError<{ message?: string }>(error)) {
    return employeeErrorMessage(
      error.response?.data?.message ||
        t("The attendance request could not be completed. Please try again."),
      "The attendance request could not be completed. Please try again.",
      language,
      t,
    );
  }
  return language === "en" && error instanceof Error
    ? employeeErrorMessage(
        error.message,
        "The attendance request could not be completed. Please try again.",
        language,
        t,
      )
    : t("The attendance request could not be completed. Please try again.");
}

function getRecordStatus(
  record: AttendanceRecord,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  return record.checkOutAt ? t("Complete") : t("Open");
}

function AttendanceTable({
  records,
  t,
  language,
}: {
  records: AttendanceRecord[];
  t: ReturnType<typeof useEmployeeLanguage>["t"];
  language: "ta" | "en";
}) {
  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t("No attendance records match the selected dates.")}
      </div>
    );
  }

  return (
    <div>
      <ul className="space-y-3 sm:hidden">
        {records.map((record) => (
          <li key={record._id} className="rounded-lg border p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold">
                {formatBusinessDate(record.attendanceDate, language)}
              </p>
              <Badge variant={record.checkOutAt ? "secondary" : "outline"}>
                {getRecordStatus(record, t)}
              </Badge>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">{t("Check in")}</dt>
                <dd className="mt-1 font-medium">
                  {formatBusinessTime(record.checkInAt, language)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("Check out")}</dt>
                <dd className="mt-1 font-medium">
                  {formatBusinessTime(record.checkOutAt, language)}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-lg border sm:block">
        <table className="w-full min-w-2xl text-left text-sm">
          <caption className="sr-only">{t("Attendance history")}</caption>
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                {t("Date")}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t("Check in")}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t("Check out")}
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                {t("Status")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {records.map((record) => (
              <tr key={record._id}>
                <td className="whitespace-nowrap px-4 py-3">
                  {formatBusinessDate(record.attendanceDate, language)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {formatBusinessTime(record.checkInAt, language)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {formatBusinessTime(record.checkOutAt, language)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={record.checkOutAt ? "secondary" : "outline"}>
                    {getRecordStatus(record, t)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EmployeeAttendancePage() {
  const navigate = useNavigate();
  const { t, language } = useEmployeeLanguage();
  const today = getBusinessDate(new Date());
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const dateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  const historyQuery = useMyAttendance({
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    page,
    limit: HISTORY_PAGE_SIZE,
  });
  const recentQuery = useRecentMyAttendance();
  const checkInMutation = useCheckIn();
  const checkOutMutation = useCheckOut();
  const recentRecords = recentQuery.data?.records ?? [];
  const openRecords = recentRecords.filter(
    (record) => record.checkOutAt === null,
  );
  const todayRecord = recentRecords.find((record) => record.attendanceDate === today);
  const checkingIn = checkInMutation.isPending;
  const checkingOut = checkOutMutation.isPending;
  const actionError = checkInMutation.error ?? checkOutMutation.error;

  const checkIn = async () => {
    try {
      await checkInMutation.mutateAsync();
      toast.success(t("You are checked in."));
    } catch (error) {
      toast.error(getErrorMessage(error, t, language));
    }
  };

  const checkOut = async () => {
    try {
      await checkOutMutation.mutateAsync();
      toast.success(t("You are checked out."));
    } catch (error) {
      toast.error(getErrorMessage(error, t, language));
    }
  };

  const resetToFirstPage = (update: () => void) => {
    update();
    setPage(1);
  };

  const pagination = historyQuery.data?.pagination;
  const statusUnknown =
    recentQuery.data &&
    openRecords.length === 0 &&
    recentQuery.data.pagination.total > STATUS_HISTORY_LIMIT;
  const cannotCheckIn =
    Boolean(todayRecord) ||
    openRecords.length > 0 ||
    Boolean(statusUnknown) ||
    recentQuery.isLoading;

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t("My Attendance")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Record your workday and review attendance history.")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full sm:w-auto"
          onClick={() => navigate("/employee")}
        >
          <ArrowLeft aria-hidden="true" />
          {t("Back to Dashboard")}
        </Button>
      </header>

      <section aria-labelledby="current-attendance-heading">
        <div className="mb-3 flex items-center gap-2">
          <Clock3 className="size-5 text-primary" aria-hidden="true" />
          <h2 id="current-attendance-heading" className="text-lg font-semibold">
            {t("Current attendance")}
          </h2>
        </div>
        <Card>
          <CardContent className="grid gap-5 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center sm:p-6">
            <div>
              <p className="text-sm text-muted-foreground">
                {recentQuery.isLoading
                  ? t("Checking your current status...")
                  : recentQuery.isError
                    ? t("Current attendance status is unavailable.")
                    : openRecords.length > 1
                      ? t("Multiple open records need administrator attention.")
                      : openRecords.length === 1
                        ? t("Checked in for {date}", {
                            date: formatBusinessDate(
                              openRecords[0].attendanceDate,
                              language,
                            ),
                          })
                        : todayRecord
                          ? t("Today's attendance is complete.")
                          : statusUnknown
                            ? t("No open session found in the latest 100 records.")
                            : t("No open attendance session.")}
              </p>
              {openRecords.length === 1 && (
                <p className="mt-1 text-sm font-medium">
                  {t("Check-in: {time}", {
                    time: formatBusinessTime(openRecords[0].checkInAt, language),
                  })}
                </p>
              )}
              {statusUnknown && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("Older history was not scanned. Use Check Out if you need to close an earlier overnight session.")}
                </p>
              )}
              {recentQuery.isError && (
                <Button
                  type="button"
                  variant="link"
                  className="mt-1 h-auto p-0"
                  onClick={() => void recentQuery.refetch()}
                  disabled={recentQuery.isFetching}
                >
                  {t("Retry status")}
                </Button>
              )}
              {actionError && (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {getErrorMessage(actionError, t, language)}
                </p>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="min-h-12 w-full min-w-0 whitespace-normal text-center leading-snug sm:w-auto sm:whitespace-nowrap"
                onClick={() => void checkIn()}
                disabled={checkingIn || checkingOut || cannotCheckIn}
                aria-label={t("Check In")}
              >
                <LogIn aria-hidden="true" />
                {checkingIn ? t("Checking in...") : t("Check In")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-12 w-full min-w-0 whitespace-normal text-center leading-snug sm:w-auto sm:whitespace-nowrap"
                onClick={() => void checkOut()}
                disabled={checkingIn || checkingOut || openRecords.length > 1}
                aria-label={t("Check Out")}
              >
                <LogOut aria-hidden="true" />
                {checkingOut ? t("Checking out...") : t("Check Out")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="attendance-history-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-5 text-primary" aria-hidden="true" />
          <div>
            <h2 id="attendance-history-heading" className="text-lg font-semibold">
              {t("Attendance history")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("Times are shown in Asia/Kolkata.")}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("Filter by attendance date")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
            <div>
              <label
                htmlFor="attendance-from-date"
                className="mb-1 block text-sm font-medium"
              >
                {t("From date")}
              </label>
              <input
                id="attendance-from-date"
                type="date"
                value={fromDate}
                max={today}
                onChange={(event) =>
                  resetToFirstPage(() => setFromDate(event.target.value))
                }
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            <div>
              <label
                htmlFor="attendance-to-date"
                className="mb-1 block text-sm font-medium"
              >
                {t("To date")}
              </label>
              <input
                id="attendance-to-date"
                type="date"
                value={toDate}
                max={today}
                onChange={(event) =>
                  resetToFirstPage(() => setToDate(event.target.value))
                }
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full sm:w-auto"
                onClick={() => {
                  setFromDate("");
                  setToDate("");
                  setPage(1);
                }}
                disabled={!fromDate && !toDate}
              >
                {t("Clear dates")}
              </Button>
            </div>
            {dateRangeInvalid && (
              <p className="text-sm text-destructive sm:col-span-2 lg:col-span-3" role="alert">
                {t("From date must be on or before to date.")}
              </p>
            )}
          </CardContent>
        </Card>

        {dateRangeInvalid ? null : historyQuery.isLoading ? (
          <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground" role="status">
            {t("Loading attendance history...")}
          </div>
        ) : historyQuery.isError ? (
          <Card>
            <CardContent className="p-5">
              <p className="font-medium text-destructive">
                {t("Could not load attendance history.")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {getErrorMessage(historyQuery.error, t, language)}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 min-h-11"
                onClick={() => void historyQuery.refetch()}
                disabled={historyQuery.isFetching}
              >
                {t("Retry")}
              </Button>
            </CardContent>
          </Card>
        ) : historyQuery.data ? (
          <>
            <AttendanceTable
              records={historyQuery.data.records}
              t={t}
              language={language}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {pagination?.total
                  ? t("Showing {from}–{to} of {total} records", {
                      from: (page - 1) * HISTORY_PAGE_SIZE + 1,
                      to: Math.min(page * HISTORY_PAGE_SIZE, pagination.total),
                      total: pagination.total,
                    })
                  : t("No attendance records")}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1 || historyQuery.isFetching}
                >
                  {t("Previous")}
                </Button>
                <span className="self-center px-1 text-sm" aria-current="page">
                  {t("Page {page} of {pages}", {
                    page,
                    pages: Math.max(1, pagination?.totalPages ?? 1),
                  })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() =>
                    setPage((current) =>
                      Math.min(pagination?.totalPages ?? current, current + 1),
                    )
                  }
                  disabled={
                    page >= (pagination?.totalPages ?? 1) ||
                    historyQuery.isFetching
                  }
                >
                  {t("Next")}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
