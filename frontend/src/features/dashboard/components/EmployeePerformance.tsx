import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { Combobox } from "@base-ui/react/combobox";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEmployeePerformanceDetails } from "@/features/dashboard/hooks/useEmployeePerformanceDetails";
import { useEmployeePerformance } from "@/features/dashboard/hooks/useEmployeePerformance";
import { useEmployees } from "@/features/employees/hooks/useEmployees";
import { useAllRegionsByDistrict } from "@/features/users/hooks/useAllRegionsByDistrict";
import { useDistricts } from "@/features/users/hooks/useDistricts";
import type {
  JobPerformancePeriod,
  JobStatus,
} from "@/features/jobs/types/job.types";
import type { Employee } from "@/services/employee.service";
import type { EmployeePerformance as EmployeePerformanceRecord } from "@/services/dashboard.service";
import { SkeletonBlock } from "@/features/dashboard/components/DashboardSkeleton";

const JOB_STATUSES: JobStatus[] = [
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

const PERFORMANCE_PERIODS: Array<{
  value: JobPerformancePeriod;
  label: string;
}> = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

function formatStatus(status: JobStatus) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDuration(hours: number | null) {
  if (hours === null || !Number.isFinite(hours)) return "Not available";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toLocaleString(undefined, { maximumFractionDigits: 2 })} hr`;
}

function errorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Please try again.";
  }
  return error instanceof Error ? error.message : "Please try again.";
}

function employeeId(employee: Employee) {
  return employee.userId?._id;
}

function getCompletionRate(completedJobs: number, totalJobs: number) {
  if (totalJobs <= 0) return 0;
  return (completedJobs / totalJobs) * 100;
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();
}

function EmployeeAvatar({
  name,
  avatarUrl,
  className = "size-10",
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted font-semibold text-muted-foreground ${className}`}
    >
      {getInitials(name)}
      {avatarUrl && !imageFailed && (
        <img
          src={avatarUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setImageFailed(true)}
        />
      )}
    </span>
  );
}

function CompletionIndicator({ rate }: { rate: number | null }) {
  if (rate === null) {
    return (
      <span className="text-xs font-medium text-muted-foreground">
        No data this period
      </span>
    );
  }

  return (
    <span className="flex w-20 shrink-0 flex-col items-end gap-1.5">
      <span className="text-xs font-semibold tabular-nums">
        {rate.toFixed(1)}%
      </span>
      <span
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Job completion rate"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.max(0, Math.min(rate, 100))}
      >
        <span
          className="block h-full rounded-full bg-emerald-600"
          style={{ width: `${Math.max(0, Math.min(rate, 100))}%` }}
        />
      </span>
    </span>
  );
}

function matchesFilters(
  row: {
    name: string;
    employeeCode?: string;
    employee?: Employee;
  },
  filters: { search: string; districtId: string; regionId: string },
) {
  const normalizedSearch = filters.search.trim().toLocaleLowerCase();
  if (
    normalizedSearch &&
    !`${row.name} ${row.employeeCode ?? row.employee?.employeeCode ?? ""}`
      .toLocaleLowerCase()
      .includes(normalizedSearch)
  ) {
    return false;
  }
  if (
    filters.districtId &&
    !row.employee?.districtIds.includes(filters.districtId)
  ) {
    return false;
  }
  if (filters.regionId && !row.employee?.regionIds.includes(filters.regionId)) {
    return false;
  }
  return true;
}

