import { useForm } from "react-hook-form";
import type { EmployeeDetailsForm } from "../types/user.types";
import { useDistricts } from "../hooks/useDistricts";
import { useQueries } from "@tanstack/react-query";
import { getRegionsByDistrict } from "../services/region.service";
import { useATMs } from "../hooks/useATMs";
import { useEffect } from "react";

interface EmployeeDetailsStepProps {
  defaultValues: EmployeeDetailsForm;
  onSubmit: (data: EmployeeDetailsForm) => void;
  onBack: () => void;
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
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeDetailsForm>({
    defaultValues,
  });
  const { data: districts = [], isLoading: isDistrictsLoading } =
    useDistricts();
  const selectedDistrictIds = watch("districtIds");
  const selectedRegionIds = watch("regionIds");
  const selectedAtmIds = watch("assignedAtmIds");

  const { data: atms = [], isLoading: isATMsLoading } = useATMs();
  const regionQueries = useQueries({
    queries: selectedDistrictIds.map((districtId) => ({
      queryKey: ["regions", districtId],
      queryFn: () => getRegionsByDistrict(districtId),
      enabled: Boolean(districtId),
      staleTime: 1000 * 60 * 10,
    })),
  });
  const regions = regionQueries
    .flatMap((query) => query.data ?? [])
    .filter(
      (region, index, self) =>
        index === self.findIndex((item) => item._id === region._id),
    );

  const isRegionsLoading = regionQueries.some((query) => query.isLoading);

  const filteredATMs = atms.filter((atm) => {
    const districtMatch =
      selectedDistrictIds.length > 0 &&
      !!atm.districtId &&
      selectedDistrictIds.includes(atm.districtId._id);

    const regionMatch =
      selectedRegionIds.length === 0 ||
      (atm.regionId && selectedRegionIds.includes(atm.regionId._id));

    return districtMatch && regionMatch;
  });

  const visibleAtmIds = new Set(filteredATMs.map((atm) => atm._id));

  const validSelectedAtmIds = selectedAtmIds.filter((id) =>
    visibleAtmIds.has(id),
  );
  useEffect(() => {
    if (selectedAtmIds.length !== validSelectedAtmIds.length) {
      setValue("assignedAtmIds", validSelectedAtmIds);
    }
  }, [selectedAtmIds, validSelectedAtmIds, setValue]);

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
        {/* District */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Districts</label>

          <div className="rounded-md border">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm">
                <span>
                  {watch("districtIds").length === 0
                    ? "Select districts"
                    : `${watch("districtIds").length} district(s) selected`}
                </span>

                <span className="text-gray-400 group-open:rotate-180">▾</span>
              </summary>

              <div className="max-h-48 overflow-y-auto border-t p-2">
                {isDistrictsLoading ? (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    Loading districts...
                  </p>
                ) : (
                  districts.map((district) => {
                    const selected = watch("districtIds").includes(
                      district._id,
                    );

                    return (
                      <label
                        key={district._id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-gray-100"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) => {
                            const current = watch("districtIds");

                            setValue(
                              "districtIds",
                              e.target.checked
                                ? [...current, district._id]
                                : current.filter((id) => id !== district._id),
                            );
                          }}
                        />

                        <span>{district.districtName}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </details>
          </div>
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
                {selectedDistrictIds.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    Select a district first
                  </p>
                ) : isRegionsLoading ? (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    Loading regions...
                  </p>
                ) : regions.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-gray-500">
                    No regions found
                  </p>
                ) : (
                  regions.map((region) => {
                    const selected = watch("regionIds").includes(region._id);

                    return (
                      <label
                        key={region._id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-gray-100"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) => {
                            const current = watch("regionIds");

                            setValue(
                              "regionIds",
                              e.target.checked
                                ? [...current, region._id]
                                : current.filter((id) => id !== region._id),
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
                          <div className="font-medium">{atm.atmId}</div>

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
        <div>
          <label className="mb-1 block text-sm font-medium">Joining Date</label>

          <input
            type="date"
            {...register("joiningDate", {
              required: "Joining date is required",
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
