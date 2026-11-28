import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import { getATMDisplayId } from "@/features/atms/atmDisplay.utils";
import {
  CalendarClock,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBanks } from "@/features/banks/hooks/useBanks";
import { useEmployeeOptions } from "@/features/employees/hooks/useEmployeeOptions";
import { useUpdateRecurringPlan } from "@/features/recurring-maintenance/hooks/useUpdateRecurringPlan";
import { useRecurringPlans } from "@/features/recurring-maintenance/hooks/useRecurringPlans";
import { useCleaningMonitoring } from "@/features/recurring-maintenance/hooks/useCleaningMonitoring";
import { useDistricts } from "@/features/users/hooks/useDistricts";
import { useRegionsByBank } from "@/features/users/hooks/useRegionsByBank";
import { getCurrentBusinessDate } from "@/features/attendance/attendanceReport.utils";
import RecurringPlanDialog from "@/features/recurring-maintenance/components/RecurringPlanDialog";
import { downloadRecurringCleaningExport } from "@/features/recurring-maintenance/services/recurring-maintenance.service";
import type {
  CleaningMonitoringStatus,
  RecurringCleaningExportQuery,
  RecurringMaintenancePlan,
  RecurringMaintenanceType,
} from "@/features/recurring-maintenance/types/recurring-maintenance.types";
import type { EmployeeOption } from "@/services/employee.service";

const EXPORT_CONTROL_CLASS =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";
const EXPORT_MAX_DAYS = 366;
const DAY_IN_MILLISECONDS = 86_400_000;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONITORING_STATUSES: CleaningMonitoringStatus[] = [
  "GREEN",
  "RED",
  "GRACE_PERIOD",
  "NO_HISTORY",
  "CONFIGURATION_REQUIRED",
];

const getMonitoringTypeFilter = (
  value: string,
): "ALL" | "DAILY_CLEANING" | "WEEKLY_MOPPING" =>
  value === "DAILY_CLEANING" || value === "WEEKLY_MOPPING" ? value : "ALL";

const getMonitoringStatusFilter = (
  value: string,
): "ALL" | CleaningMonitoringStatus =>
  value === "ALL"
    ? "ALL"
    : (MONITORING_STATUSES.find((status) => status === value) ?? "ALL");

const MONITORING_STATUS_LABELS: Record<CleaningMonitoringStatus, string> = {
  GREEN: "On schedule",
  RED: "Overdue",
  GRACE_PERIOD: "Grace period",
  NO_HISTORY: "No history",
  CONFIGURATION_REQUIRED: "Configuration required",
};

