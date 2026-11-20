import { useForm } from "react-hook-form";
import type { EmployeeDetailsForm } from "../types/user.types";
import { useDistricts } from "../hooks/useDistricts";
import { useAllRegions } from "../hooks/useAllRegions";
import { useATMs } from "../../atms/hooks/useATMs";
import { useEffect, useMemo } from "react";
import SupervisorSelect from "@/features/employees/components/SupervisorSelect";
import { getATMDisplayId } from "@/features/atms/atmDisplay.utils";
import type { ATM } from "@/features/atms/types/atm.types";
import type { District } from "../types/district.types";

interface EmployeeDetailsStepProps {
  defaultValues: EmployeeDetailsForm;
  onSubmit: (data: EmployeeDetailsForm) => void;
  onBack: () => void;
}

const EMPTY_ATMS: ATM[] = [];
const EMPTY_DISTRICTS: District[] = [];

function getDistrictRegionId(district: District) {
  return typeof district.regionId === "string"
    ? district.regionId
    : district.regionId?._id;
}

export default function EmployeeDetailsStep({
  defaultValues,
  onSubmit,
  onBack,
}: EmployeeDetailsStepProps) {
  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeDetailsForm>({
    defaultValues,
  });
  const selectedDistrictIds = watch("districtIds") ?? [];
  const selectedRegionIds = watch("regionIds") ?? [];
  const selectedAtmIds = watch("assignedAtmIds") ?? [];
  const selectedDistrictIdsKey = selectedDistrictIds.join("|");
  const selectedRegionIdsKey = selectedRegionIds.join("|");
  const selectedAtmIdsKey = selectedAtmIds.join("|");
  const districtsQuery = useDistricts(
    selectedRegionIds.length > 0,
    selectedRegionIds,
  );
  const districts = districtsQuery.data ?? EMPTY_DISTRICTS;
  const isDistrictsLoading = districtsQuery.isLoading;

  const atmsQuery = useATMs();
  const atms = atmsQuery.data ?? EMPTY_ATMS;
  const isATMsLoading = atmsQuery.isLoading;
  const { data: regions = [], isLoading: isRegionsLoading } = useAllRegions();

  const districtRegionIdsById = useMemo(
    () =>
      new Map(
        districts.map((district) => [
          district._id,
          getDistrictRegionId(district),
        ]),
      ),
    [districts],
  );
  const validDistrictIds = useMemo(
    () => new Set(districts.map((district) => district._id)),
    [districts],
  );
  const selectedDistrictIdSet = useMemo(
    () => new Set(selectedDistrictIdsKey ? selectedDistrictIdsKey.split("|") : []),
    [selectedDistrictIdsKey],
  );
  const selectedRegionIdSet = useMemo(
    () => new Set(selectedRegionIdsKey ? selectedRegionIdsKey.split("|") : []),
    [selectedRegionIdsKey],
  );
  const visibleAtmIds = useMemo(
    () =>
      new Set(
        atms
          .filter((atm) => {
            const districtMatch =
              selectedDistrictIdSet.size > 0 &&
              !!atm.districtId &&
              selectedDistrictIdSet.has(atm.districtId._id);
            const regionMatch =
              selectedRegionIdSet.size === 0 ||
              (!!atm.regionId && selectedRegionIdSet.has(atm.regionId._id));
            return districtMatch && regionMatch;
          })
          .map((atm) => atm._id),
      ),
    [atms, selectedDistrictIdSet, selectedRegionIdSet],
  );

  useEffect(() => {
    const currentRegionIds = getValues("regionIds") ?? [];
    const currentDistrictIds = getValues("districtIds") ?? [];
    if (currentRegionIds.length === 0) {
      if (currentDistrictIds.length > 0) {
        setValue("districtIds", [], { shouldDirty: true });
      }
      return;
    }

    if (!districtsQuery.isSuccess) return;

    const nextDistrictIds = currentDistrictIds.filter((id) =>
      validDistrictIds.has(id),
    );
    if (nextDistrictIds.length !== currentDistrictIds.length) {
      setValue("districtIds", nextDistrictIds, { shouldDirty: true });
    }
  }, [
    districtsQuery.isSuccess,
    districtsQuery.dataUpdatedAt,
    getValues,
    selectedDistrictIdsKey,
    selectedRegionIdsKey,
    setValue,
    validDistrictIds,
  ]);

  const updateRegionSelection = (regionId: string, selected: boolean) => {
    const nextRegionIds = selected
      ? [...new Set([...selectedRegionIds, regionId])]
      : selectedRegionIds.filter((id) => id !== regionId);
    const nextDistrictIds = selectedDistrictIds.filter((districtId) => {
      const districtRegionId = districtRegionIdsById.get(districtId);
      return !districtRegionId || nextRegionIds.includes(districtRegionId);
    });

    setValue("regionIds", nextRegionIds, {
      shouldDirty: true,
      shouldValidate: true,
    });
    if (nextDistrictIds.length !== selectedDistrictIds.length) {
      setValue("districtIds", nextDistrictIds, { shouldDirty: true });
    }
  };

  const filteredATMs = atms.filter((atm) => visibleAtmIds.has(atm._id));

  useEffect(() => {
    if (!atmsQuery.isSuccess) return;

    const currentSelectedAtmIds = getValues("assignedAtmIds") ?? [];
    const nextSelectedAtmIds = currentSelectedAtmIds.filter((id) =>
      visibleAtmIds.has(id),
    );
    if (currentSelectedAtmIds.length !== nextSelectedAtmIds.length) {
      setValue("assignedAtmIds", nextSelectedAtmIds);
    }
  }, [
    atmsQuery.dataUpdatedAt,
    atmsQuery.isSuccess,
    getValues,
    selectedAtmIdsKey,
    setValue,
    visibleAtmIds,
  ]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Employee Details</h2>

        <p className="mt-1 text-sm text-gray-500">
          Enter the employee-specific information.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Designation */}
        <div>
          <label className="mb-1 block text-sm font-medium">Designation</label>

          <input
            {...register("designation", {
              required: "Designation is required",
              minLength: {
                value: 2,
                message: "Designation must be at least 2 characters",
              },
            })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="ATM Service Technician"
          />

          {errors.designation && (
            <p className="mt-1 text-sm text-red-500">
              {errors.designation.message}
            </p>
          )}
        </div>

        {/* Department */}
        <div>
          <label className="mb-1 block text-sm font-medium">Department</label>

          <input
            {...register("department", {
              required: "Department is required",
              minLength: {
                value: 2,
                message: "Department must be at least 2 characters",
              },
            })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Field Operations"
          />

          {errors.department && (
            <p className="mt-1 text-sm text-red-500">
              {errors.department.message}
            </p>
          )}
        </div>
        {/* Regions */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Regions</label>

          <div className="rounded-md border">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm">
                <span>
                  {watch("regionIds").length === 0
                    ? "Select regions"
                    : `${watch("regionIds").length} region(s) selected`}
                </span>

                <span className="text-gray-400 group-open:rotate-180">▾</span>
              </summary>

              <div className="max-h-48 overflow-y-auto border-t p-2">
                {isRegionsLoading ? (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    Loading regions...
                  </p>
                ) : regions.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    No active regions found
                  </p>
                ) : (
                  regions.map((region) => {
                    const selected = selectedRegionIds.includes(region._id);

                    return (
                      <label
                        key={region._id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-gray-100"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) => {
                            updateRegionSelection(
                              region._id,
                              e.target.checked,
                            );
                          }}
                        />

                        <span>{region.name}</span>

                        {region.code && (
                          <span className="text-xs text-gray-400">
                            ({region.code})
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </details>
          </div>
          {districtsQuery.isError && (
            <p className="text-sm text-red-500" role="alert">
              Districts could not be loaded for the selected regions.{" "}
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
        {/* District */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Districts</label>

          <div className="rounded-md border">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm">
                <span>
                  {selectedDistrictIds.length === 0
                    ? "Select districts"
                    : `${selectedDistrictIds.length} district(s) selected`}
                </span>

                <span className="text-gray-400 group-open:rotate-180">▾</span>
              </summary>

              <div className="max-h-48 overflow-y-auto border-t p-2">
                {selectedRegionIds.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    Select a region first
                  </p>
                ) : isDistrictsLoading ? (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    Loading districts...
                  </p>
                ) : districtsQuery.isError ? (
                  <p className="px-2 py-2 text-sm text-red-500" role="alert">
                    Districts could not be loaded. Use the retry control above.
                  </p>
                ) : districts.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    No districts found for the selected regions
                  </p>
                ) : (
                  districts.map((district) => (
                    <label
                      key={district._id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-gray-100"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDistrictIds.includes(district._id)}
                        onChange={(event) => {
                          const nextDistrictIds = event.target.checked
                            ? [...new Set([...selectedDistrictIds, district._id])]
                            : selectedDistrictIds.filter(
                                (id) => id !== district._id,
                              );
                          setValue("districtIds", nextDistrictIds, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        }}
                      />
                      <span>{district.districtName}</span>
                    </label>
                  ))
                )}
              </div>
            </details>
          </div>
        </div>
        {/* assign atm */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Assign ATMs</label>

          <div className="rounded-md border">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm">
                <span>
                  {watch("assignedAtmIds").length === 0
                    ? "Select ATMs"
                    : `${watch("assignedAtmIds").length} ATM(s) selected`}
                </span>

                <span className="text-gray-400 group-open:rotate-180">▾</span>
              </summary>
              {filteredATMs.length > 0 && (
                <div className="flex justify-end border-t px-3 py-2">
                  <button
                    type="button"
                    className="text-sm font-medium text-blue-600 hover:text-blue-800"
                    onClick={() => {
                      const current = watch("assignedAtmIds");

                      const allSelected = filteredATMs.every((atm) =>
                        current.includes(atm._id),
                      );

                      setValue(
                        "assignedAtmIds",
                        allSelected
                          ? current.filter(
                              (id) =>
                                !filteredATMs.some((atm) => atm._id === id),
                            )
                          : [
                              ...current,
                              ...filteredATMs
                                .map((atm) => atm._id)
                                .filter((id) => !current.includes(id)),
                            ],
                      );
                    }}
                  >
                    {filteredATMs.every((atm) =>
                      watch("assignedAtmIds").includes(atm._id),
                    )
                      ? "Deselect All"
                      : "Select All"}{" "}
                  </button>
                </div>
              )}
              <div className="max-h-60 overflow-y-auto border-t p-2">
                {selectedDistrictIds.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    Select a district first
                  </p>
                ) : isATMsLoading ? (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    Loading ATMs...
                  </p>
                ) : filteredATMs.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    No ATMs found
                  </p>
                ) : selectedDistrictIds.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-gray-500">
                    Select a district first
                  </p>
                ) : filteredATMs.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-gray-500">
                    No ATMs found for the selected district/region
                  </p>
                ) : (
                  filteredATMs.map((atm) => {
                    const selected = watch("assignedAtmIds").includes(atm._id);

                    return (
                      <label
                        key={atm._id}
                        className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-gray-100"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) => {
                            const current = watch("assignedAtmIds");

                            setValue(
                              "assignedAtmIds",
                              e.target.checked
                                ? [...current, atm._id]
                                : current.filter((id) => id !== atm._id),
                            );
                          }}
                        />

                        <div>
                          <div className="font-medium">
                            {getATMDisplayId(atm)}
                          </div>

                          <div className="text-xs text-gray-500">
                            {atm.locationName}
                          </div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </details>
          </div>
        </div>

        {/* Joining Date */}
        <SupervisorSelect
          id="employee-supervisor"
          value={watch("supervisorId") ?? ""}
          onChange={(supervisorId) =>
            setValue("supervisorId", supervisorId || null)
          }
        />

        {/* Joining Date */}
        <div>
          <label className="mb-1 block text-sm font-medium">Joining Date</label>

          <input
            type="date"
            {...register("joiningDate", {
              required: "Joining date is required",
              validate: (value) =>
                value ? true : "Please select a joining date",
            })}
            className="w-full rounded-md border px-3 py-2"
          />

          {errors.joiningDate && (
            <p className="mt-1 text-sm text-red-500">
              {errors.joiningDate.message}
            </p>
          )}
        </div>

        {/* Employment Type */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Employment Type
          </label>

          <select
            {...register("employmentType", {
              required: "Employment type is required",
            })}
            className="w-full rounded-md border px-3 py-2"
          >
            <option value="">Select employment type</option>
            <option value="full-time">Full-time</option>
            <option value="part-time">Part-time</option>
            <option value="contract">Contract</option>
          </select>

          {errors.employmentType && (
            <p className="mt-1 text-sm text-red-500">
              {errors.employmentType.message}
            </p>
          )}
        </div>

        {/* Salary */}
        <div>
          <label className="mb-1 block text-sm font-medium">Salary</label>

          <input
            type="number"
            {...register("salary", {
              valueAsNumber: true,
              min: {
                value: 0,
                message: "Salary cannot be negative",
              },
            })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="22000"
          />

          {errors.salary && (
            <p className="mt-1 text-sm text-red-500">{errors.salary.message}</p>
          )}
        </div>
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={isSubmitting}
          className="rounded-md border px-5 py-2 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back
        </button>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          {isSubmitting ? "Creating..." : "Create Employee"}
        </button>
      </div>
    </form>
  );
}
