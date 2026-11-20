import { isAxiosError } from "axios";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useScopedATMs } from "@/features/atms/hooks/useScopedATMs";
import { getATMDisplayId } from "@/features/atms/atmDisplay.utils";
import type { ATM, ATMEmployee } from "@/features/atms/types/atm.types";
import { useAssignEmployeeATMs } from "@/features/employees/hooks/useAssignEmployeeATMs";
import { useEmployee } from "@/features/employees/hooks/useEmployee";
import { useEmployeeOptions } from "@/features/employees/hooks/useEmployeeOptions";
import type { Employee, EmployeeOption } from "@/services/employee.service";
import { useBanks } from "@/features/banks/hooks/useBanks";
import { useDistricts } from "@/features/users/hooks/useDistricts";
import { useRegionsByBank } from "@/features/users/hooks/useRegionsByBank";

const ALL_FILTER = "ALL";
const PAGE_SIZE = 20;

type AssignmentStatus = "all" | "assigned" | "unassigned";
type OperationalStatus = ATM["status"] | typeof ALL_FILTER;

interface ATMFilters {
  bankId: string;
  regionId: string;
  districtId: string;
  assignmentStatus: AssignmentStatus;
  status: OperationalStatus;
  onlyTargetEmployee: boolean;
}

const INITIAL_FILTERS: ATMFilters = {
  bankId: ALL_FILTER,
  regionId: ALL_FILTER,
  districtId: ALL_FILTER,
  assignmentStatus: "all",
  status: ALL_FILTER,
  onlyTargetEmployee: false,
};

function useDebouncedValue(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}

function getEmployeeName(employee: EmployeeOption) {
  return [employee.firstName, employee.lastName].filter(Boolean).join(" ") ||
    "Name unavailable";
}

function toEmployeeOption(employee: Employee): EmployeeOption {
  return {
    _id: employee._id,
    employeeCode: employee.employeeCode,
    firstName: employee.userId?.firstName ?? null,
    lastName: employee.userId?.lastName ?? null,
    avatarUrl: employee.userId?.avatar?.url ?? null,
  };
}

function isAssignedToEmployee(atm: ATM, employeeId: string) {
  return (atm.assignedEmployeeId ?? []).some((assignment) =>
    typeof assignment === "string"
      ? assignment === employeeId
      : assignment?._id === employeeId,
  );
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return (
      error.response?.data.message ||
      "The request could not be completed. Please try again."
    );
  }
  return error instanceof Error
    ? error.message
    : "The request could not be completed. Please try again.";
}

function getOperationalStatusLabel(status: ATM["status"]) {
  return status.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) =>
    letter.toUpperCase(),
  );
}

function getOperationalStatusClass(status: ATM["status"]) {
  if (status === "ACTIVE") return "bg-green-100 text-green-800";
  if (status === "UNDER_MAINTENANCE") return "bg-amber-100 text-amber-900";
  if (status === "REMOVED") return "bg-red-100 text-red-800";
  return "bg-muted text-muted-foreground";
}

function getAssignedEmployeeNames(atm: ATM) {
  const assignments = (atm.assignedEmployeeId ?? []).filter(
    (assignment): assignment is string | ATMEmployee => assignment !== null,
  );
  if (assignments.length === 0) return "Unassigned";

  return assignments
    .map((assignment) => {
      if (typeof assignment === "string") {
        return `Employee …${assignment.slice(-6)}`;
      }

      const name = [
        assignment.userId?.firstName,
        assignment.userId?.lastName,
      ]
        .filter(Boolean)
        .join(" ");
      return [assignment.employeeCode || "Employee", name]
        .filter(Boolean)
        .join(" · ");
    })
    .join(", ");
}

