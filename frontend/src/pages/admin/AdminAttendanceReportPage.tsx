import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { isAxiosError } from "axios";
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAttendanceReport } from "@/features/attendance/hooks/useAdminAttendance";
import { formatWorkedDuration } from "@/features/attendance/attendance.utils";
import {
  getAttendanceReportPeriodRange,
  getCurrentBusinessDate,
  getCurrentMonthAttendanceRange,
  isValidAttendanceReportDate,
  navigateAttendanceReportPeriod,
  validateAttendanceReportDateRange,
  type AttendanceReportDateRange,
  type AttendanceReportPeriod,
} from "@/features/attendance/attendanceReport.utils";
import { useEmployees } from "@/features/employees/hooks/useEmployees";
import { useEmployeeOptions } from "@/features/employees/hooks/useEmployeeOptions";
import { downloadAttendanceReportExport } from "@/services/attendance.service";
import type {
  AttendanceReportDailyDetail,
  AttendanceReportExportQuery,
  AttendanceReportResponse,
  AttendanceReportStatus,
} from "@/services/attendance.service";
import type {
  Employee,
  EmployeeOption,
} from "@/services/employee.service";

type ReportMode = AttendanceReportPeriod | "custom";
type AttendanceSummary = AttendanceReportResponse["employees"][number]["summary"];
type AttendanceReportEmployee = AttendanceReportResponse["employees"][number];
const EMPTY_EMPLOYEE_OPTIONS: EmployeeOption[] = [];

const TIME_ZONE = "Asia/Kolkata";
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const CONTROL_CLASS =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  dateStyle: "medium",
});
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});
const NUMBER_FORMAT = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});
const PERCENT_FORMAT = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});

const STATUS_LABELS: Record<AttendanceReportStatus, string> = {
  present: "Present",
  incomplete: "Incomplete",
  absent: "Absent",
  not_recorded: "Not recorded",
};

function formatBusinessDate(value: string) {
  if (!isValidAttendanceReportDate(value)) return "Not available";
  // Noon in Kolkata keeps this calendar date stable when formatted from UTC.
  return DATE_FORMAT.format(new Date(`${value}T06:30:00.000Z`));
}

function formatBusinessDateTime(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : DATE_TIME_FORMAT.format(date);
}

function formatDuration(value: number | null) {
  return value === null ? "Not available" : formatWorkedDuration(value);
}

function formatPercentage(value: number | null, eligibleDays: number) {
  if (value === null) return eligibleDays === 0 ? "Not applicable" : "Unavailable";
  return `${PERCENT_FORMAT.format(value)}%`;
}

