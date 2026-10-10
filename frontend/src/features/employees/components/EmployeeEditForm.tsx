import { useState } from "react";
import { isAxiosError } from "axios";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDistricts } from "@/features/users/hooks/useDistricts";
import {
  getAllRegionsByDistrict,
  type Region,
} from "@/features/users/services/region.service";
import {
  type Employee,
  type UpdateEmployeePayload,
} from "@/services/employee.service";
import { useUpdateEmployee } from "../hooks/useUpdateEmployee";

type EmployeeStatus = "active" | "inactive" | "on_leave" | "resigned";
type EmploymentType = NonNullable<UpdateEmployeePayload["employmentType"]>;

interface EmployeeEditValues {
  designation: string;
  department: string;
  joiningDate: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  districtIds: string[];
  regionIds: string[];
  salary: string;
}

interface ApiValidationIssue {
  path?: string;
  message?: string;
}

interface ApiErrorResponse {
  message?: string;
  errors?: ApiValidationIssue[];
}

function getDateInputValue(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function getApiError(error: unknown) {
  if (isAxiosError<ApiErrorResponse>(error)) {
    return {
      message:
        error.response?.data?.message || "Unable to update the employee.",
      issues: error.response?.data?.errors ?? [],
    };
  }

  return {
    message:
      error instanceof Error ? error.message : "Unable to update the employee.",
    issues: [],
  };
}

function selectionWithId(
  currentIds: string[],
  id: string,
  selected: boolean,
) {
  return selected
    ? [...new Set([...currentIds, id])]
    : currentIds.filter((currentId) => currentId !== id);
}

export default function EmployeeEditForm({
  employee,
  onCancel,
  onSaved,
}: {
  employee: Employee;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const updateMutation = useUpdateEmployee();
  const districtsQuery = useDistricts();
  const [values, setValues] = useState<EmployeeEditValues>(() => ({
    designation: employee.designation,
    department: employee.department,
    joiningDate: getDateInputValue(employee.joiningDate),
    employmentType: employee.employmentType,
    status: employee.status,
    districtIds: [...(employee.districtIds ?? [])],
    regionIds: [...(employee.regionIds ?? [])],
    salary: employee.salary === undefined ? "" : String(employee.salary),
  }));
  const [serverError, setServerError] = useState<{
    message: string;
    issues: ApiValidationIssue[];
  } | null>(null);

  const regionQueries = useQueries({
    queries: values.districtIds.map((districtId) => ({
      queryKey: ["regions", districtId, "all"],
      queryFn: () => getAllRegionsByDistrict(districtId),
      enabled: Boolean(districtId),
      staleTime: 1000 * 60 * 10,
    })),
  });
  const regions = regionQueries
    .flatMap((query) => query.data ?? [])
    .filter(
      (region, index, list) =>
        list.findIndex((item) => item._id === region._id) === index,
    );
  const regionsById = new Map(regions.map((region) => [region._id, region]));
  const availableDistrictIds = new Set(
    (districtsQuery.data ?? []).map((district) => district._id),
  );
  const unresolvedDistrictIds = values.districtIds.filter(
    (districtId) => !availableDistrictIds.has(districtId),
  );
  const unresolvedRegionIds = values.regionIds.filter(
    (regionId) => !regionsById.has(regionId),
  );
  const regionsLoading = regionQueries.some((query) => query.isLoading);
  const regionsError = regionQueries.some((query) => query.isError);
  const locationsUnavailable =
    districtsQuery.isLoading || districtsQuery.isError || regionsLoading || regionsError;

  const updateValue = <K extends keyof EmployeeEditValues>(
    field: K,
    value: EmployeeEditValues[K],
  ) => {
    setValues((current) => ({ ...current, [field]: value }));
    setServerError(null);
  };

  const handleDistrictChange = (districtId: string, selected: boolean) => {
    const regionIdsForDistrict = regions
      .filter((region) => getDistrictId(region) === districtId)
      .map((region) => region._id);
    setValues((current) => ({
      ...current,
      districtIds: selectionWithId(current.districtIds, districtId, selected),
      regionIds: selected
        ? current.regionIds
        : current.regionIds.filter(
            (regionId) => !regionIdsForDistrict.includes(regionId),
          ),
    }));
    setServerError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    const payload: UpdateEmployeePayload = {
      designation: values.designation.trim(),
      department: values.department.trim(),
      joiningDate: values.joiningDate,
      employmentType: values.employmentType,
      status: values.status,
      districtIds: values.districtIds,
      regionIds: values.regionIds,
    };
    if (values.salary.trim() !== "") {
      payload.salary = Number(values.salary);
    }

    try {
      await updateMutation.mutateAsync({ employeeId: employee._id, payload });
      toast.success("Employee updated successfully.");
      onSaved();
    } catch (error) {
      const apiError = getApiError(error);
      setServerError(apiError);
      toast.error(apiError.message);
    }
  };

  const retryLocationOptions = () => {
    if (districtsQuery.isError) void districtsQuery.refetch();
    regionQueries.forEach((query) => {
      if (query.isError) void query.refetch();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="mt-5 space-y-5">
      <fieldset
        disabled={updateMutation.isPending}
        className="space-y-5 disabled:opacity-70"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="employee-designation"
              className="mb-2 block text-sm font-medium"
            >
              Designation
            </label>
            <input
              id="employee-designation"
              required
              minLength={2}
              value={values.designation}
              onChange={(event) => updateValue("designation", event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label
              htmlFor="employee-department"
              className="mb-2 block text-sm font-medium"
            >
              Department
            </label>
            <input
              id="employee-department"
              required
              minLength={2}
              value={values.department}
              onChange={(event) => updateValue("department", event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label
              htmlFor="employee-joining-date"
              className="mb-2 block text-sm font-medium"
            >
              Joining date
            </label>
            <input
              id="employee-joining-date"
              type="date"
              required
              value={values.joiningDate}
              onChange={(event) => updateValue("joiningDate", event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label
              htmlFor="employee-employment-type"
              className="mb-2 block text-sm font-medium"
            >
              Employment type
            </label>
            <select
              id="employee-employment-type"
              value={values.employmentType}
              onChange={(event) =>
                updateValue("employmentType", event.target.value as EmploymentType)
              }
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="full-time">Full-time</option>
              <option value="part-time">Part-time</option>
              <option value="contract">Contract</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="employee-work-status"
              className="mb-2 block text-sm font-medium"
            >
              Employee work status
            </label>
            <select
              id="employee-work-status"
              value={values.status}
              onChange={(event) =>
                updateValue("status", event.target.value as EmployeeStatus)
              }
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="on_leave">On Leave</option>
              <option value="resigned">Resigned</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              This changes Employee work status only, not the linked User login status.
            </p>
          </div>
          <div>
            <label
              htmlFor="employee-salary"
              className="mb-2 block text-sm font-medium"
            >
              Salary
            </label>
            <input
              id="employee-salary"
              type="number"
              min="0"
              step="any"
              value={values.salary}
              onChange={(event) => updateValue("salary", event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Leave empty to keep the current value. This API does not support clearing an existing salary.
            </p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">District assignments</legend>
          {districtsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading districts...
            </p>
          ) : districtsQuery.isError ? (
            <p className="text-sm text-destructive" role="alert">
              District options could not be loaded.
            </p>
          ) : (
            <>
              {(districtsQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No districts available.
                </p>
              ) : (
                <div className="grid max-h-40 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
                  {(districtsQuery.data ?? []).map((district) => (
                    <label
                      key={district._id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={values.districtIds.includes(district._id)}
                        disabled={regionsLoading || regionsError}
                        onChange={(event) =>
                          handleDistrictChange(
                            district._id,
                            event.target.checked,
                          )
                        }
                        className="size-4 accent-primary"
                      />
                      <span>{district.districtName}</span>
                    </label>
                  ))}
                </div>
              )}
              {unresolvedDistrictIds.length > 0 && (
                <div className="space-y-2 rounded-lg border border-amber-500/50 p-3">
                  <p className="text-sm text-amber-700">
                    These assigned district IDs are unavailable. Remove them
                    or retry loading the district list before saving.
                  </p>
                  {unresolvedDistrictIds.map((districtId) => (
                    <label
                      key={districtId}
                      className="flex items-center gap-2 break-all text-xs"
                    >
                      <input
                        type="checkbox"
                        checked
                        disabled={regionsLoading || regionsError}
                        onChange={() =>
                          handleDistrictChange(districtId, false)
                        }
                        className="size-4 accent-primary"
                      />
                      Keep unresolved district ID {districtId}
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Region assignments</legend>
          {values.districtIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Select at least one district to choose regions.
            </p>
          ) : regionsLoading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading regions...
            </p>
          ) : regionsError ? (
            <p className="text-sm text-destructive" role="alert">
              Region options could not be loaded.
            </p>
          ) : regions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No regions are available for the selected districts.
            </p>
          ) : (
            <div className="grid max-h-40 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
              {regions.map((region) => (
                <label
                  key={region._id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={values.regionIds.includes(region._id)}
                    onChange={(event) =>
                      updateValue(
                        "regionIds",
                        selectionWithId(
                          values.regionIds,
                          region._id,
                          event.target.checked,
                        ),
                      )
                    }
                    className="size-4 accent-primary"
                  />
                  <span>{region.name}</span>
                </label>
              ))}
            </div>
          )}
          {unresolvedRegionIds.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-500/50 p-3">
              <p className="text-sm text-amber-700">
                Some previously assigned region IDs are not available for the selected districts.
                Remove them or select their district before saving.
              </p>
              {unresolvedRegionIds.map((regionId) => (
                  <label
                    key={regionId}
                    className="flex items-center gap-2 break-all text-xs"
                  >
                    <input
                      type="checkbox"
                      checked
                      disabled={regionsLoading || regionsError}
                      onChange={() =>
                        updateValue(
                          "regionIds",
                          values.regionIds.filter((id) => id !== regionId),
                        )
                      }
                      className="size-4 accent-primary"
                    />
                    Keep unresolved region ID {regionId}
                  </label>
                ))}
            </div>
          )}
        </fieldset>
      </fieldset>

      <p className="text-xs text-muted-foreground">
        Editing Employee document {employee._id}. Linked User {employee.userId?._id ?? "unavailable"} is not changed by this form.
      </p>

      {locationsUnavailable && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <p className="text-sm text-destructive" role="alert">
            Location options must load successfully before assignments can be saved.
          </p>
          {(districtsQuery.isError || regionsError) && (
            <Button type="button" variant="outline" onClick={retryLocationOptions}>
              Retry loading
            </Button>
          )}
        </div>
      )}

      {(unresolvedDistrictIds.length > 0 || unresolvedRegionIds.length > 0) && (
        <p className="text-sm text-destructive" role="alert">
          Remove or resolve the unavailable assignment IDs before saving.
        </p>
      )}

      {serverError && (
        <div
          className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
          role="alert"
        >
          <p className="font-medium text-destructive">{serverError.message}</p>
          {serverError.issues.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {serverError.issues.map((issue, index) => (
                <li key={`${issue.path ?? "body"}-${index}`}>
                  {issue.path ? `${issue.path}: ` : ""}
                  {issue.message ?? "Invalid value"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={updateMutation.isPending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={
            updateMutation.isPending ||
            locationsUnavailable ||
            unresolvedDistrictIds.length > 0 ||
            unresolvedRegionIds.length > 0
          }
        >
          {updateMutation.isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function getDistrictId(region: Region) {
  return typeof region.districtId === "string"
    ? region.districtId
    : region.districtId._id;
}
