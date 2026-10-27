import { useId, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useATMs } from "@/features/atms/hooks/useATMs";
import {
  useAllActiveATMLocationTasks,
  useATMLocationTasks,
  useCancelATMLocationTask,
  useCreateATMLocationTasks,
  useReassignATMLocationTask,
  useReopenATMLocationTask,
  atmLocationTaskQueryKeys,
} from "@/features/atms/hooks/useATMLocationTasks";
import {
  buildBulkATMLocationTaskPayload,
  filterATMLocationTaskInventory,
  getATMReferenceId,
  getEmployeeDisplayName,
  getEmployeeInitials,
  getBulkATMLocationTaskErrorMessage,
  getATMLocationTaskRequestId,
  getLocationTaskActionErrorMessage,
  getLocationTaskATMId,
  getLocationTaskEmployeeId,
  isEligibleLocationTaskEmployee,
  searchEligibleLocationTaskEmployees,
  selectEmployeeAssignedATMs,
  setManualATMLocationTaskSelection,
  shouldRefreshATMLocationTaskInventory,
  type ATMLocationTaskAssignment,
  type ATMLocationTaskSelectionOrigin,
} from "@/features/atms/atmLocationTask.utils";
import type {
  ATMLocationTask,
  ATMLocationTaskStatus,
  ATMLocationTaskType,
} from "@/features/atms/types/atm-location-task.types";
import type { ATM } from "@/features/atms/types/atm.types";
import { useEmployees } from "@/features/employees/hooks/useEmployees";
import type { Employee } from "@/services/employee.service";
import ATMLocationTaskRequestDialog from "@/pages/admin/ATMLocationTaskRequestDialog";

const PAGE_SIZE = 20;
const ALL_FILTER = "ALL";

type ActionMode = "reassign" | "reopen" | "cancel";

const statusLabel = (status: ATMLocationTaskStatus) =>
  status.replaceAll("_", " ");

const getATMLabel = (atm?: ATM | null) =>
  atm ? `${atm.atmId} — ${atm.locationName}` : "ATM unavailable";

const getTaskATMObject = (task: ATMLocationTask): ATM | null =>
  typeof task.atmId === "string" ? null : task.atmId;

const getTaskEmployeeLabel = (
  task: ATMLocationTask,
  employeesById: Map<string, Employee>,
) => {
  const assigned = task.assignedEmployeeId;
  const id = getLocationTaskEmployeeId(task);
  const employee = employeesById.get(id);
  if (employee) return getEmployeeDisplayName(employee);
  return typeof assigned === "string"
    ? "Employee unavailable"
    : assigned.employeeCode ?? "Employee unavailable";
};

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-sm font-medium">{children}</label>;
}

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60";