export default function EmployeePerformance({
  employee: viewedEmployee,
}: {
  employee?: Employee;
} = {}) {
  const {
    data,
    isLoading,
    isFetching,
    refetch: refetchPerformance,
  } = useEmployeePerformance(
    viewedEmployee?.userId?._id,
    !viewedEmployee || Boolean(viewedEmployee.userId?._id),
  );
  const reducedMotion = useReducedMotion();
  const employeesQuery = useEmployees(!viewedEmployee);
  const districtsQuery = useDistricts(!viewedEmployee);
  const [selectedEmployeeDocumentId, setSelectedEmployeeDocumentId] = useState<
    string | null
  >(null);
  const [search, setSearch] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [period, setPeriod] = useState<JobPerformancePeriod>("month");

  const regionsQuery = useAllRegionsByDistrict(districtFilter);
  const districtRegions = regionsQuery.data ?? [];
  const regionsLoading = Boolean(districtFilter) && regionsQuery.isLoading;
  const regionsError = Boolean(districtFilter) && regionsQuery.isError;

  const allPerformanceRows = useMemo(() => {
    const performanceByUserId = new Map<string, EmployeePerformanceRecord>(
      (data?.performance ?? []).map((performance) => [
        performance.employeeId,
        performance,
      ]),
    );

    return (viewedEmployee ? [viewedEmployee] : (employeesQuery.data ?? []))
      .map((employee) => {
        const userId = employeeId(employee);
        const performance = userId
          ? performanceByUserId.get(userId)
          : undefined;
        const firstName = employee.userId?.firstName?.trim();
        const lastName = employee.userId?.lastName?.trim();
        const name =
          [firstName, lastName].filter(Boolean).join(" ") ||
          performance?.name ||
          "Name unavailable";

        return {
          employee,
          employeeId: userId ?? employee._id,
          name,
          employeeCode: employee.employeeCode || performance?.employeeCode,
          totalJobs: performance?.totalJobs,
          completedJobs: performance?.completedJobs,
          approvedJobs: performance?.approvedJobs,
          rejectedJobs: performance?.rejectedJobs,
          completionRate:
            performance && performance.totalJobs > 0
              ? getCompletionRate(
                  performance.completedJobs,
                  performance.totalJobs,
                )
              : null,
        };
      })
      .sort(
        (left, right) =>
          (right.completionRate ?? -1) - (left.completionRate ?? -1) ||
          left.name.localeCompare(right.name) ||
          (left.employeeCode ?? "").localeCompare(right.employeeCode ?? "") ||
          left.employeeId.localeCompare(right.employeeId),
      );
  }, [data?.performance, employeesQuery.data, viewedEmployee]);
  const performanceRows = allPerformanceRows.filter((row) =>
    matchesFilters(row, {
      search,
      districtId: districtFilter,
      regionId: regionFilter,
    }),
  );
  const pickerRows = performanceRows;
  const visiblePerformanceRows = useMemo(() => {
    if (viewedEmployee) return performanceRows;
    if (search.trim()) return performanceRows;

    const topPerformers = performanceRows
      .filter((row) => row.completionRate !== null)
      .slice(0, 5);
    const selectedRow = performanceRows.find(
      (row) => row.employee._id === selectedEmployeeDocumentId,
    );

    if (
      selectedRow &&
      !topPerformers.some(
        (row) => row.employee._id === selectedRow.employee._id,
      )
    ) {
      return [...topPerformers, selectedRow];
    }
    return topPerformers;
  }, [performanceRows, search, selectedEmployeeDocumentId, viewedEmployee]);

  const selectedPerformanceRow = performanceRows.find(
    (row) =>
      (viewedEmployee?._id ?? selectedEmployeeDocumentId) &&
      row.employee._id === (viewedEmployee?._id ?? selectedEmployeeDocumentId),
  );
  const activeSelectedEmployeeDocumentId = viewedEmployee
    ? viewedEmployee._id
    : selectedPerformanceRow
      ? selectedEmployeeDocumentId
      : null;
  const selectedPickerRow =
    pickerRows.find(
      (row) => row.employee._id === activeSelectedEmployeeDocumentId,
    ) ?? null;

  const detailsQuery = useEmployeePerformanceDetails(
    activeSelectedEmployeeDocumentId,
    period,
  );

  const selectEmployee = (employee: Employee | undefined) => {
    setSelectedEmployeeDocumentId(employee?._id ?? null);
  };
  const updateFilters = (filters: {
    search: string;
    districtId: string;
    regionId: string;
  }) => {
    if (
      selectedEmployeeDocumentId &&
      !allPerformanceRows.some(
        (row) =>
          row.employee._id === selectedEmployeeDocumentId &&
          matchesFilters(row, filters),
      )
    ) {
      setSelectedEmployeeDocumentId(null);
    }
    setSearch(filters.search);
    setDistrictFilter(filters.districtId);
    setRegionFilter(filters.regionId);
  };

  if (isLoading && !data) {
    return (
      <Card className="min-w-0 self-start shadow-sm">
        <CardHeader className="p-4 sm:p-5">
          <CardTitle className="text-base">Employee Performance</CardTitle>
          <SkeletonBlock className="mt-2 h-3 w-5/6" />
          <SkeletonBlock className="mt-1 h-3 w-2/3" />
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0 sm:p-5 sm:pt-0">
          <SkeletonBlock className="h-10 w-full max-w-md" />
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, index) => (
              <SkeletonBlock key={index} className="h-9 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="min-w-0 self-start shadow-sm">
        <CardHeader className="p-4 sm:p-5">
          <CardTitle className="text-base">Employee Performance</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
          <p className="text-sm text-destructive" role="alert">
            Failed to load employee performance.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void refetchPerformance()}
            disabled={isFetching}
          >
            {isFetching ? "Retrying..." : "Retry"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="min-w-0 self-start"
    >
      <Card className="h-fit min-w-0 self-start shadow-sm">
        <CardHeader className="p-4 sm:p-5">
          <CardTitle className="text-base">Employee Performance</CardTitle>
          <p className="text-sm text-muted-foreground">
            {viewedEmployee
              ? `Performance for ${viewedEmployee.userId?.firstName ?? "this employee"} ${viewedEmployee.userId?.lastName ?? ""} based on assigned, non-deleted jobs created this month.`
              : "Leaderboard for assigned, non-deleted jobs created this month."}{" "}
            Cancelled jobs are excluded from the total; completed jobs include
            COMPLETED, VERIFIED, APPROVED, and CLOSED statuses.
          </p>
        </CardHeader>
        <CardContent className="space-y-5 p-4 pt-0 sm:p-5 sm:pt-0">
          {!viewedEmployee && (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2 lg:col-span-2">
                <label
                  htmlFor="employee-performance-search"
                  className="mb-1 block text-sm font-medium"
                >
                  Search employees
                </label>
                <input
                  id="employee-performance-search"
                  type="search"
                  value={search}
                  onChange={(event) =>
                    updateFilters({
                      search: event.target.value,
                      districtId: districtFilter,
                      regionId: regionFilter,
                    })
                  }
                  placeholder="Name or employee code"
                  className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label
                  htmlFor="employee-performance-district"
                  className="mb-1 block text-sm font-medium"
                >
                  District
                </label>
                <select
                  id="employee-performance-district"
                  value={districtFilter}
                  onChange={(event) => {
                    updateFilters({
                      search,
                      districtId: event.target.value,
                      regionId: "",
                    });
                  }}
                  disabled={districtsQuery.isLoading || districtsQuery.isError}
                  className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">All districts</option>
                  {districtsQuery.data?.map((district) => (
                    <option key={district._id} value={district._id}>
                      {district.districtName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="employee-performance-region"
                  className="mb-1 block text-sm font-medium"
                >
                  Region
                </label>
                <select
                  id="employee-performance-region"
                  value={regionFilter}
                  onChange={(event) =>
                    updateFilters({
                      search,
                      districtId: districtFilter,
                      regionId: event.target.value,
                    })
                  }
                  disabled={!districtFilter || regionsLoading || regionsError}
                  className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">
                    {!districtFilter
                      ? "Select district first"
                      : regionsLoading
                        ? "Loading regions..."
                        : "All regions"}
                  </option>
                  {districtRegions.map((region) => (
                    <option key={region._id} value={region._id}>
                      {region.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-4">
                <div className="min-w-0 flex-1 sm:max-w-md">
                  <label
                    htmlFor="individual-employee"
                    className="mb-1 block text-sm font-medium"
                  >
                    Selected employee for individual performance
                  </label>
                  <Combobox.Root
                    items={pickerRows}
                    value={selectedPickerRow}
                    onValueChange={(row) => {
                      if (row) selectEmployee(row.employee);
                    }}
                    itemToStringLabel={(row) =>
                      row ? `${row.name} · ${row.employeeCode}` : ""
                    }
                    itemToStringValue={(row) => row?.employee._id ?? ""}
                    autoHighlight
                  >
                    <div className="relative">
                      {selectedPickerRow ? (
                        <span className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center">
                          <EmployeeAvatar
                            name={selectedPickerRow.name}
                            className="size-8 text-[0.65rem]"
                          />
                        </span>
                      ) : (
                        <span className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center">
                          <ChevronsUpDown
                            aria-hidden="true"
                            className="size-4 text-muted-foreground"
                          />
                        </span>
                      )}
                      <Combobox.Input
                        id="individual-employee"
                        aria-label="Search and select employee for individual performance"
                        placeholder={
                          employeesQuery.isLoading
                            ? "Loading employees..."
                            : "Search employees by name or code"
                        }
                        disabled={
                          employeesQuery.isLoading || employeesQuery.isError
                        }
                        className="h-12 w-full rounded-lg border border-input bg-background py-2 pl-14 pr-10 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <Combobox.Trigger
                        aria-label="Show employee options"
                        className="absolute inset-y-0 right-1 inline-flex w-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronsUpDown aria-hidden="true" className="size-4" />
                      </Combobox.Trigger>
                    </div>
                    <Combobox.Portal>
                      <Combobox.Positioner sideOffset={4} className="z-50">
                        <Combobox.Popup className="max-h-80 w-(--anchor-width) min-w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
                          <Combobox.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
                            No employees match your search and filters.
                          </Combobox.Empty>
                          <Combobox.List>
                            {pickerRows.map((row) => (
                              <Combobox.Item
                                key={row.employee._id}
                                value={row}
                                className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[selected]:bg-primary/10"
                              >
                                <EmployeeAvatar
                                  name={row.name}
                                  className="size-9 text-xs"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">
                                    {row.name}
                                  </span>
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {row.employeeCode ||
                                      "Employee code unavailable"}
                                  </span>
                                </span>
                                <CompletionIndicator
                                  rate={row.completionRate}
                                />
                                {row.employee._id ===
                                  activeSelectedEmployeeDocumentId && (
                                  <Check
                                    aria-hidden="true"
                                    className="size-4 shrink-0 text-primary"
                                  />
                                )}
                              </Combobox.Item>
                            ))}
                          </Combobox.List>
                        </Combobox.Popup>
                      </Combobox.Positioner>
                    </Combobox.Portal>
                  </Combobox.Root>
                  {activeSelectedEmployeeDocumentId && selectedPickerRow && (
                    <div className="mt-2 flex min-w-0 items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <EmployeeAvatar
                          name={selectedPickerRow.name}
                          className="size-8 text-[0.65rem]"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {selectedPickerRow.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {selectedPickerRow.employeeCode ||
                              "Employee code unavailable"}
                          </p>
                        </div>
                      </div>
                      <CompletionIndicator
                        rate={selectedPickerRow.completionRate}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Clear selected employee"
                        title="Clear selected employee"
                        className="shrink-0"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelectedEmployeeDocumentId(null);
                        }}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    updateFilters({ search: "", districtId: "", regionId: "" });
                    setSelectedEmployeeDocumentId(null);
                  }}
                  disabled={
                    !search &&
                    !districtFilter &&
                    !regionFilter &&
                    !selectedEmployeeDocumentId
                  }
                >
                  Clear filters
                </Button>
              </div>
            </div>
          )}

          {districtsQuery.isError && (
            <p className="text-sm text-destructive" role="alert">
              District filters could not be loaded.{" "}
              <button
                type="button"
                className="font-medium underline underline-offset-4"
                onClick={() => void districtsQuery.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          {regionsError && (
            <p className="text-sm text-destructive" role="alert">
              Region options could not be loaded.{" "}
              <button
                type="button"
                className="font-medium underline underline-offset-4"
                onClick={() => void regionsQuery.refetch()}
              >
                Retry
              </button>
            </p>
          )}

          {employeesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading employees...
            </p>
          ) : employeesQuery.isError ? (
            <p className="text-sm text-destructive" role="alert">
              Employee records could not be loaded.{" "}
              <button
                type="button"
                className="font-medium underline underline-offset-4"
                onClick={() => void employeesQuery.refetch()}
              >
                Retry
              </button>
            </p>
          ) : visiblePerformanceRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search || districtFilter || regionFilter
                ? "No employees match the current search and filters."
                : "No employee performance data available."}
            </p>
          ) : (
            <div
              role="region"
              aria-label="Employee performance table; scroll horizontally to view all columns"
              tabIndex={0}
              className="min-w-0 overflow-x-auto overscroll-x-contain rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">
                  {viewedEmployee
                    ? "Job completion performance for the selected employee."
                    : search.trim()
                      ? "Matching employee job completion performance, sorted by completion rate from highest to lowest."
                      : "Top five employee job completion rates, sorted from highest to lowest."}
                </caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-3 text-left font-medium">Employee</th>
                    <th className="p-3 text-left font-medium">
                      Completed / total
                    </th>
                    <th className="p-3 text-left font-medium">Approved</th>

                    <th className="p-3 text-left font-medium">Rejected</th>

                    <th className="p-3 text-left font-medium">
                      Completion rate
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {visiblePerformanceRows.map((employee) => (
                    <tr
                      key={employee.employeeId}
                      tabIndex={viewedEmployee ? undefined : 0}
                      aria-selected={
                        employee.employee._id ===
                        activeSelectedEmployeeDocumentId
                      }
                      aria-label={`View performance for ${employee.name}`}
                      onClick={
                        viewedEmployee
                          ? undefined
                          : () => selectEmployee(employee.employee)
                      }
                      onKeyDown={(event) => {
                        if (viewedEmployee) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectEmployee(employee.employee);
                        }
                      }}
                      className={`border-b last:border-0 ${
                        employee.employee._id ===
                        activeSelectedEmployeeDocumentId
                          ? "bg-primary/10"
                          : "hover:bg-muted/50"
                      } focus-visible:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
                    >
                      <td className="p-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <EmployeeAvatar
                            name={employee.name}
                            className="size-9 text-xs"
                          />
                          <div className="min-w-0">
                            <p className="font-medium">
                              {employee.name}
                              {employee.employee._id ===
                                activeSelectedEmployeeDocumentId && (
                                <span className="sr-only">, selected</span>
                              )}
                            </p>

                            {employee.employeeCode && (
                              <p className="text-xs text-muted-foreground">
                                {employee.employeeCode}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="p-3">
                        {employee.completedJobs !== undefined &&
                        employee.totalJobs !== undefined
                          ? `${employee.completedJobs} / ${employee.totalJobs}`
                          : "—"}
                      </td>

                      <td className="p-3">{employee.approvedJobs ?? "—"}</td>

                      <td className="p-3">{employee.rejectedJobs ?? "—"}</td>

                      <td className="p-3">
                        {employee.completionRate === null ? (
                          <span className="text-sm font-medium text-muted-foreground">
                            No data this period
                          </span>
                        ) : (
                          <div className="w-20 max-w-full space-y-1.5">
                            <span className="block text-sm font-semibold tabular-nums">
                              {employee.completionRate.toFixed(1)}%
                            </span>
                            <span
                              className="block h-1.5 w-full overflow-hidden rounded-full bg-muted"
                              role="progressbar"
                              aria-label={`${employee.name} completion rate`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.max(
                                0,
                                Math.min(employee.completionRate, 100),
                              )}
                            >
                              <span
                                className="block h-full rounded-full bg-emerald-600 dark:bg-emerald-400"
                                style={{
                                  width: `${Math.max(0, Math.min(employee.completionRate, 100))}%`,
                                }}
                              />
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!viewedEmployee &&
            !search.trim() &&
            performanceRows.some((row) => row.completionRate !== null) && (
              <p className="text-xs text-muted-foreground">
                Showing the top five performers
                {visiblePerformanceRows.length > 5
                  ? " and the selected employee"
                  : ""}
                . Search to find another employee.
              </p>
            )}

          <AnimatePresence initial={false}>
            {activeSelectedEmployeeDocumentId && (
              <motion.section
                key={activeSelectedEmployeeDocumentId}
                initial={reducedMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={
                  reducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }
                }
                transition={{
                  duration: reducedMotion ? 0 : 0.22,
                  ease: "easeOut",
                }}
                className="min-w-0 overflow-hidden border-t pt-5"
                aria-labelledby="individual-performance-title"
              >
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3
                      id="individual-performance-title"
                      className="text-lg font-semibold"
                    >
                      Individual Employee Performance
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Completion submissions are events; rework may count more
                      than once.
                    </p>
                  </div>
                  <div>
                    <label
                      htmlFor="individual-performance-period"
                      className="mb-1 block text-sm font-medium"
                    >
                      Completion event period
                    </label>
                    <select
                      id="individual-performance-period"
                      value={period}
                      onChange={(event) =>
                        setPeriod(event.target.value as JobPerformancePeriod)
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-48"
                    >
                      {PERFORMANCE_PERIODS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {detailsQuery.isLoading ? (
                  <div
                    className="space-y-3"
                    role="status"
                    aria-label="Loading individual performance"
                  >
                    <SkeletonBlock className="h-8 w-48" />
                    <SkeletonBlock className="h-24 w-full" />
                    <SkeletonBlock className="h-28 w-full" />
                  </div>
                ) : detailsQuery.isError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-sm text-destructive" role="alert">
                      Could not load individual performance.{" "}
                      {errorMessage(detailsQuery.error)}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => void detailsQuery.refetch()}
                      disabled={detailsQuery.isFetching}
                    >
                      {detailsQuery.isFetching ? "Retrying..." : "Retry"}
                    </Button>
                  </div>
                ) : detailsQuery.data ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {detailsQuery.data.employee.name}
                      </p>
                      <Badge variant="outline">
                        Employee code: {detailsQuery.data.employee.employeeCode}
                      </Badge>
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-medium">
                        Currently assigned jobs:{" "}
                        {detailsQuery.data.currentAssignedJobs.total}
                      </p>
                      {detailsQuery.data.currentAssignedJobs.total === 0 ? (
                        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                          No jobs are currently assigned to this employee.
                        </p>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {JOB_STATUSES.map((status) => (
                            <Card
                              className="border-border bg-card"
                              key={status}
                            >
                              <CardHeader className="p-3 pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                  {formatStatus(status)}
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="p-3 pt-0">
                                <p className="text-xl font-semibold tabular-nums">
                                  {detailsQuery.data.currentAssignedJobs
                                    .byStatus[status] ?? 0}
                                </p>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">
                            Completion submission events
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-2xl font-semibold">
                            {detailsQuery.data.completion.completedEventCount}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {detailsQuery.data.completion.range.fromDate} –{" "}
                            {detailsQuery.data.completion.range.toDate} (
                            {detailsQuery.data.completion.range.timezone})
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">
                            Average current-attempt duration
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-2xl font-semibold">
                            {formatDuration(
                              detailsQuery.data
                                .averageCurrentAttemptCompletionHours,
                            )}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            From{" "}
                            {detailsQuery.data.averageCurrentAttemptJobCount}{" "}
                            currently assigned qualifying job(s); not a
                            historical average.
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Individual performance is not available.
                  </p>
                )}
              </motion.section>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}