const MONITORING_STATUS_STYLES: Record<CleaningMonitoringStatus, string> = {
  GREEN:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  RED: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200",
  GRACE_PERIOD: "border-border bg-muted text-muted-foreground",
  NO_HISTORY:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  CONFIGURATION_REQUIRED:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

function getEmployeeOptionLabel(employee: EmployeeOption) {
  const name =
    [employee.firstName, employee.lastName]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(" ")
      .trim() || "Name unavailable";
  return employee.employeeCode ? `${name} · ${employee.employeeCode}` : name;
}

function SearchableEmployeeSelect({
  id,
  selectedEmployee,
  options,
  searchValue,
  onSearchChange,
  onChange,
  isError,
  isFetching,
  isSearchSettled,
  pagination,
  page,
  onPageChange,
  onRetry,
}: {
  id: string;
  selectedEmployee: EmployeeOption | null;
  options: EmployeeOption[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onChange: (employee: EmployeeOption | null) => void;
  isError: boolean;
  isFetching: boolean;
  isSearchSettled: boolean;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  page: number;
  onPageChange: (page: number) => void;
  onRetry: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    searchRef.current?.focus();

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const closeAndRestoreFocus = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const focusAdjacentOption = (direction: 1 | -1) => {
    const optionElements = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(
        '[role="option"]:not([aria-disabled="true"])',
      ) ?? [],
    );
    if (optionElements.length === 0) return;
    const currentIndex = optionElements.indexOf(
      document.activeElement as HTMLElement,
    );
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : optionElements.length - 1
        : (currentIndex + direction + optionElements.length) %
          optionElements.length;
    optionElements[nextIndex]?.focus();
  };

  const optionsToShow =
    selectedEmployee &&
    !options.some((employee) => employee._id === selectedEmployee._id)
      ? [selectedEmployee, ...options]
      : options;

  return (
    <div ref={rootRef} className="relative grid content-start gap-1">
      <span id={`${id}-label`} className="text-sm font-medium">
        Employee
      </span>
      <div className="flex min-w-0 gap-2">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={`${id}-popup`}
          aria-labelledby={`${id}-label`}
          disabled={!isSearchSettled}
          onClick={() => {
            setIsOpen((current) => !current);
          }}
          className={`${EXPORT_CONTROL_CLASS} flex min-w-0 flex-1 items-center justify-between gap-2 text-left disabled:cursor-not-allowed`}
        >
          <span className="truncate">
            {selectedEmployee
              ? getEmployeeOptionLabel(selectedEmployee)
              : "All employees"}
          </span>
          <ChevronDown
            className={`size-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {selectedEmployee && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10"
            onClick={() => onChange(null)}
          >
            <X className="size-4" />
            Clear
          </Button>
        )}
      </div>
      {isOpen && (
        <div
          id={`${id}-popup`}
          className="absolute top-full right-0 left-0 z-50 mt-1 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md"
          role="region"
          aria-labelledby={`${id}-label`}
        >
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="search"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusAdjacentOption(1);
                }
              }}
              placeholder="Search employees..."
              aria-label="Search employees"
              className="h-10 w-full rounded-md border border-input bg-transparent pr-3 pl-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div
            className="mt-2 max-h-52 overflow-y-auto"
            role="listbox"
            aria-label="Employee options"
          >
            {isError ? (
              <p role="alert" className="px-2 py-4 text-center text-sm text-destructive">
                Employee options could not be loaded.{" "}
                <button type="button" className="underline" onClick={onRetry}>
                  Retry
                </button>
              </p>
            ) : isFetching || !isSearchSettled ? (
              <p role="status" className="px-2 py-4 text-center text-sm text-muted-foreground">
                Searching employees…
              </p>
            ) : (
              <>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedEmployee === null}
                  className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                  onClick={() => {
                    onChange(null);
                    closeAndRestoreFocus();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      focusAdjacentOption(1);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      focusAdjacentOption(-1);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      closeAndRestoreFocus();
                    }
                  }}
                >
                  All employees
                </button>
                {optionsToShow.length === 0 ? (
                  <p role="status" className="px-2 py-4 text-center text-sm text-muted-foreground">
                    No employees found.
                  </p>
                ) : (
                  optionsToShow.map((employee) => (
                    <button
                      key={employee._id}
                      type="button"
                      role="option"
                      aria-selected={selectedEmployee?._id === employee._id}
                      className="flex w-full items-center rounded-md px-2 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                      onClick={() => {
                        onChange(employee);
                        closeAndRestoreFocus();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          focusAdjacentOption(1);
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          focusAdjacentOption(-1);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          closeAndRestoreFocus();
                        }
                      }}
                    >
                      {getEmployeeOptionLabel(employee)}
                    </button>
                  ))
                )}
              </>
            )}
          </div>
          {pagination && pagination.totalPages > 1 && !isError && (
            <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
              <span className="text-xs text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} ·{" "}
                {pagination.total} employees
              </span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages}
                  onClick={() =>
                    onPageChange(Math.min(pagination.totalPages, page + 1))
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getExportDateRangeError(fromDate: string, toDate: string) {
  if (!fromDate || !toDate) return "Choose both a start date and an end date.";

  const getTimestamp = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      return null;
    }
    return date.getTime();
  };

  const from = getTimestamp(fromDate);
  const to = getTimestamp(toDate);
  if (from === null || to === null) {
    return "Enter valid dates in YYYY-MM-DD format.";
  }
  if (from > to) return "The start date must be on or before the end date.";

  const inclusiveDays = (to - from) / DAY_IN_MILLISECONDS + 1;
  if (inclusiveDays > EXPORT_MAX_DAYS) {
    return `The date range cannot exceed ${EXPORT_MAX_DAYS} days.`;
  }
  return null;
}

function getErrorPayloadMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const message =
    "message" in payload && typeof payload.message === "string"
      ? payload.message
      : "";
  const details =
    "errors" in payload && Array.isArray(payload.errors)
      ? payload.errors
          .map((item) => {
            if (typeof item === "string") return item;
            if (!item || typeof item !== "object") return "";
            const path =
              "path" in item && typeof item.path === "string"
                ? item.path
                : "";
            const detail =
              "message" in item && typeof item.message === "string"
                ? item.message
                : "";
            return detail ? `${path ? `${path}: ` : ""}${detail}` : "";
          })
          .filter(Boolean)
      : [];

  return [message, ...details].filter(Boolean).join(": ") || null;
}

async function getCleaningExportErrorMessage(error: unknown) {
  if (!isAxiosError(error)) {
    return error instanceof Error
      ? error.message
      : "The cleaning export could not be generated.";
  }

  const responseData: unknown = error.response?.data;
  if (responseData instanceof Blob) {
    const text = await responseData.text();
    try {
      const payload: unknown = JSON.parse(text);
      const message = getErrorPayloadMessage(payload);
      if (message) return message;
    } catch (parseError) {
      if (!(parseError instanceof SyntaxError)) throw parseError;
    }
  } else {
    const message = getErrorPayloadMessage(responseData);
    if (message) return message;
  }

  return error.response?.status
    ? `The cleaning export failed (HTTP ${error.response.status}).`
    : error.message || "The cleaning export could not be generated.";
}

function formatPlanDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getMaintenanceLabel(plan: RecurringMaintenancePlan) {
  return plan.maintenanceType === "DAILY_CLEANING"
    ? "Daily Cleaning"
    : "Weekly Mopping";
}

function getCleaningDetailPath(plan: RecurringMaintenancePlan) {
  if (
    plan.maintenanceType !== "DAILY_CLEANING" &&
    plan.maintenanceType !== "WEEKLY_MOPPING"
  ) {
    return null;
  }
  return `/admin/recurring-maintenance/${plan._id}`;
}

function getScheduleLabel(plan: RecurringMaintenancePlan) {
  if (plan.maintenanceType === "DAILY_CLEANING") return "Daily";
  return plan.dayOfWeek === null || plan.dayOfWeek === undefined
    ? "Weekday not set"
    : `Every ${WEEKDAYS[plan.dayOfWeek]}`;
}

function getATM(plan: RecurringMaintenancePlan) {
  return typeof plan.atmId === "string" ? null : plan.atmId;
}

function getResponsibleEmployee(plan: RecurringMaintenancePlan) {
  const employee = plan.assignedEmployeeId;
  if (!employee) return "Not configured";
  if (typeof employee === "string") return "Employee details unavailable";
  const name =
    [employee.userId?.firstName, employee.userId?.lastName]
      .filter(Boolean)
      .join(" ") || "Employee name unavailable";
  return `${name}${employee.employeeCode ? ` · ${employee.employeeCode}` : ""}`;
}

function getMonitoringEmployeeName(
  employee:
    | {
        employeeCode?: string;
        userId?: { firstName?: string; lastName?: string } | null;
      }
    | null,
) {
  if (!employee) return "Not configured";
  const name =
    [employee.userId?.firstName, employee.userId?.lastName]
      .filter(Boolean)
      .join(" ") || "Employee name unavailable";
  return `${name}${employee.employeeCode ? ` · ${employee.employeeCode}` : ""}`;
}

function getCleaningAgeLabel(ageInCalendarDays: number | null) {
  if (ageInCalendarDays === null) return "No valid cleaning record";
  if (ageInCalendarDays === 0) return "Today";
  if (ageInCalendarDays === 1) return "1 day ago";
  if (ageInCalendarDays < 0) return `${Math.abs(ageInCalendarDays)} days ahead`;
  return `${ageInCalendarDays} days ago`;
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return (
      error.response?.data?.message ||
      "Could not update the recurring maintenance plan."
    );
  }
  return error instanceof Error
    ? error.message
    : "Could not update the recurring maintenance plan.";
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border" role="status">
      <div className="h-11 border-b bg-muted/50" />
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-2 gap-4 border-b px-4 py-4 last:border-0 md:grid-cols-7"
        >
          {Array.from({ length: 7 }, (_, cellIndex) => (
            <div
              key={cellIndex}
              className="h-4 animate-pulse rounded bg-muted"
            />
          ))}
        </div>
      ))}
      <p className="sr-only">Loading recurring maintenance plans...</p>
    </div>
  );
}

export default function RecurringMaintenancePage() {
  const {
    data: plans = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useRecurringPlans();
  const monitoringQuery = useCleaningMonitoring();
  const updatePlan = useUpdateRecurringPlan();
  const banksQuery = useBanks();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [monitoringTypeFilter, setMonitoringTypeFilter] = useState<
    "ALL" | "DAILY_CLEANING" | "WEEKLY_MOPPING"
  >("ALL");
  const [monitoringStatusFilter, setMonitoringStatusFilter] = useState<
    "ALL" | CleaningMonitoringStatus
  >("ALL");
  const [editingPlan, setEditingPlan] =
    useState<RecurringMaintenancePlan | null>(null);
  const [planToToggle, setPlanToToggle] =
    useState<RecurringMaintenancePlan | null>(null);
  const [exportFromDate, setExportFromDate] = useState("");
  const [exportToDate, setExportToDate] = useState(() =>
    getCurrentBusinessDate(),
  );
  const [exportBankId, setExportBankId] = useState("");
  const [exportRegionId, setExportRegionId] = useState("");
  const [exportDistrictId, setExportDistrictId] = useState("");
  const [exportMaintenanceType, setExportMaintenanceType] = useState<
    "ALL" | RecurringMaintenanceType
  >("ALL");
  const [exportMonitoringStatus, setExportMonitoringStatus] = useState<
    "ALL" | CleaningMonitoringStatus
  >("ALL");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [debouncedEmployeeSearch, setDebouncedEmployeeSearch] = useState("");
  const [employeePage, setEmployeePage] = useState(1);
  const [exportEmployee, setExportEmployee] = useState<EmployeeOption | null>(
    null,
  );
  const [exporting, setExporting] = useState(false);
  const [exportValidationError, setExportValidationError] = useState("");
  const exportAbortControllerRef = useRef<AbortController | null>(null);
  const exportMountedRef = useRef(true);

  useEffect(() => {
    exportMountedRef.current = true;
    return () => {
      exportMountedRef.current = false;
      exportAbortControllerRef.current?.abort();
      exportAbortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedEmployeeSearch(employeeSearch.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [employeeSearch]);

  const regionsQuery = useRegionsByBank(exportBankId, true);
  const districtsQuery = useDistricts(Boolean(exportRegionId), exportRegionId);
  const employeeOptionsQuery = useEmployeeOptions(
    debouncedEmployeeSearch,
    employeePage,
  );
  const employeeSearchIsSettled =
    employeeSearch.trim() === debouncedEmployeeSearch;
  const employeeOptions = employeeSearchIsSettled
    ? (employeeOptionsQuery.data?.employees ?? [])
    : [];
  const employeePagination = employeeOptionsQuery.data?.pagination;

  const openCreateDialog = () => {
    setEditingPlan(null);
    setDialogOpen(true);
  };

  const openEditDialog = (plan: RecurringMaintenancePlan) => {
    setEditingPlan(plan);
    setDialogOpen(true);
  };

  const confirmToggle = async () => {
    if (!planToToggle) return;
    const nextActiveState = !planToToggle.isActive;

    try {
      await updatePlan.mutateAsync({
        planId: planToToggle._id,
        data: { isActive: nextActiveState },
      });
      toast.success(
        nextActiveState
          ? "Recurring plan activated."
          : "Recurring plan deactivated.",
      );
      setPlanToToggle(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const monitoringRecords = (monitoringQuery.data ?? []).filter(
    (record) =>
      (monitoringTypeFilter === "ALL" ||
        record.maintenanceType === monitoringTypeFilter) &&
      (monitoringStatusFilter === "ALL" ||
        record.status === monitoringStatusFilter),
  );

  const exportCleaningReport = async () => {
    if (exporting) return;
    const dateRangeError = getExportDateRangeError(
      exportFromDate,
      exportToDate,
    );
    if (dateRangeError) {
      setExportValidationError(dateRangeError);
      return;
    }

    setExportValidationError("");
    setExporting(true);
    const abortController = new AbortController();
    exportAbortControllerRef.current = abortController;
    try {
      const filters: RecurringCleaningExportQuery = {
        fromDate: exportFromDate,
        toDate: exportToDate,
        ...(exportBankId ? { bankId: exportBankId } : {}),
        ...(exportRegionId ? { regionId: exportRegionId } : {}),
        ...(exportDistrictId ? { districtId: exportDistrictId } : {}),
        ...(exportEmployee ? { employeeId: exportEmployee._id } : {}),
        ...(exportMaintenanceType !== "ALL"
          ? { maintenanceType: exportMaintenanceType }
          : {}),
        ...(exportMonitoringStatus !== "ALL"
          ? { monitoringStatus: exportMonitoringStatus }
          : {}),
      };
      const result = await downloadRecurringCleaningExport(
        filters,
        abortController.signal,
      );
      if (
        !exportMountedRef.current ||
        abortController.signal.aborted
      ) {
        return;
      }
      const anchor = document.createElement("a");
      const objectUrl = URL.createObjectURL(result.blob);
      try {
        anchor.href = objectUrl;
        anchor.download =
          result.filename ||
          `recurring-cleaning-${exportFromDate}-to-${exportToDate}.xlsx`;
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }
      toast.success("Cleaning export downloaded.");
    } catch (error) {
      if (
        exportMountedRef.current &&
        !abortController.signal.aborted &&
        !(
          isAxiosError(error) &&
          error.code === "ERR_CANCELED"
        )
      ) {
        const message = await getCleaningExportErrorMessage(error);
        if (
          exportMountedRef.current &&
          !abortController.signal.aborted
        ) {
          toast.error(message);
        }
      }
    } finally {
      if (exportAbortControllerRef.current === abortController) {
        exportAbortControllerRef.current = null;
      }
      if (exportMountedRef.current) {
        setExporting(false);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <div className="h-8 w-72 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
        </div>
        <TableSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Recurring Maintenance</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage automatic daily cleaning and weekly mopping schedules.
            Monthly deep cleaning is managed through AMC.
          </p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <Plus />
          Create Recurring Plan
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Cleaning Monitoring</CardTitle>
            <p className="text-sm text-muted-foreground">
              Active cleaning plans and their latest valid cleaning record.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1 text-sm font-medium">
              Maintenance type
              <select
                value={monitoringTypeFilter}
                onChange={(event) =>
                  setMonitoringTypeFilter(
                    getMonitoringTypeFilter(event.target.value),
                  )
                }
                className="h-9 min-w-44 rounded-lg border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="ALL">All types</option>
                <option value="DAILY_CLEANING">Daily Cleaning</option>
                <option value="WEEKLY_MOPPING">Weekly Mopping</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Monitoring status
              <select
                value={monitoringStatusFilter}
                onChange={(event) =>
                  setMonitoringStatusFilter(
                    getMonitoringStatusFilter(event.target.value),
                  )
                }
                className="h-9 min-w-48 rounded-lg border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="ALL">All statuses</option>
                {MONITORING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {MONITORING_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {monitoringQuery.isLoading && !monitoringQuery.data ? (
            <div className="space-y-3 p-5" role="status">
              <p className="text-sm text-muted-foreground">
                Loading cleaning monitoring...
              </p>
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="h-9 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : monitoringQuery.isError && !monitoringQuery.data ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 p-5"
              role="alert"
            >
              <p className="text-sm text-destructive">
                Could not load cleaning monitoring.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={monitoringQuery.isFetching}
                onClick={() => void monitoringQuery.refetch()}
              >
                {monitoringQuery.isFetching ? "Retrying..." : "Retry"}
              </Button>
            </div>
          ) : monitoringRecords.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              {monitoringQuery.data?.length
                ? "No active cleaning plans match these filters."
                : "No active cleaning plans to monitor."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="border-y bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">ATM</th>
                    <th className="px-4 py-3 text-left font-medium">
                      Maintenance
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Responsible Employee
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Latest Valid Cleaning
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Monitoring Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {monitoringRecords.map((record) => (
                    <tr key={record.planId} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">
                        {getATMDisplayId(record.atm) || "ATM details unavailable"}
                        {record.atm?.locationName && (
                          <span className="mt-1 block font-normal text-muted-foreground">
                            {record.atm.locationName}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {record.maintenanceType === "DAILY_CLEANING"
                          ? "Daily Cleaning"
                          : "Weekly Mopping"}
                      </td>
                      <td className="px-4 py-3">
                        {getMonitoringEmployeeName(record.responsibleEmployee)}
                      </td>
                      <td className="px-4 py-3">
                        {record.latestCleaningDate
                          ? formatPlanDate(record.latestCleaningDate)
                          : "—"}
                        <span className="mt-1 block text-muted-foreground">
                          {getCleaningAgeLabel(record.ageInCalendarDays)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={`whitespace-nowrap ${MONITORING_STATUS_STYLES[record.status]}`}
                        >
                          {MONITORING_STATUS_LABELS[record.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" />
            Cleaning Export
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Dates filter Scheduled Jobs only, using inclusive Asia/Kolkata
            calendar days (up to 366 days). Other filters apply to both
            worksheets; monitoring status means each plan&apos;s current
            monitoring status.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label
              htmlFor="cleaning-export-from-date"
              className="grid content-start gap-2 text-sm font-medium"
            >
              From Date
              <input
                id="cleaning-export-from-date"
                type="date"
                required
                aria-required="true"
                aria-invalid={Boolean(exportValidationError)}
                aria-describedby={
                  exportValidationError
                    ? "cleaning-export-date-error"
                    : undefined
                }
                className={EXPORT_CONTROL_CLASS}
                value={exportFromDate}
                onChange={(event) => {
                  setExportFromDate(event.target.value);
                  setExportValidationError("");
                }}
              />
            </label>
            <label
              htmlFor="cleaning-export-to-date"
              className="grid content-start gap-2 text-sm font-medium"
            >
              To Date
              <input
                id="cleaning-export-to-date"
                type="date"
                required
                aria-required="true"
                aria-invalid={Boolean(exportValidationError)}
                aria-describedby={
                  exportValidationError
                    ? "cleaning-export-date-error"
                    : undefined
                }
                className={EXPORT_CONTROL_CLASS}
                value={exportToDate}
                onChange={(event) => {
                  setExportToDate(event.target.value);
                  setExportValidationError("");
                }}
              />
            </label>
            <label
              htmlFor="cleaning-export-bank"
              className="grid content-start gap-2 text-sm font-medium"
            >
              Bank
              <select
                id="cleaning-export-bank"
                className={EXPORT_CONTROL_CLASS}
                value={exportBankId}
                onChange={(event) => {
                  setExportBankId(event.target.value);
                  setExportRegionId("");
                  setExportDistrictId("");
                }}
                disabled={banksQuery.isLoading}
              >
                <option value="">All banks</option>
                {(banksQuery.data ?? []).map((bank) => (
                  <option key={bank._id} value={bank._id}>
                    {bank.bankName}
                  </option>
                ))}
              </select>
              {banksQuery.isError && (
                <span role="alert" className="text-xs text-destructive">
                  Bank options could not be loaded.
                </span>
              )}
            </label>
            <label
              htmlFor="cleaning-export-region"
              className="grid content-start gap-2 text-sm font-medium"
            >
              Region
              <select
                id="cleaning-export-region"
                className={EXPORT_CONTROL_CLASS}
                value={exportRegionId}
                onChange={(event) => {
                  setExportRegionId(event.target.value);
                  setExportDistrictId("");
                }}
                disabled={
                  !exportBankId ||
                  regionsQuery.isLoading ||
                  regionsQuery.isError
                }
              >
                <option value="">All regions</option>
                {(regionsQuery.data ?? []).map((region) => (
                  <option key={region._id} value={region._id}>
                    {region.name}
                  </option>
                ))}
              </select>
              {regionsQuery.isError && (
                <span role="alert" className="text-xs text-destructive">
                  Region options could not be loaded.
                </span>
              )}
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label
              htmlFor="cleaning-export-district"
              className="grid content-start gap-2 text-sm font-medium"
            >
              District
              <select
                id="cleaning-export-district"
                className={EXPORT_CONTROL_CLASS}
                value={exportDistrictId}
                onChange={(event) => setExportDistrictId(event.target.value)}
                disabled={
                  !exportRegionId ||
                  districtsQuery.isLoading ||
                  districtsQuery.isError
                }
              >
                <option value="">All districts</option>
                {(districtsQuery.data ?? []).map((district) => (
                  <option key={district._id} value={district._id}>
                    {district.districtName}
                  </option>
                ))}
              </select>
              {districtsQuery.isError && (
                <span role="alert" className="text-xs text-destructive">
                  District options could not be loaded.
                </span>
              )}
            </label>
            <SearchableEmployeeSelect
              id="cleaning-export-employee"
              selectedEmployee={exportEmployee}
              options={employeeOptions}
              searchValue={employeeSearch}
              onSearchChange={(value) => {
                setEmployeeSearch(value);
                setEmployeePage(1);
              }}
              onChange={setExportEmployee}
              isError={employeeOptionsQuery.isError}
              isFetching={employeeOptionsQuery.isFetching}
              isSearchSettled={employeeSearchIsSettled}
              pagination={employeePagination}
              page={employeePage}
              onPageChange={setEmployeePage}
              onRetry={() => void employeeOptionsQuery.refetch()}
            />
            <label
              htmlFor="cleaning-export-maintenance-type"
              className="grid content-start gap-2 text-sm font-medium"
            >
              Plan Type
              <select
                id="cleaning-export-maintenance-type"
                className={EXPORT_CONTROL_CLASS}
                value={exportMaintenanceType}
                onChange={(event) =>
                  setExportMaintenanceType(
                    event.target.value === "DAILY_CLEANING" ||
                      event.target.value === "WEEKLY_MOPPING"
                      ? event.target.value
                      : "ALL",
                  )
                }
              >
                <option value="ALL">All plan types</option>
                <option value="DAILY_CLEANING">Daily cleaning</option>
                <option value="WEEKLY_MOPPING">Weekly mopping</option>
              </select>
            </label>
            <label
              htmlFor="cleaning-export-monitoring-status"
              className="grid content-start gap-2 text-sm font-medium"
            >
              Monitoring Status
              <select
                id="cleaning-export-monitoring-status"
                className={EXPORT_CONTROL_CLASS}
                value={exportMonitoringStatus}
                onChange={(event) =>
                  setExportMonitoringStatus(
                    getMonitoringStatusFilter(event.target.value),
                  )
                }
              >
                <option value="ALL">All statuses</option>
                {MONITORING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {MONITORING_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {exportValidationError && (
            <p
              id="cleaning-export-date-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {exportValidationError}
            </p>
          )}
          <div className="flex flex-wrap justify-end border-t pt-4">
            <Button
              type="button"
              disabled={exporting}
              onClick={() => void exportCleaningReport()}
            >
              <Download />
              {exporting ? "Preparing Excel…" : "Export Excel"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div>
              <p className="font-medium text-destructive">
                Failed to load recurring maintenance plans.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Check your connection and try again.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={isFetching ? "animate-spin" : ""} />
              {isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center px-6 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CalendarClock className="size-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">
              No recurring maintenance plans yet.
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Create a plan to automatically schedule daily cleaning or weekly
              mopping for an ATM.
            </p>
            <Button className="mt-5" type="button" onClick={openCreateDialog}>
              <Plus />
              Create Recurring Plan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Maintenance Plans</CardTitle>
            <span className="text-sm text-muted-foreground">
              {plans.length} {plans.length === 1 ? "plan" : "plans"}
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="border-y bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">ATM</th>
                    <th className="px-4 py-3 text-left font-medium">
                      Location
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Maintenance
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Schedule
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Responsible Employee
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Start Date
                    </th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => {
                    const atm = getATM(plan);
                    const cleaningDetailPath = getCleaningDetailPath(plan);
                    return (
                      <tr key={plan._id} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">
                          {cleaningDetailPath ? (
                            <Link
                              to={cleaningDetailPath}
                              className="text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {getATMDisplayId(atm) || "ATM details unavailable"}
                            </Link>
                          ) : (
                            getATMDisplayId(atm) || "ATM details unavailable"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {atm?.locationName || "Not available"}
                        </td>
                        <td className="px-4 py-3">
                          {cleaningDetailPath ? (
                            <Link
                              to={cleaningDetailPath}
                              className="underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {getMaintenanceLabel(plan)}
                            </Link>
                          ) : (
                            getMaintenanceLabel(plan)
                          )}
                        </td>
                        <td className="px-4 py-3">{getScheduleLabel(plan)}</td>
                        <td className="px-4 py-3">
                          {getResponsibleEmployee(plan)}
                        </td>
                        <td className="px-4 py-3">
                          {formatPlanDate(plan.startDate)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={plan.isActive ? "default" : "secondary"}
                          >
                            {plan.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(plan)}
                            >
                              <Pencil />
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={updatePlan.isPending}
                              onClick={() => setPlanToToggle(plan)}
                            >
                              {plan.isActive ? "Deactivate" : "Activate"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <RecurringPlanDialog
        open={dialogOpen}
        plan={editingPlan}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingPlan(null);
        }}
      />

      <Dialog
        open={Boolean(planToToggle)}
        onOpenChange={(open) => {
          if (!updatePlan.isPending && !open) setPlanToToggle(null);
        }}
      >
        <DialogContent>
          <div className="space-y-2">
            <DialogTitle>
              {planToToggle?.isActive
                ? "Deactivate recurring plan?"
                : "Activate recurring plan?"}
            </DialogTitle>
            <DialogDescription>
              {planToToggle?.isActive
                ? "This stops future recurring Job generation for this plan. Existing Jobs and history are not deleted."
                : "Future occurrences will be generated according to this plan."}
            </DialogDescription>
          </div>
          {planToToggle && (
            <p className="mt-4 text-sm">
              {getATMDisplayId(getATM(planToToggle)) || "ATM"} —{" "}
              {getMaintenanceLabel(planToToggle)}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPlanToToggle(null)}
              disabled={updatePlan.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={planToToggle?.isActive ? "destructive" : "default"}
              onClick={() => void confirmToggle()}
              disabled={updatePlan.isPending}
            >
              {updatePlan.isPending
                ? "Saving..."
                : planToToggle?.isActive
                  ? "Deactivate Plan"
                  : "Activate Plan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