export default function BulkATMAssignmentPage() {
  const [searchParams] = useSearchParams();
  const preselectedEmployeeId = searchParams.get("employeeId") ?? "";
  const preselectedEmployeeQuery = useEmployee(preselectedEmployeeId);
  const [filters, setFilters] = useState<ATMFilters>(INITIAL_FILTERS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedEmployeeOverride, setSelectedEmployeeOverride] =
    useState<EmployeeOption | null>(null);
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeePage, setEmployeePage] = useState(1);
  const [selectedATMs, setSelectedATMs] = useState<Map<string, ATM>>(
    () => new Map(),
  );
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const preselectedEmployee = preselectedEmployeeQuery.data;
  const preselectedEmployeeIsActive =
    preselectedEmployee?.status === "active" &&
    (!preselectedEmployee.userId?.status ||
      preselectedEmployee.userId.status === "active");
  const selectedEmployee =
    selectedEmployeeOverride ??
    (preselectedEmployee && preselectedEmployeeIsActive
      ? toEmployeeOption(preselectedEmployee)
      : null);

  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const debouncedEmployeeSearch = useDebouncedValue(employeeSearch.trim(), 300);
  const employeeOptionsQuery = useEmployeeOptions(
    debouncedEmployeeSearch,
    employeePage,
    true,
    true,
  );
  const banksQuery = useBanks({ isActive: true });
  const regionsQuery = useRegionsByBank(
    filters.bankId === ALL_FILTER ? "" : filters.bankId,
  );
  const districtsQuery = useDistricts(
    filters.regionId !== ALL_FILTER,
    filters.regionId !== ALL_FILTER ? filters.regionId : undefined,
  );
  const atmQueryParams = useMemo(
    () => ({
      ...(filters.bankId !== ALL_FILTER ? { bankId: filters.bankId } : {}),
      ...(filters.regionId !== ALL_FILTER ? { regionId: filters.regionId } : {}),
      ...(filters.districtId !== ALL_FILTER
        ? { districtId: filters.districtId }
        : {}),
      assignmentStatus: filters.assignmentStatus,
      ...(filters.onlyTargetEmployee && selectedEmployee
        ? { employeeId: selectedEmployee._id }
        : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(filters.status !== ALL_FILTER ? { status: filters.status } : {}),
      page,
      limit: PAGE_SIZE,
    }),
    [debouncedSearch, filters, page, selectedEmployee],
  );
  const atmsQuery = useScopedATMs(atmQueryParams);
  const assignmentMutation = useAssignEmployeeATMs();
  const atms = atmsQuery.data?.atms ?? [];
  const employees = employeeOptionsQuery.data?.employees ?? [];
  const total = atmsQuery.data?.pagination.total ?? 0;
  const totalPages = Math.max(atmsQuery.data?.pagination.totalPages ?? 0, 1);
  const selectedATMList = Array.from(selectedATMs.values());
  const alreadyAssignedCount = selectedEmployee
    ? selectedATMList.filter((atm) =>
        isAssignedToEmployee(atm, selectedEmployee._id),
      ).length
    : 0;
  const newlyAssignableCount = selectedEmployee
    ? selectedATMList.length - alreadyAssignedCount
    : 0;
  const assignableATMIds = selectedEmployee
    ? selectedATMList
        .filter((atm) => !isAssignedToEmployee(atm, selectedEmployee._id))
        .map((atm) => atm._id)
    : [];
  const selectedOnPage = atms.filter((atm) => selectedATMs.has(atm._id)).length;
  const allOnPageSelected =
    atms.length > 0 && selectedOnPage === atms.length;
  const firstVisible = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastVisible = Math.min(page * PAGE_SIZE, total);

  const clearSelection = () => setSelectedATMs(new Map());

  const updateFilters = (updates: Partial<ATMFilters>) => {
    setFilters((current) => ({ ...current, ...updates }));
    setPage(1);
    clearSelection();
  };

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(1);
    clearSelection();
  };

  const chooseEmployee = (employee: EmployeeOption) => {
    setSelectedEmployeeOverride(employee);
    setEmployeePickerOpen(false);
    setPage(1);
    clearSelection();
  };

  const toggleATM = (atm: ATM) => {
    setSelectedATMs((current) => {
      const next = new Map(current);
      if (next.has(atm._id)) next.delete(atm._id);
      else next.set(atm._id, atm);
      return next;
    });
  };

  const toggleCurrentPage = (checked: boolean) => {
    setSelectedATMs((current) => {
      const next = new Map(current);
      for (const atm of atms) {
        if (checked) next.set(atm._id, atm);
        else next.delete(atm._id);
      }
      return next;
    });
  };

  const assignSelectedATMs = async () => {
    if (!selectedEmployee || assignableATMIds.length === 0) return;

    try {
      await assignmentMutation.mutateAsync({
        employeeId: selectedEmployee._id,
        assignedAtmIds: assignableATMIds,
      });
      toast.success(
        `${assignableATMIds.length} ATM${assignableATMIds.length === 1 ? "" : "s"} assigned to ${getEmployeeName(selectedEmployee)}.`,
      );
      setPage(1);
      clearSelection();
      setConfirmationOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const bankError = banksQuery.isError;
  const regionError = regionsQuery.isError;
  const districtError = districtsQuery.isError;

  return (
    <main className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bulk ATM Assignment</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add ATMs to an employee without replacing existing assignments.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setConfirmationOpen(true)}
          disabled={
            !selectedEmployee ||
            selectedATMs.size === 0 ||
            newlyAssignableCount === 0 ||
            assignmentMutation.isPending
          }
          className="min-h-10 sm:self-start"
        >
          {assignmentMutation.isPending
            ? "Assigning..."
            : `Assign ${newlyAssignableCount} new ATM${newlyAssignableCount === 1 ? "" : "s"}`}
        </Button>
      </header>

      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Employee to assign</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {preselectedEmployeeId && preselectedEmployeeQuery.isError && (
            <p className="text-sm text-destructive" role="alert">
              The selected employee could not be loaded. Choose an active
              employee below to continue.
            </p>
          )}
          {preselectedEmployeeQuery.data &&
            (preselectedEmployeeQuery.data.status !== "active" ||
              (preselectedEmployeeQuery.data.userId?.status &&
                preselectedEmployeeQuery.data.userId.status !== "active")) && (
              <p className="text-sm text-destructive" role="alert">
                The selected employee is not active and cannot receive ATM
                assignments. Choose an active employee to continue.
              </p>
            )}
          {selectedEmployee && !employeePickerOpen ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <UserRound
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {getEmployeeName(selectedEmployee)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedEmployee.employeeCode || "No employee code"}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEmployeePickerOpen(true)}
              >
                Change employee
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <label
                htmlFor="employee-search"
                className="block text-sm font-medium"
              >
                Search active employees by name or employee code
              </label>
              <input
                id="employee-search"
                type="search"
                value={employeeSearch}
                onChange={(event) => {
                  setEmployeeSearch(event.target.value);
                  setEmployeePage(1);
                }}
                placeholder="Name or employee code"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {employeeOptionsQuery.isError ? (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  role="alert"
                >
                  <p className="text-sm text-destructive">
                    Could not load active employee options.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void employeeOptionsQuery.refetch()}
                    disabled={employeeOptionsQuery.isFetching}
                  >
                    Retry
                  </Button>
                </div>
              ) : employeeOptionsQuery.isLoading ? (
                <p className="py-3 text-sm text-muted-foreground" role="status">
                  Loading active employees...
                </p>
              ) : employees.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  No active employees match this search.
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  {employees.map((employee) => (
                    <button
                      key={employee._id}
                      type="button"
                      onClick={() => chooseEmployee(employee)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="truncate font-medium">
                        {getEmployeeName(employee)}
                      </span>
                      <span className="shrink-0 text-sm text-muted-foreground">
                        {employee.employeeCode || "No employee code"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {employeeOptionsQuery.data &&
                employeeOptionsQuery.data.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-end gap-2">
                    <span className="mr-2 text-sm text-muted-foreground">
                      Page {employeePage} of{" "}
                      {employeeOptionsQuery.data.pagination.totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setEmployeePage((current) => Math.max(1, current - 1))
                      }
                      disabled={employeePage <= 1 || employeeOptionsQuery.isFetching}
                    >
                      <ChevronLeft aria-hidden="true" />
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setEmployeePage((current) =>
                          Math.min(
                            employeeOptionsQuery.data!.pagination.totalPages,
                            current + 1,
                          ),
                        )
                      }
                      disabled={
                        employeePage >=
                          employeeOptionsQuery.data.pagination.totalPages ||
                        employeeOptionsQuery.isFetching
                      }
                    >
                      Next
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </div>
                )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">ATM filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <div className="col-span-2 xl:col-span-1">
              <label
                htmlFor="atm-search"
                className="mb-1.5 block text-sm font-medium"
              >
                Search ATMs
              </label>
              <input
                id="atm-search"
                type="search"
                value={search}
                onChange={(event) => updateSearch(event.target.value)}
                placeholder="ATM ID or location name"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Bank</label>
              <Select
                value={filters.bankId}
                onValueChange={(value) =>
                  updateFilters({
                    bankId: value ?? ALL_FILTER,
                    regionId: ALL_FILTER,
                    districtId: ALL_FILTER,
                  })
                }
                disabled={banksQuery.isLoading || bankError}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="All banks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER}>All banks</SelectItem>
                  {(banksQuery.data ?? []).map((bank) => (
                    <SelectItem key={bank._id} value={bank._id}>
                      {bank.bankName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {bankError && (
                <p className="mt-1 text-xs text-destructive" role="alert">
                  Banks could not be loaded.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void banksQuery.refetch()}
                  >
                    Retry
                  </button>
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Region</label>
              <Select
                value={filters.regionId}
                onValueChange={(value) =>
                  updateFilters({
                    regionId: value ?? ALL_FILTER,
                    districtId: ALL_FILTER,
                  })
                }
                disabled={
                  filters.bankId === ALL_FILTER ||
                  regionsQuery.isLoading ||
                  regionError
                }
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="All regions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER}>All regions</SelectItem>
                  {(regionsQuery.data ?? []).map((region) => (
                    <SelectItem key={region._id} value={region._id}>
                      {region.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {regionError && (
                <p className="mt-1 text-xs text-destructive" role="alert">
                  Regions could not be loaded.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void regionsQuery.refetch()}
                  >
                    Retry
                  </button>
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                District
              </label>
              <Select
                value={filters.districtId}
                onValueChange={(value) =>
                  updateFilters({ districtId: value ?? ALL_FILTER })
                }
                disabled={
                  filters.regionId === ALL_FILTER ||
                  districtsQuery.isLoading ||
                  districtError
                }
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="All districts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER}>All districts</SelectItem>
                  {(districtsQuery.data ?? []).map((district) => (
                    <SelectItem key={district._id} value={district._id}>
                      {district.districtName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {districtError && (
                <p className="mt-1 text-xs text-destructive" role="alert">
                  Districts could not be loaded.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void districtsQuery.refetch()}
                  >
                    Retry
                  </button>
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Assignment status
              </label>
              <Select
                value={filters.assignmentStatus}
                onValueChange={(value) =>
                  updateFilters({
                    assignmentStatus: (value ?? "all") as AssignmentStatus,
                  })
                }
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Operational status
              </label>
              <Select
                value={filters.status}
                onValueChange={(value) =>
                  updateFilters({
                    status: (value ?? ALL_FILTER) as OperationalStatus,
                  })
                }
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FILTER}>All statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                  <SelectItem value="UNDER_MAINTENANCE">
                    Under maintenance
                  </SelectItem>
                  <SelectItem value="REMOVED">Removed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={filters.onlyTargetEmployee}
              disabled={!selectedEmployee}
              onChange={(event) =>
                updateFilters({ onlyTargetEmployee: event.target.checked })
              }
              className="size-4 accent-primary"
            />
            Only show ATMs already assigned to the selected employee
          </label>
        </CardContent>
      </Card>

      <section aria-label="Assignment selection summary">
        <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-4 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-muted-foreground">Matching ATMs</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{total}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Selected ATMs</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {selectedATMs.size}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Already assigned to target
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {alreadyAssignedCount}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Newly assignable</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {newlyAssignableCount}
            </dd>
          </div>
        </dl>
      </section>

      <Card className="shadow-none">
        <CardHeader className="flex flex-col gap-1 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">Matching ATMs</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {total === 0
                ? "0 ATMs"
                : `${firstVisible}–${lastVisible} of ${total} ATMs`}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Select all applies to this page only ({PAGE_SIZE} at most).
          </p>
        </CardHeader>
        <CardContent>
          {atmsQuery.isError ? (
            <div
              className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
              role="alert"
            >
              <div>
                <p className="font-medium text-destructive">
                  ATM results could not be loaded.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {getErrorMessage(atmsQuery.error)}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void atmsQuery.refetch()}
                disabled={atmsQuery.isFetching}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={atmsQuery.isFetching ? "animate-spin" : ""}
                />
                Retry
              </Button>
            </div>
          ) : atmsQuery.isLoading ? (
            <div className="space-y-3 py-4" role="status">
              <div className="h-10 animate-pulse rounded bg-muted" />
              <div className="h-14 animate-pulse rounded bg-muted/60" />
              <div className="h-14 animate-pulse rounded bg-muted/60" />
              <p className="sr-only">Loading ATM results...</p>
            </div>
          ) : (
            <>
              <div className="mb-2 flex min-h-11 items-center gap-3 border-b pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={(event) =>
                    toggleCurrentPage(event.target.checked)
                  }
                  aria-label={`Select all ${atms.length} ATMs on this page`}
                  className="size-4 accent-primary"
                />
                <span>
                  Select all {atms.length} on this page
                  {selectedOnPage > 0 ? ` · ${selectedOnPage} selected` : ""}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-225 text-sm">
                  <thead>
                    <tr className="h-10 text-left text-xs font-medium text-muted-foreground">
                      <th scope="col" className="w-12 px-2">
                        <span className="sr-only">Select ATM</span>
                      </th>
                      <th scope="col" className="px-3">ATM ID</th>
                      <th scope="col" className="px-3">Bank</th>
                      <th scope="col" className="px-3">Region</th>
                      <th scope="col" className="px-3">District</th>
                      <th scope="col" className="px-3">Current assigned employees</th>
                      <th scope="col" className="px-3">Operational status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {atms.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="h-24 px-3 text-center text-muted-foreground"
                        >
                          No ATMs match these filters.
                        </td>
                      </tr>
                    ) : (
                      atms.map((atm) => (
                        <tr
                          key={atm._id}
                          className="min-h-14 border-t hover:bg-muted/30"
                        >
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={selectedATMs.has(atm._id)}
                              onChange={() => toggleATM(atm)}
                              aria-label={`Select ATM ${getATMDisplayId(atm)}`}
                              className="size-4 accent-primary"
                            />
                          </td>
                          <td className="px-3 py-3 font-medium">
                            <div>{getATMDisplayId(atm)}</div>
                            <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                              {atm.locationName}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            {atm.bankId?.bankName || "—"}
                          </td>
                          <td className="px-3 py-3">
                            {atm.regionId?.name || "—"}
                          </td>
                          <td className="px-3 py-3">
                            {atm.districtId?.districtName || "—"}
                          </td>
                          <td className="max-w-64 px-3 py-3 text-muted-foreground">
                            <span className="line-clamp-2">
                              {getAssignedEmployeeNames(atm)}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex whitespace-nowrap rounded px-2 py-1 text-xs font-medium ${getOperationalStatusClass(atm.status)}`}
                            >
                              {getOperationalStatusLabel(atm.status)}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedATMs.size} selected across your current filters.
                </p>
                <div className="flex items-center justify-end gap-2">
                  <span className="mr-2 text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1 || atmsQuery.isFetching}
                    aria-label="Previous ATM page"
                  >
                    <ChevronLeft aria-hidden="true" />
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setPage((current) => Math.min(totalPages, current + 1))
                    }
                    disabled={page >= totalPages || atmsQuery.isFetching}
                    aria-label="Next ATM page"
                  >
                    Next
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={confirmationOpen}
        onOpenChange={(open) => {
          if (!assignmentMutation.isPending) setConfirmationOpen(open);
        }}
      >
        <DialogContent>
          <DialogTitle>Confirm ATM assignment</DialogTitle>
          <DialogDescription className="mt-2">
            Add {newlyAssignableCount} selected ATM
            {newlyAssignableCount === 1 ? "" : "s"} to{" "}
            {selectedEmployee ? getEmployeeName(selectedEmployee) : "the employee"}.
            Existing employee assignments will not be replaced.
            {alreadyAssignedCount > 0 &&
              ` ${alreadyAssignedCount} already assigned ATM${alreadyAssignedCount === 1 ? " will" : "s will"} be skipped.`}
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmationOpen(false)}
              disabled={assignmentMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void assignSelectedATMs()}
              disabled={
                !selectedEmployee ||
                assignableATMIds.length === 0 ||
                assignmentMutation.isPending
              }
            >
              {assignmentMutation.isPending ? "Assigning..." : "Confirm assignment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
