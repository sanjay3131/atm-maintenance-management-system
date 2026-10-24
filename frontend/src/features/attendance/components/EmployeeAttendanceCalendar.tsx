import { useState } from "react";
import { isAxiosError } from "axios";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEmployeeAttendanceCalendar } from "@/features/attendance/hooks/useEmployeeAttendanceCalendar";
import type {
  AttendanceCalendarDay,
  AttendanceCalendarStatus,
} from "@/services/attendance.service";

const STATUS_LABELS: Record<AttendanceCalendarStatus | "none", string> = {
  present: "Present",
  incomplete: "Incomplete",
  absent: "Absent (admin override)",
  none: "No record",
};

const STATUS_STYLES: Record<AttendanceCalendarStatus | "none", string> = {
  present: "bg-emerald-600 text-white hover:bg-emerald-700 ",
  incomplete: "bg-amber-400 text-amber-950 hover:bg-amber-500",
  absent: "bg-rose-600 text-white hover:bg-rose-700",
  none: "bg-muted text-muted-foreground hover:bg-muted/70",
};

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getCurrentBusinessMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}`;
}

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatTimestamp(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Please try again.";
  }
  return error instanceof Error ? error.message : "Please try again.";
}

function AttendanceLegend() {
  return (
    <ul
      aria-label="Attendance calendar legend"
      className="flex flex-wrap gap-4"
    >
      {(
        Object.keys(STATUS_LABELS) as Array<AttendanceCalendarStatus | "none">
      ).map((status) => (
        <li key={status} className="flex items-center gap-2 text-xs">
          <span
            aria-hidden="true"
            className={`size-3 rounded-sm ${STATUS_STYLES[status].split(" ")[0]} animate-pulse `}
          />
          {STATUS_LABELS[status]}
        </li>
      ))}
    </ul>
  );
}

export default function EmployeeAttendanceCalendar({
  employeeId,
}: {
  employeeId: string;
}) {
  const [month, setMonth] = useState(getCurrentBusinessMonth);
  const [selectedDate, setSelectedDate] = useState(`${month}-01`);
  const calendarQuery = useEmployeeAttendanceCalendar(employeeId, month);
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  const attendanceByDate = new Map(
    (calendarQuery.data?.days ?? []).map((day) => [day.attendanceDate, day]),
  );
  const selectedAttendance = attendanceByDate.get(selectedDate);
  const monthLabel = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));

  const selectMonth = (offset: number) => {
    const nextMonth = shiftMonth(month, offset);
    setMonth(nextMonth);
    setSelectedDate(`${nextMonth}-01`);
  };

  const statusFor = (record?: AttendanceCalendarDay) =>
    record?.status ?? "none";

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Attendance</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Business dates and times use Asia/Kolkata.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => selectMonth(-1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <p className="min-w-36 text-center font-medium" aria-live="polite">
            {monthLabel}
          </p>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Next month"
            onClick={() => selectMonth(1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {calendarQuery.isLoading && (
          <p className="text-sm text-muted-foreground" role="status">
            Loading attendance...
          </p>
        )}
        {calendarQuery.isError && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
            role="alert"
          >
            <p className="text-sm text-destructive">
              Attendance could not be loaded.{" "}
              {getErrorMessage(calendarQuery.error)}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void calendarQuery.refetch()}
              disabled={calendarQuery.isFetching}
            >
              <RefreshCw
                className={calendarQuery.isFetching ? "animate-spin" : ""}
              />
              {calendarQuery.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </div>
        )}
        <AttendanceLegend />
        {calendarQuery.data?.days.length === 0 && !calendarQuery.isLoading && (
          <p className="text-sm text-muted-foreground">
            No attendance records or status overrides were recorded for this
            month. Dates without a record are not marked absent.
          </p>
        )}
        <div
          className="grid grid-cols-7 gap-1.5 sm:gap-2"
          aria-label={`Attendance for ${monthLabel}`}
        >
          {WEEK_DAYS.map((day) => (
            <span
              key={day}
              aria-hidden="true"
              className="pb-1 text-center text-xs font-medium text-muted-foreground"
            >
              {day}
            </span>
          ))}
          {cells.map((day, index) => {
            if (day === null) {
              return <span key={`empty-${index}`} aria-hidden="true" />;
            }
            const date = `${month}-${String(day).padStart(2, "0")}`;
            const record = attendanceByDate.get(date);
            const status = statusFor(record);
            return (
              <button
                key={date}
                type="button"
                aria-label={`${date}: ${STATUS_LABELS[status]}`}
                aria-pressed={selectedDate === date}
                onClick={() => setSelectedDate(date)}
                className={` aspect-square w-full rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  STATUS_STYLES[status]
                } ${
                  selectedDate === date ? "ring-2 ring-ring ring-offset-2" : ""
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
        <section
          aria-live="polite"
          aria-label={`Attendance details for ${selectedDate}`}
          className="rounded-lg border bg-muted/20 p-4"
        >
          <h3 className="font-medium">{selectedDate}</h3>
          {calendarQuery.isLoading && !calendarQuery.data ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Loading selected date...
            </p>
          ) : calendarQuery.isError && !calendarQuery.data ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Attendance details are unavailable until the request succeeds.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm">
                Status:{" "}
                <span className="font-medium">
                  {STATUS_LABELS[statusFor(selectedAttendance)]}
                </span>
                {selectedAttendance?.statusOrigin === "admin_override" &&
                  " · Admin override"}
              </p>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Check-in</dt>
                  <dd className="font-medium">
                    {formatTimestamp(selectedAttendance?.checkInAt ?? null)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Check-out</dt>
                  <dd className="font-medium">
                    {formatTimestamp(selectedAttendance?.checkOutAt ?? null)}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