function EmployeeAvatar({ employee }: { employee: Employee }) {
  const [imageFailed, setImageFailed] = useState(false);
  const avatarUrl = employee.userId?.avatar?.url;
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-xs font-semibold text-muted-foreground"
    >
      {getEmployeeInitials(employee)}
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

function EmployeePicker({
  employees,
  value,
  onValueChange,
  label,
  placeholder = "Search by employee code or name",
  disabled = false,
}: {
  employees: Employee[];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const pickerId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(
    () => searchEligibleLocationTaskEmployees(employees, query),
    [employees, query],
  );
  const displayedMatches = matches.slice(0, 50);
  const selected = employees.find((employee) => employee._id === value);
  const inputValue = open
    ? query
    : selected
      ? `${getEmployeeDisplayName(selected)}${
          isEligibleLocationTaskEmployee(selected) ? "" : " (not eligible)"
        }`
      : "";

  const chooseEmployee = (employee: Employee) => {
    onValueChange(employee._id);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && open && displayedMatches.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % displayedMatches.length);
    } else if (event.key === "ArrowUp" && open && displayedMatches.length) {
      event.preventDefault();
      setActiveIndex(
        (index) => (index + displayedMatches.length - 1) % displayedMatches.length,
      );
    } else if (event.key === "Enter" && open && displayedMatches[activeIndex]) {
      event.preventDefault();
      chooseEmployee(displayedMatches[activeIndex]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className="relative min-w-0">
      <label htmlFor={`${pickerId}-input`} className="sr-only">
        {label}
      </label>
      <input
        id={`${pickerId}-input`}
        type="search"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${pickerId}-list`}
        aria-activedescendant={
          open && displayedMatches[activeIndex]
            ? `${pickerId}-option-${displayedMatches[activeIndex]._id}`
            : undefined
        }
        className={inputClass}
        placeholder={placeholder}
        value={inputValue}
        disabled={disabled}
        onFocus={() => {
          if (!open) {
            setQuery("");
            setActiveIndex(0);
            setOpen(true);
          }
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 0);
        }}
      />
      {open && (
        <div
          id={`${pickerId}-list`}
          role="listbox"
          aria-label={`${label} results`}
          className="mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {displayedMatches.length ? (
            <>
              {matches.length > displayedMatches.length && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Showing the first 50 matches. Type to narrow the list.
                </p>
              )}
              {displayedMatches.map((employee, index) => (
                <div
                  id={`${pickerId}-option-${employee._id}`}
                  key={employee._id}
                  role="option"
                  aria-selected={employee._id === value}
                  className={`flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted ${
                    index === activeIndex ? "bg-muted" : ""
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseEmployee(employee)}
                >
                  <EmployeeAvatar employee={employee} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {employee.employeeCode} ·{" "}
                      {[employee.userId?.firstName, employee.userId?.lastName]
                        .filter(Boolean)
                        .join(" ") || "Name unavailable"}
                    </span>
                    <span className="block text-xs text-muted-foreground">Active</span>
                  </span>
                </div>
              ))}
            </>
          ) : (
            <p className="p-3 text-sm text-muted-foreground" role="status">
              No matching active employees.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ATMLocationTasksPage() {
  const queryClient = useQueryClient();
  const { data: atms = [], isLoading: atmsLoading, isError: atmsError, refetch: refetchATMs } = useATMs();
  const {
    data: employees = [],
    isLoading: employeesLoading,
    isError: employeesError,
    refetch: refetchEmployees,
  } = useEmployees();
  const {
    data: activeTasks = [],
    isLoading: activeTasksLoading,
    isError: activeTasksError,
    refetch: refetchActiveTasks,
  } = useAllActiveATMLocationTasks();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<ATMLocationTaskStatus | "ALL">("ALL");
  const [taskTypeFilter, setTaskTypeFilter] = useState<ATMLocationTaskType | "ALL">("ALL");
  const [employeeFilter, setEmployeeFilter] = useState(ALL_FILTER);
  const taskFilters = useMemo(
    () => ({
      ...(statusFilter !== ALL_FILTER ? { status: statusFilter } : {}),
      ...(taskTypeFilter !== ALL_FILTER ? { taskType: taskTypeFilter } : {}),
      ...(employeeFilter !== ALL_FILTER ? { assignedEmployeeId: employeeFilter } : {}),
      page,
      limit: PAGE_SIZE,
    }),
    [employeeFilter, page, statusFilter, taskTypeFilter],
  );
  const {
    data: taskList,
    isLoading: taskListLoading,
    isFetching: taskListFetching,
    isError: taskListError,
    refetch: refetchTasks,
  } = useATMLocationTasks(taskFilters);

  const eligibleEmployees = useMemo(
    () => searchEligibleLocationTaskEmployees(employees, ""),
    [employees],
  );
  const employeesById = useMemo(
    () => new Map(employees.map((employee) => [employee._id, employee])),
    [employees],
  );
  const atmsById = useMemo(() => new Map(atms.map((atm) => [atm._id, atm])), [atms]);
  const activeATMIds = useMemo(
    () => new Set(activeTasks.filter((task) => task.active).map(getLocationTaskATMId)),
    [activeTasks],
  );
  const [selectedAssignments, setSelectedAssignments] = useState<
    Record<string, ATMLocationTaskAssignment>
  >({});
  const [selectionOrigins, setSelectionOrigins] = useState<
    Record<string, ATMLocationTaskSelectionOrigin>
  >({});
  const [bulkEmployeeId, setBulkEmployeeId] = useState("");
  const [autoSelectionNotice, setAutoSelectionNotice] = useState("");
  const [districtFilter, setDistrictFilter] = useState(ALL_FILTER);
  const [regionFilter, setRegionFilter] = useState(ALL_FILTER);
  const [bankFilter, setBankFilter] = useState(ALL_FILTER);
  const [atmSearch, setATMSearch] = useState("");
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [linkedRequestTask, setLinkedRequestTask] =
    useState<ATMLocationTask | null>(null);
  const [actionDialog, setActionDialog] = useState<{
    mode: ActionMode;
    task: ATMLocationTask;
  } | null>(null);
  const [actionEmployeeId, setActionEmployeeId] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState("");

  const createTasks = useCreateATMLocationTasks();
  const reassignTask = useReassignATMLocationTask();
  const reopenTask = useReopenATMLocationTask();
  const cancelTask = useCancelATMLocationTask();
  const actionPending =
    reassignTask.isPending || reopenTask.isPending || cancelTask.isPending;

  const filteredATMs = useMemo(
    () =>
      filterATMLocationTaskInventory(atms, {
        districtId: districtFilter === ALL_FILTER ? "" : districtFilter,
        regionId: regionFilter === ALL_FILTER ? "" : regionFilter,
        bankId: bankFilter === ALL_FILTER ? "" : bankFilter,
        search: atmSearch,
      }),
    [atms, bankFilter, districtFilter, regionFilter, atmSearch],
  );
  const inventoryDistricts = useMemo(
    () =>
      Array.from(
        new Map(
          atms
            .filter((atm) => atm.districtId?._id && atm.districtId.districtName)
            .map((atm) => [atm.districtId._id, atm.districtId.districtName]),
        ),
      ).sort((left, right) => left[1].localeCompare(right[1])),
    [atms],
  );
  const inventoryRegions = useMemo(
    () =>
      Array.from(
        new Map(
          atms
            .filter(
              (atm) =>
                atm.regionId?._id &&
                atm.regionId.name &&
                (districtFilter === ALL_FILTER ||
                  getATMReferenceId(atm.districtId) === districtFilter),
            )
            .map((atm) => [atm.regionId!._id, atm.regionId!.name]),
        ),
      ).sort((left, right) => left[1].localeCompare(right[1])),
    [atms, districtFilter],
  );
  const inventoryBanks = useMemo(
    () =>
      Array.from(
        new Map(
          atms
            .filter((atm) => atm.bankId?._id && atm.bankId.bankName)
            .map((atm) => [atm.bankId._id, atm.bankId.bankName]),
        ),
      ).sort((left, right) => left[1].localeCompare(right[1])),
    [atms],
  );
  const selectedBulkEmployee = eligibleEmployees.find(
    (employee) => employee._id === bulkEmployeeId,
  );
  const visibleATMIds = useMemo(
    () => new Set(filteredATMs.map((atm) => atm._id)),
    [filteredATMs],
  );
  const assignedOutsideFiltersCount =
    selectedBulkEmployee?.assignedAtmIds.filter(
      (atmId) => !visibleATMIds.has(atmId) && !selectedAssignments[atmId],
    ).length ?? 0;
  const selectedOutsideFiltersCount = Object.keys(selectedAssignments).filter(
    (atmId) => !visibleATMIds.has(atmId),
  ).length;

  const refreshTaskData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: atmLocationTaskQueryKeys.all }),
      refetchTasks(),
      refetchActiveTasks(),
    ]);
  };

  const toggleATM = (atm: ATM, checked: boolean) => {
    const next = setManualATMLocationTaskSelection({
      atmId: atm._id,
      checked,
      employeeId: selectedBulkEmployee?._id ?? "",
      assignments: selectedAssignments,
      origins: selectionOrigins,
    });
    setSelectedAssignments(next.assignments);
    setSelectionOrigins(next.origins);
  };

  const selectBulkEmployee = (employeeId: string) => {
    const employee = eligibleEmployees.find((item) => item._id === employeeId);
    const next = selectEmployeeAssignedATMs({
      employeeId,
      assignedAtmIds: employee?.assignedAtmIds ?? [],
      atms,
      activeTasks,
      visibleATMIds,
      assignments: selectedAssignments,
      origins: selectionOrigins,
    });
    setBulkEmployeeId(employeeId);
    setSelectedAssignments(next.assignments);
    setSelectionOrigins(next.origins);
    const notices = [
      `${next.autoSelectedCount} assigned ATM${next.autoSelectedCount === 1 ? "" : "s"} auto-selected.`,
      next.activeTaskCount
        ? `${next.activeTaskCount} ATM${next.activeTaskCount === 1 ? "" : "s"} with an active task skipped.`
        : "",
      next.unavailableLocationCount
        ? `${next.unavailableLocationCount} ATM${next.unavailableLocationCount === 1 ? "" : "s"} with unavailable location status skipped.`
        : "",
      next.limitReachedCount
        ? `${next.limitReachedCount} ATM${next.limitReachedCount === 1 ? "" : "s"} not selected because a batch is limited to 100.`
        : "",
    ].filter(Boolean);
    setAutoSelectionNotice(notices.join(" "));
  };

  const updateAssignment = (
    atmId: string,
    update: Partial<ATMLocationTaskAssignment>,
  ) => {
    setSelectedAssignments((current) => ({
      ...current,
      [atmId]: { ...current[atmId], ...update },
    }));
    setSelectionOrigins((current) => ({ ...current, [atmId]: "manual" }));
  };

  const clearATMFilters = () => {
    setDistrictFilter(ALL_FILTER);
    setRegionFilter(ALL_FILTER);
    setBankFilter(ALL_FILTER);
    setATMSearch("");
  };

  const buildSelectedAssignmentPayload = () => {
    for (const [atmId, assignment] of Object.entries(selectedAssignments)) {
      const employee = employeesById.get(assignment.employeeId);
      if (!employee || !isEligibleLocationTaskEmployee(employee)) {
        const atmLabel = atmsById.get(atmId)?.atmId ?? atmId;
        throw new Error(`Select an active eligible employee for ${atmLabel}.`);
      }
    }
    return buildBulkATMLocationTaskPayload(
      Object.entries(selectedAssignments).map(([atmId, assignment]) => ({
        atmId,
        ...assignment,
      })),
      atms,
      activeTasks,
    );
  };

  const openBulkReview = () => {
    try {
      buildSelectedAssignmentPayload();
      setBulkError("");
      setBulkDialogOpen(true);
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Check the selected ATMs.");
    }
  };

  const submitBulkTasks = async () => {
    try {
      const payload = buildSelectedAssignmentPayload();
      const created = await createTasks.mutateAsync(payload);
      setSelectedAssignments({});
      setSelectionOrigins({});
      setBulkDialogOpen(false);
      setBulkError("");
      setAutoSelectionNotice("");
      toast.success(`${created.length} location task${created.length === 1 ? "" : "s"} created.`);
    } catch (error) {
      let message = getBulkATMLocationTaskErrorMessage(
        error,
        (atmId) => atmsById.get(atmId)?.atmId ?? atmId,
      );
      if (shouldRefreshATMLocationTaskInventory(error)) {
        const refreshed = await refreshBulkConflictInventory();
        message += refreshed
          ? " Assignment may have changed. ATM and active-task inventory was refreshed."
          : " Assignment may have changed, but inventory refresh did not complete. Retry loading before assigning.";
      }
      setBulkError(message);
      toast.error(message);
    }
  };

  const refreshBulkConflictInventory = async () => {
    const results = await Promise.allSettled([
      refetchATMs(),
      refetchActiveTasks(),
      refetchTasks(),
    ]);
    const invalidation = await Promise.allSettled([
      queryClient.invalidateQueries({
        queryKey: atmLocationTaskQueryKeys.all,
      }),
    ]);
    return (
      results.every(
        (result) =>
          result.status === "fulfilled" && result.value.isError !== true,
      ) && invalidation.every((result) => result.status === "fulfilled")
    );
  };

  const openTaskAction = (mode: ActionMode, task: ATMLocationTask) => {
    setActionDialog({ mode, task });
    setActionEmployeeId(
      mode === "reassign"
        ? getLocationTaskEmployeeId(task)
        : eligibleEmployees[0]?._id ?? "",
    );
    setActionReason("");
    setActionError("");
  };

  const submitTaskAction = async () => {
    if (!actionDialog) return;
    const { mode, task } = actionDialog;
    if (mode !== "cancel" && !actionEmployeeId) {
      setActionError("Select an eligible employee.");
      return;
    }
    if (
      mode !== "cancel" &&
      mode === "reassign" &&
      actionEmployeeId === getLocationTaskEmployeeId(task)
    ) {
      setActionError("Choose a different employee from the current assignee.");
      return;
    }
    if (mode !== "reassign" && !actionReason.trim()) {
      setActionError("A reason is required.");
      return;
    }
    try {
      if (mode === "reassign") {
        await reassignTask.mutateAsync({
          taskId: task._id,
          payload: {
            employeeId: actionEmployeeId,
            ...(actionReason.trim() ? { reason: actionReason.trim() } : {}),
          },
        });
        toast.success("Location task reassigned.");
      } else if (mode === "reopen") {
        await reopenTask.mutateAsync({
          taskId: task._id,
          payload: { employeeId: actionEmployeeId, reason: actionReason.trim() },
        });
        toast.success("Rejected location task reopened.");
      } else {
        await cancelTask.mutateAsync({
          taskId: task._id,
          payload: { reason: actionReason.trim() },
        });
        toast.success("Location task cancelled.");
      }
      setActionDialog(null);
      await refreshTaskData();
    } catch (error) {
      const message = getLocationTaskActionErrorMessage(error);
      setActionError(message);
      toast.error(message);
      if (isConflict(error)) await refreshTaskData();
    }
  };

  const refetchAll = async () => {
    await Promise.all([
      refetchATMs(),
      refetchEmployees(),
      refetchActiveTasks(),
      refetchTasks(),
    ]);
  };

  const isInventoryReady = !atmsLoading && !activeTasksLoading && !employeesLoading;
  const inventoryError = atmsError || activeTasksError || employeesError;
  const pageCount = taskList?.pagination.totalPages ?? 0;
  const currentTasks = taskList?.tasks ?? [];
  const selectedCount = Object.keys(selectedAssignments).length;

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold">ATM Location Tasks</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Assign initial location collection or correction visits and manage their task lifecycle.
          Proposed locations are reviewed separately in ATM Location Requests.
        </p>
      </header>

      <section className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
          <div>
            <h2 className="font-semibold">Create location tasks</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose an employee to auto-select their assigned ATMs, then adjust the selection before explicitly assigning tasks.
            </p>
          </div>
          <Button
            type="button"
            onClick={openBulkReview}
            disabled={!selectedCount || !isInventoryReady || Boolean(inventoryError) || createTasks.isPending}
          >
            Review &amp; Assign Tasks ({selectedCount})
          </Button>
        </div>

        {inventoryError ? (
          <div className="p-5" role="alert">
            <p className="font-medium text-destructive">
              Could not load the complete ATM, employee, or active-task inventory. Assignment is disabled.
            </p>
            <Button type="button" variant="outline" className="mt-3" onClick={refetchAll}>
              Retry loading
            </Button>
          </div>
        ) : !isInventoryReady ? (
          <div className="p-5 text-sm text-muted-foreground" role="status">
            Loading complete ATM and active-task inventories…
          </div>
        ) : (
          <div className="p-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <FieldLabel>District</FieldLabel>
                <select
                  aria-label="Filter ATMs by district"
                  className={inputClass}
                  value={districtFilter}
                  onChange={(event) => {
                    setDistrictFilter(event.target.value);
                    setRegionFilter(ALL_FILTER);
                  }}
                >
                  <option value={ALL_FILTER}>All districts</option>
                  {inventoryDistricts.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Region</FieldLabel>
                <select
                  aria-label="Filter ATMs by region"
                  className={inputClass}
                  value={regionFilter}
                  onChange={(event) => setRegionFilter(event.target.value)}
                  disabled={!inventoryRegions.length}
                >
                  <option value={ALL_FILTER}>All regions</option>
                  {inventoryRegions.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Bank</FieldLabel>
                <select
                  aria-label="Filter ATMs by bank"
                  className={inputClass}
                  value={bankFilter}
                  onChange={(event) => setBankFilter(event.target.value)}
                >
                  <option value={ALL_FILTER}>All banks</option>
                  {inventoryBanks.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Search all loaded ATMs</FieldLabel>
                <input
                  type="search"
                  className={inputClass}
                  placeholder="ATM ID, location, or address"
                  value={atmSearch}
                  onChange={(event) => setATMSearch(event.target.value)}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Showing {filteredATMs.length} of {atms.length} ATMs from the full unpaginated inventory. A batch can contain up to 100 ATMs.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  districtFilter === ALL_FILTER &&
                  regionFilter === ALL_FILTER &&
                  bankFilter === ALL_FILTER &&
                  !atmSearch
                }
                onClick={clearATMFilters}
              >
                Clear filters
              </Button>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(18rem,1fr)_minmax(18rem,1fr)]">
              <div>
                <FieldLabel>Employee auto-selection</FieldLabel>
                <EmployeePicker
                  employees={employees}
                  value={bulkEmployeeId}
                  onValueChange={selectBulkEmployee}
                  label="Search employees by code or name"
                  placeholder="Search by employee code or name"
                  disabled={!eligibleEmployees.length}
                />
              </div>
              <div className="flex flex-col justify-end">
                {selectedBulkEmployee ? (
                  <>
                    <p className="text-sm">
                      {Object.values(selectionOrigins).filter((origin) => origin === "automatic").length} ATM(s) are selected automatically for{" "}
                      <span className="font-medium">{getEmployeeDisplayName(selectedBulkEmployee)}</span>.
                    </p>
                    {assignedOutsideFiltersCount > 0 && (
                      <p className="mt-1 text-xs text-amber-700" role="status">
                        {assignedOutsideFiltersCount} ATM(s) assigned to this employee are outside the current filters and were not auto-selected.
                      </p>
                    )}
                    {autoSelectionNotice && (
                      <p className="mt-1 text-xs text-muted-foreground" role="status">
                        {autoSelectionNotice}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Select an employee to auto-select their assigned eligible ATMs. No tasks are created until you confirm.
                  </p>
                )}
                {selectedOutsideFiltersCount > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground" role="status">
                    {selectedOutsideFiltersCount} selected ATM(s) outside the current filters remain selected.
                  </p>
                )}
              </div>
            </div>
            {!eligibleEmployees.length && (
              <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                No active eligible employees are available for assignment.
              </p>
            )}
            {filteredATMs.length ? (
              <div className="mt-4 max-h-[36rem] overflow-auto rounded-md border">
                <div>
                  <div className="hidden grid-cols-[2rem_minmax(12rem,1.5fr)_minmax(10rem,1fr)_minmax(14rem,1.2fr)] gap-3 border-b bg-muted/50 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground sm:grid">
                    <span />
                    <span>ATM</span>
                    <span>Task type</span>
                    <span>Assigned employee</span>
                  </div>
                  {filteredATMs.map((atm) => {
                    const selected = Boolean(selectedAssignments[atm._id]);
                    const hasActiveTask = activeATMIds.has(atm._id);
                    const locationKnown = typeof atm.locationConfigured === "boolean";
                    const canSelect =
                      selected ||
                      (!hasActiveTask &&
                        locationKnown &&
                        eligibleEmployees.length > 0 &&
                        selectedCount < 100);
                    return (
                      <div
                        key={atm._id}
                        className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 border-b px-3 py-3 last:border-b-0 sm:grid-cols-[2rem_minmax(12rem,1.5fr)_minmax(10rem,1fr)_minmax(14rem,1.2fr)]"
                      >
                        <input
                          aria-label={`Select ${atm.atmId}`}
                          type="checkbox"
                          checked={selected}
                          disabled={!canSelect}
                          onChange={(event) => toggleATM(atm, event.target.checked)}
                          className="size-4 accent-primary"
                        />
                        <div className="col-start-2 min-w-0 sm:col-start-auto">
                          <div className="font-medium">{atm.atmId}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {atm.locationName} · {atm.districtId?.districtName ?? "District unavailable"}
                          </div>
                          {hasActiveTask && (
                            <div className="text-xs text-amber-700">Active location task exists</div>
                          )}
                          {!locationKnown && (
                            <div className="text-xs text-destructive">Location status unavailable</div>
                          )}
                        </div>
                        <div className="col-start-2 text-sm sm:col-start-auto">
                          {locationKnown
                            ? atm.locationConfigured
                              ? "Location correction"
                              : "Initial collection"
                            : "Unavailable"}
                        </div>
                        {selected ? (
                          <div className="col-start-2 space-y-2 sm:col-start-auto">
                            <EmployeePicker
                              employees={eligibleEmployees}
                              value={selectedAssignments[atm._id]?.employeeId ?? ""}
                              onValueChange={(employeeId) =>
                                updateAssignment(atm._id, { employeeId })
                              }
                              label={`Employee for ${atm.atmId}`}
                              placeholder="Search employee"
                              disabled={!eligibleEmployees.length}
                            />
                            {selectionOrigins[atm._id] === "automatic" && (
                              <p className="text-xs text-muted-foreground">Auto-selected from employee ATM assignments</p>
                            )}
                            {atm.locationConfigured && (
                              <input
                                aria-label={`Optional correction reason for ${atm.atmId}`}
                                className={inputClass}
                                placeholder="Correction reason (optional)"
                                value={selectedAssignments[atm._id]?.correctionReason ?? ""}
                                onChange={(event) =>
                                  updateAssignment(atm._id, {
                                    correctionReason: event.target.value,
                                  })
                                }
                              />
                            )}
                          </div>
                        ) : (
                          <span className="col-start-2 text-sm text-muted-foreground sm:col-start-auto">Select ATM to assign</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
                No ATMs match this search.
              </p>
            )}
            {bulkError && !bulkDialogOpen && (
              <p role="alert" className="mt-3 text-sm text-destructive">{bulkError}</p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card">
        <div className="border-b p-4">
          <h2 className="font-semibold">Location task inventory</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Filters and pagination are applied by the server. The list shows one page of results at a time.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <FieldLabel>Status</FieldLabel>
              <select
                className={inputClass}
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as ATMLocationTaskStatus | "ALL");
                  setPage(1);
                }}
              >
                <option value="ALL">All statuses</option>
                {(["ASSIGNED", "IN_PROGRESS", "ON_HOLD", "PENDING_REVIEW", "REJECTED", "COMPLETED", "CANCELLED"] as const).map((status) => (
                  <option key={status} value={status}>{statusLabel(status)}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Task type</FieldLabel>
              <select
                className={inputClass}
                value={taskTypeFilter}
                onChange={(event) => {
                  setTaskTypeFilter(event.target.value as ATMLocationTaskType | "ALL");
                  setPage(1);
                }}
              >
                <option value="ALL">All task types</option>
                <option value="INITIAL_COLLECTION">Initial collection</option>
                <option value="LOCATION_CORRECTION">Location correction</option>
              </select>
            </div>
            <div>
              <FieldLabel>Assigned employee</FieldLabel>
              <select
                className={inputClass}
                value={employeeFilter}
                onChange={(event) => {
                  setEmployeeFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value={ALL_FILTER}>All employees</option>
                {employees.map((employee) => (
                  <option key={employee._id} value={employee._id}>
                    {getEmployeeDisplayName(employee)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {taskListLoading ? (
          <div className="p-6 text-sm text-muted-foreground" role="status">Loading location tasks…</div>
        ) : taskListError ? (
          <div className="p-6" role="alert">
            <p className="text-sm text-destructive">Could not load location tasks.</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => refetchTasks()}>
              Retry
            </Button>
          </div>
        ) : currentTasks.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No location tasks match these filters.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">ATM</th>
                    <th className="px-4 py-3">District / region</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {currentTasks.map((task) => {
                    const atmId = getLocationTaskATMId(task);
                    const atm = atmsById.get(atmId) ?? getTaskATMObject(task);
                    const linkedRequestId = getATMLocationTaskRequestId(task);
                    const linkedRequest = task.locationRequestId;
                    const canReassign = ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(task.status);
                    const canCancel = ["ASSIGNED", "IN_PROGRESS", "ON_HOLD", "REJECTED"].includes(task.status);
                    return (
                      <tr key={task._id} className="align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium">{atm?.atmId ?? "ATM unavailable"}</div>
                          <div className="text-xs text-muted-foreground">{atm?.locationName ?? atmId}</div>
                          {linkedRequestId && (
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="mt-1 h-auto whitespace-normal p-0 text-left"
                              onClick={() => setLinkedRequestTask(task)}
                            >
                              Review linked proposal
                              <ExternalLink aria-hidden="true" />
                              {typeof linkedRequest === "object" &&
                                linkedRequest !== null && (
                                <span className="sr-only">
                                  {linkedRequest.status} request
                                </span>
                              )}
                            </Button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {atm?.districtId?.districtName ?? "—"} / {atm?.regionId?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3">{task.taskType === "INITIAL_COLLECTION" ? "Initial collection" : "Location correction"}</td>
                        <td className="px-4 py-3">{getTaskEmployeeLabel(task, employeesById)}</td>
                        <td className="px-4 py-3">
                          <Badge variant={task.status === "REJECTED" ? "destructive" : task.status === "COMPLETED" ? "secondary" : "outline"}>
                            {statusLabel(task.status)}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {new Date(task.updatedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {canReassign && (
                              <Button type="button" variant="outline" size="sm" onClick={() => openTaskAction("reassign", task)}>
                                Reassign
                              </Button>
                            )}
                            {task.status === "REJECTED" && (
                              <Button type="button" variant="outline" size="sm" onClick={() => openTaskAction("reopen", task)}>
                                Reopen
                              </Button>
                            )}
                            {canCancel && (
                              <Button type="button" variant="destructive" size="sm" onClick={() => openTaskAction("cancel", task)}>
                                Cancel
                              </Button>
                            )}
                            {!canReassign && task.status !== "REJECTED" && !canCancel && (
                              <span className="text-xs text-muted-foreground">No available actions</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
              <span className="text-sm text-muted-foreground">
                {taskList?.pagination.total ?? 0} tasks · Page {page} of {pageCount}
                {taskListFetching && <span className="ml-2">Refreshing…</span>}
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={page <= 1 || taskListFetching} onClick={() => setPage((value) => value - 1)}>
                  Previous
                </Button>
                <Button type="button" variant="outline" disabled={!pageCount || page >= pageCount || taskListFetching} onClick={() => setPage((value) => value + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogTitle>Confirm location task assignments</DialogTitle>
          <DialogDescription>
            Review the selected ATM and employee pairs before creating the task batch.
          </DialogDescription>
          <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto rounded-md border p-3 text-sm">
            {Object.entries(selectedAssignments).map(([atmId, assignment]) => {
              const atm = atmsById.get(atmId);
              const employee = employeesById.get(assignment.employeeId);
              return (
                <li key={atmId} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <span className="font-medium">{atm ? getATMLabel(atm) : "ATM unavailable"}</span>
                  <span>
                    {atm?.locationConfigured ? "Correction" : "Initial collection"} ·{" "}
                    {employee ? getEmployeeDisplayName(employee) : "Employee not selected"}
                  </span>
                </li>
              );
            })}
          </ul>
          {bulkError && <p role="alert" className="text-sm text-destructive">{bulkError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={createTasks.isPending} onClick={() => setBulkDialogOpen(false)}>
              Back
            </Button>
            <Button type="button" disabled={createTasks.isPending} onClick={submitBulkTasks}>
              {createTasks.isPending ? "Assigning…" : "Assign Tasks"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(actionDialog)}
        onOpenChange={(open) => {
          if (!open && !actionPending) setActionDialog(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {actionDialog?.mode === "reassign"
              ? "Reassign location task"
              : actionDialog?.mode === "reopen"
                ? "Reopen rejected task"
                : "Cancel location task"}
          </DialogTitle>
          <DialogDescription>
            {actionDialog
              ? `${getATMLabel(atmsById.get(getLocationTaskATMId(actionDialog.task)))} · ${statusLabel(actionDialog.task.status)}`
              : ""}
          </DialogDescription>
          {actionDialog?.mode !== "cancel" && (
            <div className="mt-4">
              <FieldLabel>Employee</FieldLabel>
              <EmployeePicker
                employees={employees}
                value={actionEmployeeId}
                onValueChange={setActionEmployeeId}
                label="Search eligible employees for task action"
                placeholder="Search by employee code or name"
                disabled={actionPending}
              />
            </div>
          )}
          <div className="mt-4">
            <FieldLabel>
              {actionDialog?.mode === "reassign"
                ? "Reason (optional)"
                : "Reason (required)"}
            </FieldLabel>
            <textarea
              className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              value={actionReason}
              onChange={(event) => setActionReason(event.target.value)}
              disabled={actionPending}
            />
          </div>
          {actionError && <p role="alert" className="mt-3 text-sm text-destructive">{actionError}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={actionPending} onClick={() => setActionDialog(null)}>
              Back
            </Button>
            <Button
              type="button"
              variant={actionDialog?.mode === "cancel" ? "destructive" : "default"}
              disabled={actionPending}
              onClick={submitTaskAction}
            >
              {actionPending ? "Saving…" : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ATMLocationTaskRequestDialog
        task={linkedRequestTask}
        onOpenChange={(open) => {
          if (!open) setLinkedRequestTask(null);
        }}
        onDecision={refreshTaskData}
      />
    </main>
  );
}

const isConflict = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "response" in error &&
  typeof error.response === "object" &&
  error.response !== null &&
  "status" in error.response &&
  error.response.status === 409;
