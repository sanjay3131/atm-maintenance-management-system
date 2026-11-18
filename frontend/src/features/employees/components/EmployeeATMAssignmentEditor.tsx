import { isAxiosError } from "axios";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getATMDisplayId } from "@/features/atms/atmDisplay.utils";
import { getATMById } from "@/features/atms/services/atm.service";
import { useScopedATMs } from "@/features/atms/hooks/useScopedATMs";
import type { ATM, ATMEmployee } from "@/features/atms/types/atm.types";
import { useBanks } from "@/features/banks/hooks/useBanks";
import { useUpdateEmployee } from "@/features/employees/hooks/useUpdateEmployee";
import { useDistricts } from "@/features/users/hooks/useDistricts";
import { useRegionsByBank } from "@/features/users/hooks/useRegionsByBank";
import type { Employee } from "@/services/employee.service";

const ALL_FILTER = "ALL";
const PAGE_SIZE = 20;

interface Filters {
  bankId: string;
  regionId: string;
  districtId: string;
}

const INITIAL_FILTERS: Filters = {
  bankId: ALL_FILTER,
  regionId: ALL_FILTER,
  districtId: ALL_FILTER,
};

function useDebouncedValue(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return (
      error.response?.data?.message ||
      "The ATM assignments could not be saved. Please try again."
    );
  }
  return error instanceof Error
    ? error.message
    : "The ATM assignments could not be saved. Please try again.";
}

function getReferenceId(reference: string | ATMEmployee | null | undefined) {
  return typeof reference === "string" ? reference : reference?._id;
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

      const name = [assignment.userId?.firstName, assignment.userId?.lastName]
        .filter(Boolean)
        .join(" ");
      return [assignment.employeeCode || "Employee", name]
        .filter(Boolean)
        .join(" · ");
    })
    .join(", ");
}

function getPopulatedAssignmentLabel(employee: Employee, atmId: string) {
  const reference = employee.assignedAtms?.find(
    (atm) => atm && typeof atm === "object" && atm._id === atmId,
  );
  return getATMDisplayId(reference);
}