function getEmployeeName(employee: Employee | undefined) {
  if (!employee) return "";
  return [employee.userId?.firstName, employee.userId?.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim();
}

function getEmployeeCode(employee: AttendanceReportEmployee, employees: Employee[]) {
  return (
    employee.employeeCode ||
    employees.find(({ _id }) => _id === employee.employeeId)?.employeeCode ||
    null
  );
}

function getReportErrorMessage(error: unknown) {
  if (isAxiosError(error) && error.response?.status === 403) {
    return "You do not have permission to view attendance reports.";
  }
  return "The attendance report could not be loaded. Check your connection and try again.";
}

function getRangeErrorMessage(
  validation: ReturnType<typeof validateAttendanceReportDateRange>,
) {
  if (validation.valid) return "";
  if (validation.reason === "reversed_range") {
    return "The start date must be on or before the end date.";
  }
  if (validation.reason === "range_too_long") {
    return "Custom date ranges can include at most 366 days.";
  }
  return "Enter valid calendar dates in both fields.";
}

function getOriginLabel(origin: AttendanceReportDailyDetail["statusOrigin"]) {
  if (origin === "admin_override") return "Admin override";
  if (origin === "no_record") return "No attendance record";
  return "Recorded";
}

function getCheckoutLabel(detail: AttendanceReportDailyDetail) {
  if (detail.checkOutSource) {
    const source =
      detail.checkOutSource === "superAdmin"
        ? "SuperAdmin"
        : detail.checkOutSource.charAt(0).toLocaleUpperCase() +
          detail.checkOutSource.slice(1);
    return `${source} checkout`;
  }
  if (detail.checkoutState === "checked_out") return "Checked out";
  if (detail.checkoutState === "no_record") return "No attendance record";
  return "Open";
}

function getPeriodLabel(mode: ReportMode) {
  if (mode === "week") return "Weekly";
  if (mode === "month") return "Monthly";
  if (mode === "year") return "Yearly";
  return "Custom";
}

function SummaryValue({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/70 py-2.5 sm:block sm:border-0 sm:py-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="shrink-0 text-right text-sm font-medium tabular-nums text-foreground sm:mt-1 sm:text-left">
        {value}
      </dd>
    </div>
  );
}

function AttendanceSummary({ summary }: { summary: AttendanceSummary }) {
  return (
    <div className="space-y-4">
      <section>
        <h4 className="mb-2 text-sm font-semibold text-foreground">
          Attendance summary
        </h4>
        <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryValue
            label="Eligible days"
            value={NUMBER_FORMAT.format(summary.eligibleWorkingDays)}
          />
          <SummaryValue
            label="Present days"
            value={NUMBER_FORMAT.format(summary.presentDays)}
          />
          <SummaryValue
            label="Incomplete days"
            value={NUMBER_FORMAT.format(summary.incompleteDays)}
          />
          <SummaryValue
            label="Absent days"
            value={NUMBER_FORMAT.format(summary.absentDays)}
          />
          <SummaryValue
            label="Not recorded days"
            value={NUMBER_FORMAT.format(summary.notRecordedDays)}
          />
          <SummaryValue
            label="Attendance"
            value={formatPercentage(
              summary.attendancePercentage,
              summary.eligibleWorkingDays,
            )}
          />
        </dl>
        {summary.eligibleWorkingDays === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            No eligible working days in this employee’s selected period.
          </p>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-foreground">
          Worked duration
        </h4>
        <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-3">
          <SummaryValue
            label="Total"
            value={formatDuration(summary.workedDurationMs)}
          />
          <SummaryValue
            label="Finalized"
            value={formatDuration(summary.finalizedWorkedDurationMs)}
          />
          <SummaryValue
            label="Provisional"
            value={formatDuration(summary.provisionalWorkedDurationMs)}
          />
        </dl>
      </section>
    </div>
  );
}

function DailyDetailRow({ detail }: { detail: AttendanceReportDailyDetail }) {
  return (
    <div className="grid gap-3 rounded-md border border-border p-3 text-sm lg:hidden">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <time className="font-medium tabular-nums">
          {formatBusinessDate(detail.attendanceDate)}
        </time>
        <Badge variant="outline" className="whitespace-nowrap">
          {STATUS_LABELS[detail.status]}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <dt className="text-xs text-muted-foreground">Status origin</dt>
          <dd>{getOriginLabel(detail.statusOrigin)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Worked</dt>
          <dd className="tabular-nums">{formatDuration(detail.workedDurationMs)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Check-in</dt>
          <dd>{formatBusinessDateTime(detail.checkInAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Check-out</dt>
          <dd>
            {formatBusinessDateTime(detail.checkOutAt)}
            <span className="block text-xs text-muted-foreground">
              {getCheckoutLabel(detail)}
            </span>
          </dd>
        </div>
      </dl>
      {detail.durationIsProvisional && (
        <p className="text-xs font-medium text-muted-foreground">
          Provisional duration
        </p>
      )}
    </div>
  );
}

function DailyAttendance({ details }: { details: AttendanceReportDailyDetail[] }) {
  if (details.length === 0) {
    return (
      <p className="mt-3 rounded-md border border-border p-3 text-sm text-muted-foreground">
        No daily attendance details were returned for this employee.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="space-y-2 lg:hidden">
        {details.map((detail) => (
          <DailyDetailRow
            key={`${detail.attendanceDate}-${detail.statusOrigin}`}
            detail={detail}
          />
        ))}
      </div>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-medium text-muted-foreground">
              <th scope="col" className="w-[17%] py-2 pr-3 font-medium">
                Date
              </th>
              <th scope="col" className="w-[21%] py-2 pr-3 font-medium">
                Status
              </th>
              <th scope="col" className="w-[21%] py-2 pr-3 font-medium">
                Check-in
              </th>
              <th scope="col" className="w-[23%] py-2 pr-3 font-medium">
                Check-out
              </th>
              <th scope="col" className="w-[18%] py-2 text-right font-medium">
                Worked
              </th>
            </tr>
          </thead>
          <tbody>
            {details.map((detail) => (
              <tr
                key={`${detail.attendanceDate}-${detail.statusOrigin}`}
                className="border-b border-border/70 last:border-0"
              >
                <td className="py-2.5 pr-3 align-top tabular-nums">
                  {formatBusinessDate(detail.attendanceDate)}
                </td>
                <td className="py-2.5 pr-3 align-top">
                  <span className="block">{STATUS_LABELS[detail.status]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {getOriginLabel(detail.statusOrigin)}
                  </span>
                </td>
                <td className="py-2.5 pr-3 align-top">
                  {formatBusinessDateTime(detail.checkInAt)}
                </td>
                <td className="py-2.5 pr-3 align-top">
                  <span className="block">
                    {formatBusinessDateTime(detail.checkOutAt)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {getCheckoutLabel(detail)}
                  </span>
                </td>
                <td className="py-2.5 text-right align-top tabular-nums">
                  <span className="block">{formatDuration(detail.workedDurationMs)}</span>
                  {detail.durationIsProvisional && (
                    <span className="block text-xs font-medium text-muted-foreground">
                      Provisional
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmployeeReportCard({
  employee,
  employees,
}: {
  employee: AttendanceReportEmployee;
  employees: Employee[];
}) {
  const employeeRecord = employees.find(({ _id }) => _id === employee.employeeId);
  const employeeName = getEmployeeName(employeeRecord);
  const code = getEmployeeCode(employee, employees);
  const heading =
    employeeName || code || `Employee ${employee.employeeId}`;
  const identifier = employeeName
    ? code
      ? `Employee code ${code}`
      : null
    : code
      ? null
      : `Employee ID ${employee.employeeId}`;

  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader className="space-y-1 p-4 pb-3 sm:p-5 sm:pb-3">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="break-words text-base leading-6">
              {heading}
            </CardTitle>
            {identifier && (
              <p className="mt-1 break-all text-sm text-muted-foreground">
                {identifier}
              </p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0 sm:p-5 sm:pt-0">
        <AttendanceSummary summary={employee.summary} />
        <details className="border-t border-border pt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Daily attendance ({NUMBER_FORMAT.format(employee.dailyDetails.length)} days)
          </summary>
          <DailyAttendance details={employee.dailyDetails} />
        </details>
      </CardContent>
    </Card>
  );
}

function ReportLoadingState() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading attendance report">
      {[0, 1, 2].map((item) => (
        <Card key={item} className="shadow-none">
          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="h-5 w-48 rounded bg-muted" />
            <div className="h-4 w-full max-w-2xl rounded bg-muted" />
            <div className="h-4 w-2/3 rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
      <span className="sr-only">Loading attendance report...</span>
    </div>
  );
}

function ReportError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm">{message}</p>
      <Button variant="outline" className="min-h-11" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function getOptionName(employee: EmployeeOption) {
  return [employee.firstName, employee.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim();
}

function getOptionInitials(employee: EmployeeOption) {
  const nameParts = getOptionName(employee).split(/\s+/).filter(Boolean);
  if (nameParts.length > 1) {
    return `${Array.from(nameParts[0])[0]}${Array.from(nameParts.at(-1)!)[0]}`.toLocaleUpperCase();
  }
  if (nameParts.length === 1) {
    return Array.from(nameParts[0]).slice(0, 2).join("").toLocaleUpperCase();
  }
  return Array.from(employee.employeeCode?.trim() ?? "")
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase() || "?";
}

function getSafeAvatarUrl(value: string | null) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value, "https://employee-avatar.invalid");
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return value;
  } catch {
    return null;
  }
}

function EmployeeOptionAvatar({ employee }: { employee: EmployeeOption }) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const avatarUrl = getSafeAvatarUrl(employee.avatarUrl);

  return (
    <span
      aria-hidden="true"
      className="relative inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground"
    >
      {getOptionInitials(employee)}
      {avatarUrl && failedAvatarUrl !== avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailedAvatarUrl(avatarUrl)}
        />
      )}
    </span>
  );
}

function EmployeeSearchSelector({
  selectedEmployee,
  onSelect,
  onClear,
}: {
  selectedEmployee: EmployeeOption | null;
  onSelect: (employee: EmployeeOption) => void;
  onClear: () => void;
}) {
  const inputId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
      setActiveIndex(0);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const isSearchSettled = search.trim() === debouncedSearch;
  const optionsQuery = useEmployeeOptions(
    debouncedSearch,
    page,
    open && isSearchSettled,
  );
  const options = isSearchSettled
    ? (optionsQuery.data?.employees ?? EMPTY_EMPLOYEE_OPTIONS)
    : EMPTY_EMPLOYEE_OPTIONS;
  const isLoading = !isSearchSettled || optionsQuery.isLoading || optionsQuery.isFetching;
  const pagination = optionsQuery.data?.pagination;

  useEffect(() => {
    if (!open || isLoading) return;
    const activeEmployee = options[activeIndex];
    if (!activeEmployee) return;
    optionRefs.current
      .get(activeEmployee._id)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, isLoading, open, options]);

  const selectEmployee = (employee: EmployeeOption) => {
    onSelect(employee);
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
    setActiveIndex(0);
    setOpen(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(0);
      }
      return;
    }

    if (event.key === "ArrowDown" && !open) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(0);
    } else if (event.key === "ArrowDown" && options.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp" && open && options.length > 0) {
      event.preventDefault();
      setActiveIndex(
        (index) => (index + options.length - 1) % options.length,
      );
    } else if (event.key === "Enter" && open && options[activeIndex]) {
      event.preventDefault();
      selectEmployee(options[activeIndex]);
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="min-w-0"
      onBlur={(event) => {
        if (!wrapperRef.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-sm font-medium"
      >
        Employee
      </label>
      <input
        id={inputId}
        type="search"
        role="combobox"
        aria-label="Search employees"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${inputId}-list`}
        aria-activedescendant={
          open && options[activeIndex]
            ? `${inputId}-option-${options[activeIndex]._id}`
            : undefined
        }
        className={CONTROL_CLASS}
        placeholder="Search by employee name or code"
        value={search}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />

      {open && (
        <div className="relative z-10 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-md">
          <div
            id={`${inputId}-list`}
            role="listbox"
            aria-label="Employee search results"
            aria-busy={isLoading}
            className="max-h-60 overflow-y-auto p-1"
          >
            {isLoading ? (
              <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
                Searching employees…
              </p>
            ) : optionsQuery.isError ? (
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <p role="status" className="text-sm text-muted-foreground">
                  Employee search could not be loaded.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void optionsQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : options.length === 0 ? (
              <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
                No employees found.
              </p>
            ) : (
              options.map((employee, index) => {
                const name = getOptionName(employee);
                return (
                  <div
                    id={`${inputId}-option-${employee._id}`}
                    key={employee._id}
                    ref={(element) => {
                      if (element) optionRefs.current.set(employee._id, element);
                      else optionRefs.current.delete(employee._id);
                    }}
                    role="option"
                    aria-selected={employee._id === selectedEmployee?._id}
                    className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-sm px-2 py-2 outline-none hover:bg-muted ${
                      index === activeIndex ? "bg-muted" : ""
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectEmployee(employee)}
                  >
                    <EmployeeOptionAvatar employee={employee} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium">
                        {name || "Name unavailable"}
                      </span>
                      <span className="block break-all text-xs text-muted-foreground">
                        {employee.employeeCode || "Employee code unavailable"}
                      </span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
          {!isLoading && !optionsQuery.isError && pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => {
                    setPage((current) => Math.max(1, current - 1));
                    setActiveIndex(0);
                  }}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages}
                  onClick={() => {
                    setPage((current) => Math.min(pagination.totalPages, current + 1));
                    setActiveIndex(0);
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div
        aria-live="polite"
        className="mt-3 flex min-w-0 flex-col gap-3 rounded-md bg-muted/50 p-3 sm:flex-row sm:items-center"
      >
        {selectedEmployee ? (
          <>
            <EmployeeOptionAvatar employee={selectedEmployee} />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium">
                {getOptionName(selectedEmployee) || "Name unavailable"}
              </p>
              <p className="break-all text-xs text-muted-foreground">
                {selectedEmployee.employeeCode || "Employee code unavailable"}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="min-h-10 w-full sm:w-auto"
              onClick={onClear}
            >
              Clear selection
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">All employees</p>
        )}
      </div>
    </div>
  );
}

export default function AdminAttendanceReportPage() {
  const [mode, setMode] = useState<ReportMode>("month");
  const [range, setRange] = useState<AttendanceReportDateRange>(() =>
    getCurrentMonthAttendanceRange(),
  );
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [employeeId, setEmployeeId] = useState("");
  const [selectedEmployee, setSelectedEmployee] =
    useState<EmployeeOption | null>(null);
  const [reportingCutoff, setReportingCutoff] = useState<string | null>(null);
  const [reuseCutoff, setReuseCutoff] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const [downloadType, setDownloadType] = useState<"xlsx" | "pdf" | null>(
    null,
  );
  const [downloadError, setDownloadError] = useState("");
  const employeesQuery = useEmployees();

  const validation = useMemo(
    () => validateAttendanceReportDateRange(range.fromDate, range.toDate),
    [range.fromDate, range.toDate],
  );
  const employees = employeesQuery.data ?? [];
  const reportQuery = useAttendanceReport({
    fromDate: range.fromDate,
    toDate: range.toDate,
    page,
    limit,
    ...(employeeId ? { employeeId } : {}),
    ...(reuseCutoff && reportingCutoff
      ? { asOf: reportingCutoff }
      : {}),
  });
  const report = reportQuery.data;
  const canExport = Boolean(
    validation.valid &&
      reportQuery.isSuccess &&
      !reportQuery.isError &&
      !reportQuery.isFetching &&
      report?.asOf &&
      report.period.fromDate === range.fromDate &&
      report.period.toDate === range.toDate &&
      report.pagination.page === page &&
      report.pagination.limit === limit,
  );
  const pagination = report?.pagination;
  const lastPage = Math.max(1, pagination?.totalPages ?? 1);
  const pageNeedsCorrection =
    Boolean(report && pagination?.totalEmployees && page > lastPage);

  useEffect(() => {
    if (report?.asOf) {
      setReportingCutoff((current) => current ?? report.asOf);
    }
  }, [report]);

  useEffect(() => {
    if (!report || !pagination?.totalEmployees || page <= lastPage) return;
    setPage(lastPage);
    setReuseCutoff(true);
  }, [lastPage, page, pagination?.totalEmployees, report]);

  const resetReportScope = () => {
    setPage(1);
    setReportingCutoff(null);
    setReuseCutoff(false);
    setNavigationError("");
    setDownloadError("");
  };

  const changeMode = (nextMode: ReportMode) => {
    if (nextMode === "custom") {
      resetReportScope();
      setMode(nextMode);
      return;
    }

    const anchor = validation.valid
      ? range.toDate
      : getCurrentBusinessDate();
    try {
      const nextRange = getAttendanceReportPeriodRange(nextMode, anchor);
      resetReportScope();
      setRange(nextRange);
      setMode(nextMode);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      setNavigationError("This report cannot move beyond years 0001–9999.");
    }
  };

  const changeCustomDate = (
    key: keyof AttendanceReportDateRange,
    value: string,
  ) => {
    setRange((current) => ({ ...current, [key]: value }));
    resetReportScope();
  };

  const navigatePeriod = (direction: -1 | 1) => {
    if (mode === "custom") return;
    try {
      setRange(navigateAttendanceReportPeriod(range, mode, direction));
      resetReportScope();
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      setNavigationError("This report cannot move beyond years 0001–9999.");
    }
  };

  const changeEmployee = (employee: EmployeeOption | null) => {
    const nextEmployeeId = employee?._id ?? "";
    if (nextEmployeeId === employeeId) return;
    setEmployeeId(nextEmployeeId);
    setSelectedEmployee(employee);
    resetReportScope();
  };

  const changePageSize = (nextLimit: number) => {
    setLimit(nextLimit);
    setPage(1);
    setReuseCutoff(true);
  };

  const moveToPage = (nextPage: number) => {
    setPage(nextPage);
    setReuseCutoff(true);
  };

  const downloadReport = async (format: "xlsx" | "pdf") => {
    if (!canExport || !report?.asOf || downloadType) return;
    const request: AttendanceReportExportQuery = {
      fromDate: range.fromDate,
      toDate: range.toDate,
      periodType: mode,
      asOf: report.asOf,
      ...(employeeId ? { employeeId } : {}),
    };
    setDownloadType(format);
    setDownloadError("");
    try {
      const { blob, filename } = await downloadAttendanceReportExport(
        format,
        request,
      );
      const anchor = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      try {
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }
    } catch {
      setDownloadError(
        `The ${format.toUpperCase()} attendance report could not be downloaded. Try again.`,
      );
    } finally {
      setDownloadType(null);
    }
  };

  const errorMessage = reportQuery.error
    ? getReportErrorMessage(reportQuery.error)
    : "";
  const isForbidden =
    Boolean(reportQuery.error) &&
    isAxiosError(reportQuery.error) &&
    reportQuery.error.response?.status === 403;
  const hasScope = validation.valid;
  const calculatedThrough = report?.period.calculatedThroughDate;
  const isCurrentPresetPeriod =
    mode !== "custom" &&
    report?.period.toDate === getCurrentBusinessDate();
  const hasPartialCutoff = Boolean(
    report &&
      calculatedThrough &&
      (calculatedThrough < report.period.toDate || isCurrentPresetPeriod),
  );

  return (
    <main className="min-w-0 space-y-5 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Attendance reports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Employee attendance for {formatBusinessDate(range.fromDate)} to{" "}
            {formatBusinessDate(range.toDate)} · {TIME_ZONE}
          </p>
        </div>
        <Link
          to="/admin/attendance"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-md border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CalendarDays aria-hidden="true" className="size-4" />
          Attendance dashboard
        </Link>
      </header>

      <Card className="shadow-none">
        <CardContent className="grid min-w-0 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(14rem,1fr)]">
          <div className="min-w-0 space-y-4">
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(10rem,0.8fr)_minmax(0,1.2fr)]">
              <div className="min-w-0">
                <label
                  htmlFor="attendance-report-period"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Period
                </label>
                <select
                  id="attendance-report-period"
                  className={CONTROL_CLASS}
                  value={mode}
                  onChange={(event) => changeMode(event.target.value as ReportMode)}
                >
                  <option value="week">Weekly</option>
                  <option value="month">Monthly</option>
                  <option value="year">Yearly</option>
                  <option value="custom">Custom date range</option>
                </select>
              </div>
              {mode === "custom" ? (
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label
                      htmlFor="attendance-report-from-date"
                      className="mb-1.5 block text-sm font-medium"
                    >
                      From date
                    </label>
                    <input
                      id="attendance-report-from-date"
                      type="date"
                      className={CONTROL_CLASS}
                      aria-invalid={!validation.valid}
                      aria-describedby={
                        validation.valid
                          ? undefined
                          : "attendance-report-range-error"
                      }
                      value={range.fromDate}
                      onChange={(event) =>
                        changeCustomDate("fromDate", event.target.value)
                      }
                    />
                  </div>
                  <div className="min-w-0">
                    <label
                      htmlFor="attendance-report-to-date"
                      className="mb-1.5 block text-sm font-medium"
                    >
                      To date
                    </label>
                    <input
                      id="attendance-report-to-date"
                      type="date"
                      className={CONTROL_CLASS}
                      aria-invalid={!validation.valid}
                      aria-describedby={
                        validation.valid
                          ? undefined
                          : "attendance-report-range-error"
                      }
                      value={range.toDate}
                      onChange={(event) =>
                        changeCustomDate("toDate", event.target.value)
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="min-w-0">
                  <span className="mb-1.5 block text-sm font-medium">
                    {getPeriodLabel(mode)} range
                  </span>
                  <div className="flex min-w-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-11"
                      aria-label={`Previous ${mode}`}
                      onClick={() => navigatePeriod(-1)}
                    >
                      <ArrowLeft aria-hidden="true" className="size-4" />
                    </Button>
                    <p className="min-w-0 flex-1 text-center text-sm tabular-nums">
                      <span className="block truncate">
                        {formatBusinessDate(range.fromDate)} –{" "}
                        {formatBusinessDate(range.toDate)}
                      </span>
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-11"
                      aria-label={`Next ${mode}`}
                      onClick={() => navigatePeriod(1)}
                    >
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
            {mode === "custom" && (
              <p className="text-xs text-muted-foreground">
                Custom ranges include at most 366 calendar days.
              </p>
            )}
            {navigationError && (
              <p role="alert" className="text-sm text-destructive">
                {navigationError}
              </p>
            )}
            {hasScope === false && (
              <p
                id="attendance-report-range-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {getRangeErrorMessage(validation)}
              </p>
            )}
          </div>

          <EmployeeSearchSelector
            selectedEmployee={selectedEmployee}
            onSelect={(employee) => changeEmployee(employee)}
            onClear={() => changeEmployee(null)}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Exports include all employees matching these filters, not only this page.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!canExport || downloadType !== null}
            onClick={() => void downloadReport("xlsx")}
          >
            {downloadType === "xlsx" ? "Preparing Excel…" : "Download Excel"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canExport || downloadType !== null}
            onClick={() => void downloadReport("pdf")}
          >
            {downloadType === "pdf" ? "Preparing PDF…" : "Download PDF"}
          </Button>
        </div>
      </div>
      {downloadError && (
        <p role="alert" className="text-sm text-destructive">
          {downloadError}
        </p>
      )}

      {report && calculatedThrough && hasPartialCutoff && (
        <p
          role="status"
          className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm"
        >
          {isCurrentPresetPeriod
            ? `This ${getPeriodLabel(mode).toLowerCase()} period is in progress. `
            : "The selected range is partially calculated. "}
          Attendance is calculated through {formatBusinessDate(calculatedThrough)};
          later dates are not included.
        </p>
      )}

      {reportQuery.isFetching && report && (
        <p role="status" className="text-sm text-muted-foreground">
          Updating report…
        </p>
      )}

      {reportQuery.isError && !report && !isForbidden && (
        <ReportError
          message={errorMessage}
          onRetry={() => void reportQuery.refetch()}
        />
      )}
      {reportQuery.isError && report && !isForbidden && (
        <ReportError
          message={`${errorMessage} Previous results remain visible.`}
          onRetry={() => void reportQuery.refetch()}
        />
      )}
      {isForbidden && (
        <p role="status" className="rounded-md border border-border p-4 text-sm">
          Access denied. You do not have permission to view attendance reports.
        </p>
      )}

      {!hasScope || isForbidden ? null : reportQuery.isLoading && !report ? (
        <ReportLoadingState />
      ) : report ? (
        <section aria-label="Attendance report results" className="space-y-4">
          {pageNeedsCorrection ? (
            <p role="status" className="rounded-md border border-border p-4 text-sm">
              This page is outside the available results. Moving to the last available page…
            </p>
          ) : pagination?.totalEmployees === 0 ? (
            <Card className="shadow-none">
              <CardContent className="p-5">
                <h2 className="font-medium">No matching employees</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  No employee attendance matches the selected period and filter.
                </p>
              </CardContent>
            </Card>
          ) : report.employees.length === 0 ? (
            <Card className="shadow-none">
              <CardContent className="p-5">
                <h2 className="font-medium">No employees on this page</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  The report returned no employee rows for this page.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {report.employees.map((employee) => (
                <EmployeeReportCard
                  key={employee.employeeId}
                  employee={employee}
                  employees={employees}
                />
              ))}
              <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {NUMBER_FORMAT.format(pagination?.totalEmployees ?? 0)} employees ·
                  {" "}page {pagination?.page ?? page} of {lastPage}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="attendance-report-page-size"
                    className="text-sm text-muted-foreground"
                  >
                    Rows per page
                  </label>
                  <select
                    id="attendance-report-page-size"
                    className="h-11 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={limit}
                    onChange={(event) =>
                      changePageSize(Number(event.target.value))
                    }
                  >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={page <= 1 || reportQuery.isFetching}
                    onClick={() => moveToPage(Math.max(1, page - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={page >= lastPage || reportQuery.isFetching}
                    onClick={() => moveToPage(Math.min(lastPage, page + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}