export default function EmployeeATMAssignmentEditor({
  employee,
  onCancel,
  onSaved,
}: {
  employee: Employee;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const originalAtmIds = useMemo(
    () => new Set(employee.assignedAtmIds ?? []),
    [employee.assignedAtmIds],
  );
  const assignedATMIds = useMemo(() => [...originalAtmIds], [originalAtmIds]);
  const assignedATMQueries = useQueries({
    queries: assignedATMIds.map((atmId) => ({
      queryKey: ["atm", atmId],
      queryFn: () => getATMById(atmId),
      enabled: !getPopulatedAssignmentLabel(employee, atmId),
      staleTime: 1000 * 60 * 10,
    })),
  });
  const assignedATMLabels = assignedATMIds.map((atmId, index) => {
    const populatedLabel = getPopulatedAssignmentLabel(employee, atmId);
    const query = assignedATMQueries[index];

    return {
      atmId,
      label: populatedLabel || getATMDisplayId(query?.data),
      isLoading: query?.isLoading ?? false,
      isError: query?.isError ?? false,
    };
  });
  const [desiredAtmIds, setDesiredAtmIds] = useState(
    () => new Set(originalAtmIds),
  );
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [saveError, setSaveError] = useState("");

  const debouncedSearch = useDebouncedValue(search.trim(), 300);
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
      ...(filters.regionId !== ALL_FILTER
        ? { regionId: filters.regionId }
        : {}),
      ...(filters.districtId !== ALL_FILTER
        ? { districtId: filters.districtId }
        : {}),
      assignmentStatus: "all" as const,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      page,
      limit: PAGE_SIZE,
    }),
    [debouncedSearch, filters, page],
  );
  const atmsQuery = useScopedATMs(atmQueryParams);
  const updateEmployeeMutation = useUpdateEmployee();
  const atms = atmsQuery.data?.atms ?? [];
  const total = atmsQuery.data?.pagination.total ?? 0;
  const totalPages = Math.max(atmsQuery.data?.pagination.totalPages ?? 0, 1);
  const additions = [...desiredAtmIds].filter((id) => !originalAtmIds.has(id));
  const removals = [...originalAtmIds].filter((id) => !desiredAtmIds.has(id));
  const hasChanges = additions.length > 0 || removals.length > 0;
  const canAddAssignments =
    employee.status === "active" &&
    (!employee.userId?.status || employee.userId.status === "active");
  const firstVisible = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastVisible = Math.min(page * PAGE_SIZE, total);

  const updateFilters = (updates: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...updates }));
    setPage(1);
  };

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const toggleATM = (atm: ATM) => {
    setDesiredAtmIds((current) => {
      const next = new Set(current);
      if (next.has(atm._id)) next.delete(atm._id);
      else next.add(atm._id);
      return next;
    });
    setSaveError("");
  };

  const saveAssignments = async () => {
    if (!hasChanges) return;

    setSaveError("");
    try {
      await updateEmployeeMutation.mutateAsync({
        employeeId: employee._id,
        payload: { assignedAtmIds: [...desiredAtmIds] },
      });
      toast.success("ATM assignments updated successfully.");
      onSaved();
    } catch (error) {
      const message = getErrorMessage(error);
      setSaveError(message);
      toast.error(message);
    }
  };

  const bankError = banksQuery.isError;
  const regionError = regionsQuery.isError;
  const districtError = districtsQuery.isError;
  const isSaving = updateEmployeeMutation.isPending;

  return (
    <div className="space-y-5">
      <section aria-label="ATM assignment changes">
        <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-4 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-muted-foreground">
              Currently assigned
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {originalAtmIds.size}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Selected after save
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {desiredAtmIds.size}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Additions</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {additions.length}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Removals</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {removals.length}
            </dd>
          </div>
        </dl>
      </section>

      <section className="space-y-2" aria-labelledby="current-atm-assignments">
        <div>
          <h3 id="current-atm-assignments" className="text-sm font-medium">
            Current ATM assignments
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Changes remain staged until you save.
          </p>
        </div>
        {originalAtmIds.size === 0 ? (
          <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
            No ATMs are currently assigned.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {assignedATMLabels.map(({ atmId, label, isLoading }) => {
              const removalStaged = !desiredAtmIds.has(atmId);

              return (
                <li key={atmId} className="rounded-md bg-muted/60 px-3 py-2">
                  {" "}
                  <span
                    aria-label={`${label || (isLoading ? "Loading ATM ID" : "ATM ID unavailable")}${removalStaged ? ", removal staged" : ""}`}
                    className={`text-sm font-medium ${removalStaged ? "text-destructive line-through" : "text-foreground"}`}
                  >
                    {isLoading
                      ? "Loading ATM ID..."
                      : label || "ATM ID unavailable"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {assignedATMLabels.some(({ isError }) => isError) && (
          <p className="text-sm text-destructive" role="alert">
            One or more assigned ATM IDs could not be loaded.
          </p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="edit-atm-filters">
        <div>
          <h3 id="edit-atm-filters" className="text-sm font-medium">
            Find ATMs
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Existing assignments are included in the results. Other employees
            assigned to an ATM are preserved.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="sm:col-span-2 xl:col-span-1">
            <label
              htmlFor="edit-atm-search"
              className="mb-1.5 block text-sm font-medium"
            >
              Search ATMs
            </label>
            <input
              id="edit-atm-search"
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
              itemToStringLabel={(bankId) =>
                bankId === ALL_FILTER
                  ? "All banks"
                  : ((banksQuery.data ?? []).find((bank) => bank._id === bankId)
                      ?.bankName ?? "Bank unavailable")
              }
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
              itemToStringLabel={(regionId) =>
                regionId === ALL_FILTER
                  ? "All regions"
                  : ((regionsQuery.data ?? []).find(
                      (region) => region._id === regionId,
                    )?.name ?? "Region unavailable")
              }
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
            <label className="mb-1.5 block text-sm font-medium">District</label>
            <Select
              value={filters.districtId}
              itemToStringLabel={(districtId) =>
                districtId === ALL_FILTER
                  ? "All districts"
                  : ((districtsQuery.data ?? []).find(
                      (district) => district._id === districtId,
                    )?.districtName ?? "District unavailable")
              }
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
        </div>
      </section>

      {saveError && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          {saveError}
        </div>
      )}

      <section aria-labelledby="matching-atms-title" className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 id="matching-atms-title" className="text-sm font-medium">
              Matching ATMs
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {total === 0
                ? "0 ATMs"
                : `${firstVisible}–${lastVisible} of ${total} ATMs`}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Select or deselect an ATM to stage its assignment.
          </p>
        </div>

        {atmsQuery.isError ? (
          <div
            className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <p className="text-sm text-destructive">
              ATM results could not be loaded.
            </p>
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
            <div className="h-12 animate-pulse rounded bg-muted/60" />
            <p className="sr-only">Loading ATM results...</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[850px] text-sm">
                <thead>
                  <tr className="h-10 text-left text-xs font-medium text-muted-foreground">
                    <th scope="col" className="w-12 px-3">
                      <span className="sr-only">Select ATM</span>
                    </th>
                    <th scope="col" className="px-3">
                      ATM ID
                    </th>
                    <th scope="col" className="px-3">
                      Bank
                    </th>
                    <th scope="col" className="px-3">
                      Region
                    </th>
                    <th scope="col" className="px-3">
                      District
                    </th>
                    <th scope="col" className="px-3">
                      Assigned employees
                    </th>
                    <th scope="col" className="px-3">
                      Operational status
                    </th>
                    <th scope="col" className="px-3">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {atms.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-8 text-center text-muted-foreground"
                      >
                        No ATMs match the current filters.
                      </td>
                    </tr>
                  ) : (
                    atms.map((atm) => {
                      const currentlyAssigned = originalAtmIds.has(atm._id);
                      const selected = desiredAtmIds.has(atm._id);
                      const amcResponsible =
                        getReferenceId(atm.amcResponsibleEmployeeId) ===
                        employee._id;
                      const blockedRemoval =
                        currentlyAssigned && amcResponsible;
                      const blockedNewAssignment =
                        !currentlyAssigned &&
                        !selected &&
                        (!canAddAssignments || atm.status !== "ACTIVE");
                      const disabled =
                        isSaving || blockedRemoval || blockedNewAssignment;
                      const atmLabel =
                        getATMDisplayId(atm) || `ATM …${atm._id.slice(-6)}`;

                      return (
                        <tr
                          key={atm._id}
                          className="border-t align-top first:border-t-0"
                        >
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={disabled}
                              onChange={() => toggleATM(atm)}
                              aria-label={`${selected ? "Deselect" : "Select"} ${atmLabel}`}
                              className="size-4 accent-primary"
                            />
                          </td>
                          <td className="px-3 py-3 font-medium">
                            <div>{atmLabel}</div>
                            <div className="text-xs text-muted-foreground">
                              {atm.locationName}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            {atm.bankId?.bankName ?? "—"}
                          </td>
                          <td className="px-3 py-3">
                            {atm.regionId?.name ?? "—"}
                          </td>
                          <td className="px-3 py-3">
                            {atm.districtId?.districtName ?? "—"}
                          </td>
                          <td className="max-w-56 px-3 py-3 text-muted-foreground">
                            {getAssignedEmployeeNames(atm)}
                          </td>
                          <td className="px-3 py-3">
                            {atm.status.replaceAll("_", " ").toLowerCase()}
                          </td>
                          <td className="px-3 py-3">
                            {blockedRemoval ? (
                              <span className="text-muted-foreground">
                                AMC responsibility must be changed first
                              </span>
                            ) : currentlyAssigned && !selected ? (
                              <span className="font-medium text-destructive">
                                Removal staged
                              </span>
                            ) : currentlyAssigned ? (
                              <span className="text-muted-foreground">
                                Currently assigned
                              </span>
                            ) : selected ? (
                              <span className="font-medium text-foreground">
                                Addition staged
                              </span>
                            ) : !canAddAssignments ? (
                              <span className="text-muted-foreground">
                                Employee must be active to add ATMs
                              </span>
                            ) : atm.status !== "ACTIVE" ? (
                              <span className="text-muted-foreground">
                                Only active ATMs can be added
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    disabled={page <= 1 || atmsQuery.isFetching}
                  >
                    <ChevronLeft aria-hidden="true" />
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((current) => Math.min(totalPages, current + 1))
                    }
                    disabled={page >= totalPages || atmsQuery.isFetching}
                  >
                    Next
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void saveAssignments()}
          disabled={!hasChanges || isSaving}
        >
          {isSaving ? "Saving assignments..." : "Save ATM assignments"}
        </Button>
      </div>
    </div>
  );
}
