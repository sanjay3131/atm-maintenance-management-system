import { useForm } from "react-hook-form";
import { isAxiosError } from "axios";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createATMFormSchema,
  updateATMFormSchema,
  type ATMFormData,
  type ATMFormValues,
} from "../types/create-atm.schema";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";
import { useRegionsByBank } from "@/features/users/hooks/useRegionsByBank";
import { useDistricts } from "@/features/users/hooks/useDistricts";
import { useCreateATM } from "../hooks/useCreateATM";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getATMDisplayId } from "@/features/atms/atmDisplay.utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useMemo, useState } from "react";
import type { ATM, UpdateATMData } from "../types/atm.types";
import { useUpdateATM } from "../hooks/useUpdateATM";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface CreateATMFormProps {
  onClose: () => void;
  initialATM?: ATM;
}

const getATMSubmissionErrorMessage = (
  error: unknown,
  fallback: string,
) => {
  if (isAxiosError<{ message?: string }>(error)) {
    const message = error.response?.data?.message;
    if (message) return message;
    if (error.response?.status === 409) {
      return "Client ATM ID conflicts with an existing ATM.";
    }
  }
  return error instanceof Error ? error.message : fallback;
};

export default function CreateATMForm({
  onClose,
  initialATM,
}: CreateATMFormProps) {
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [moveConfirmationOpen, setMoveConfirmationOpen] = useState(false);
  const [pendingFormData, setPendingFormData] =
    useState<ATMFormData | null>(null);
  const queryClient = useQueryClient();
  const createATM = useCreateATM();
  const updateATM = useUpdateATM();
  const { data: banks = [], isLoading: banksLoading } = useQuery({
    queryKey: ["banks"],
    queryFn: async () => {
      const response = await api.get("/banks");
      return response.data.data;
    },
  });
  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const response = await api.get("/customers");
      return response.data.data;
    },
  });
  const { data: employees = [], isLoading: employeesLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const response = await api.get("/employees");
      return response.data.data;
    },
  });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors },
  } = useForm<ATMFormValues, unknown, ATMFormData>({
    resolver: zodResolver(
      initialATM ? updateATMFormSchema : createATMFormSchema,
    ),
    defaultValues: {
      clientAtmId: "",
      bankId: "",
      customerId: "",
      districtId: "",
      regionId: "",
      locationName: "",
      city: "",
      address: "",
      installationType: "ONSITE",
      status: "ACTIVE",
      assignedEmployeeId: [],
    },
  });

  useEffect(() => {
    if (!initialATM) return;

    reset({
      clientAtmId: initialATM.clientAtmId ?? "",
      bankId: initialATM.bankId?._id ?? "",
      customerId:
        typeof initialATM.customer === "string"
          ? initialATM.customer
          : (initialATM.customer?._id ?? ""),
      districtId: initialATM.districtId?._id ?? "",
      regionId: initialATM.regionId?._id ?? "",
      locationName: initialATM.locationName,
      city: initialATM.city ?? "",
      address: initialATM.address,
      installationType: initialATM.installationType,
      status: initialATM.status,
      assignedEmployeeId: [
        ...new Set(
          initialATM.assignedEmployeeId.flatMap((employee) =>
            typeof employee === "string"
              ? [employee]
              : employee
                ? [employee._id]
                : [],
          ),
        ),
      ],
    });
  }, [initialATM, reset]);

  const selectedBankId = watch("bankId");
  const selectedRegionId = watch("regionId");
  const selectedDistrictId = watch("districtId");

  const {
    data: regions = [],
    isLoading: regionsLoading,
    isError: regionsError,
  } = useRegionsByBank(selectedBankId);
  const {
    data: districts = [],
    isLoading: districtsLoading,
    isError: districtsError,
  } = useDistricts(Boolean(selectedRegionId), selectedRegionId);
  const activeRegions = regions.filter((region) => region.isActive);
  const destinationRegionId = selectedRegionId;
  const geographicAssignmentChanged =
    initialATM !== undefined &&
    (initialATM.bankId?._id !== selectedBankId ||
      initialATM.districtId?._id !== watch("districtId") ||
      initialATM.regionId?._id !== destinationRegionId);

  const invalidateATMGeographyQueries = async (includeJobs: boolean) => {
    const queryKeys = [
      ["atms"],
      ["district-atms"],
      ["region-atms"],
      ["district-employees"],
      ["region-employees"],
      ["district-customers"],
      ["region-customers"],
      ["district-geographic-summaries"],
    ];
    if (includeJobs) queryKeys.push(["jobs"]);
    await Promise.all(
      queryKeys.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  };

  const saveATM = async (data: ATMFormData) => {
    if (initialATM) {
      const targetRegionId =
        data.regionId;
      const hasGeographicChange =
        initialATM.bankId?._id !== data.bankId ||
        initialATM.districtId?._id !== data.districtId ||
        initialATM.regionId?._id !== targetRegionId;
      const updateData: UpdateATMData = {
        ...(data.clientAtmId !== undefined
          ? { clientAtmId: data.clientAtmId }
          : {}),
        customerId: data.customerId,
        bankId: data.bankId,
        ...(hasGeographicChange
          ? {
              districtId: data.districtId,
              regionId: targetRegionId,
            }
          : {}),
        locationName: data.locationName,
        ...(data.city !== undefined ? { city: data.city } : {}),
        address: data.address,
        installationType: data.installationType,
        status: data.status,
        assignedEmployeeId: data.assignedEmployeeId,
      };

      updateATM.mutate(
        { atmId: initialATM._id, data: updateData },
        {
          onSuccess: async () => {
            toast.success(
              `ATM ${getATMDisplayId(initialATM)} updated successfully!`,
            );
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["atms"] }),
              queryClient.invalidateQueries({
                queryKey: ["atm", initialATM._id],
              }),
              invalidateATMGeographyQueries(hasGeographicChange),
            ]);
            onClose();
          },
          onError: (error) => {
            toast.error(getATMSubmissionErrorMessage(error, "ATM update failed."));
            console.error("ATM update failed:", error);
          },
        },
      );
      return;
    }

    if (!data.clientAtmId) {
      setError("clientAtmId", {
        type: "required",
        message: "Client ATM ID is required",
      });
      return;
    }

    if (!data.city) {
      setError("city", {
        type: "required",
        message: "City is required",
      });
      return;
    }

    createATM.mutate(
      { ...data, clientAtmId: data.clientAtmId, city: data.city },
      {
        onSuccess: async (atm) => {
          toast.success(
            `ATM ${getATMDisplayId(atm)} created successfully!`,
          );
          await invalidateATMGeographyQueries(false);
          onClose();
        },
        onError: (error) => {
          toast.error(getATMSubmissionErrorMessage(error, "ATM creation failed."));
          console.error("ATM creation failed:", error);
        },
      },
    );
  };

  const onSubmit = (data: ATMFormData) => {
    if (initialATM?.clientAtmId && !data.clientAtmId) {
      setError("clientAtmId", {
        type: "required",
        message: "Client ATM ID is required",
      });
      return;
    }

    if (geographicAssignmentChanged) {
      setPendingFormData(data);
      setMoveConfirmationOpen(true);
      return;
    }
    void saveATM(data);
  };

  const filteredEmployees = useMemo(() => {
    const search = employeeSearch.toLowerCase().trim();

    if (!search) return employees;

    return employees.filter(
      (employee: {
        employeeCode: string;
        userId: {
          firstName: string;
          lastName?: string;
        };
      }) => {
        const name = `${employee.userId?.firstName || ""} ${
          employee.userId?.lastName || ""
        }`.toLowerCase();

        return (
          name.includes(search) ||
          employee.employeeCode.toLowerCase().includes(search)
        );
      },
    );
  }, [employees, employeeSearch]);
  const selectedEmployeeIds = watch("assignedEmployeeId") ?? [];
  const availableEmployeeOptions = filteredEmployees.filter(
    (employee: {
      _id: string;
      status?: string;
      userId?: { status?: string };
    }) =>
      (employee.status === "active" && employee.userId?.status === "active") ||
      selectedEmployeeIds.includes(employee._id),
  );

  const toggleEmployee = (employeeId: string, checked: boolean) => {
    const nextIds = checked
      ? [...new Set([...selectedEmployeeIds, employeeId])]
      : selectedEmployeeIds.filter((id) => id !== employeeId);
    setValue("assignedEmployeeId", nextIds, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
      {/* select bank */}
      <div>
        <label className="mb-2 block text-sm font-medium">Bank</label>

        <Select
          value={selectedBankId}
          onValueChange={(value) => {
            if (value && value !== selectedBankId) {
              setValue("bankId", value);
              setValue("regionId", "");
              setValue("districtId", "");
            }
          }}
          disabled={banksLoading}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select bank">
              {
                banks.find(
                  (bank: { _id: string; bankName: string }) =>
                    bank._id === watch("bankId"),
                )?.bankName
              }
            </SelectValue>
          </SelectTrigger>

          <SelectContent>
            {banks.filter((bank: { isActive: boolean }) => bank.isActive).map((bank: { _id: string; bankName: string }) => (
              <SelectItem key={bank._id} value={bank._id}>
                {bank.bankName}
              </SelectItem>
            ))}
            {initialATM?.bankId?._id === selectedBankId &&
              !banks.some((bank: { _id: string; isActive?: boolean }) => bank._id === selectedBankId && bank.isActive) && (
                <SelectItem value={selectedBankId} disabled>
                  {initialATM.bankId.bankName} (inactive or unavailable)
                </SelectItem>
              )}
          </SelectContent>
        </Select>
        {errors.bankId && (
          <p className="mt-1 text-sm text-red-500">{errors.bankId.message}</p>
        )}
      </div>
      {/* select region */}
      <div>
        <label className="mb-1 block text-sm font-medium">Region</label>

        <Select
          value={selectedRegionId}
          onValueChange={(value) => {
            if (value && value !== selectedRegionId) {
              setValue("regionId", value);
              setValue("districtId", "");
            }
          }}
          disabled={!selectedBankId || regionsLoading || regionsError}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                !selectedBankId
                  ? "Select bank first"
                  : regionsLoading
                    ? "Loading regions..."
                    : regionsError
                      ? "Regions unavailable"
                      : "Select region"
              }
            >
              {regions.find((region) => region._id === selectedRegionId)?.name ??
                (initialATM?.regionId?._id === selectedRegionId
                  ? `${initialATM.regionId.name} (inactive or unavailable)`
                  : null)}
            </SelectValue>
          </SelectTrigger>

          <SelectContent>
            {activeRegions.map((region) => (
              <SelectItem key={region._id} value={region._id}>
                {region.name}
              </SelectItem>
            ))}
            {initialATM?.regionId?._id === selectedRegionId &&
              !activeRegions.some((region) => region._id === selectedRegionId) && (
                <SelectItem value={selectedRegionId} disabled>
                  {initialATM.regionId.name} (inactive or unavailable)
                </SelectItem>
              )}
          </SelectContent>
        </Select>
        {errors.regionId && <p className="mt-1 text-sm text-red-500">{errors.regionId.message}</p>}
      </div>
      {/* select district */}
      <div>
        <label className="mb-1 block text-sm font-medium">District</label>

        <Select
          value={watch("districtId")}
          onValueChange={(value) => {
            if (value) setValue("districtId", value);
          }}
          disabled={
            !selectedRegionId || districtsLoading || districtsError
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={!selectedRegionId ? "Select region first" : districtsLoading ? "Loading districts..." : "Select district"}>
              {districts.find((district) => district._id === watch("districtId"))?.districtName ??
                (initialATM?.districtId?._id === watch("districtId")
                  ? `${initialATM.districtId.districtName} (inactive or unavailable)`
                  : null)}
            </SelectValue>
          </SelectTrigger>

          <SelectContent>
            {initialATM?.districtId?._id === watch("districtId") &&
              !districts.some((district) => district._id === watch("districtId") && district.isActive) && (
                <SelectItem value={watch("districtId")} disabled>
                  {initialATM.districtId.districtName} (inactive or unavailable)
                </SelectItem>
              )}
            {districts.filter((district) => district.isActive).map((district) => (
              <SelectItem key={district._id} value={district._id}>{district.districtName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.districtId && <p className="mt-1 text-sm text-red-500">{errors.districtId.message}</p>}
      </div>
      {/* select customer */}
      <div>
        <label className="mb-1 block text-sm font-medium">Customer</label>
        <Select
          value={watch("customerId")}
          onValueChange={(value) => {
            if (value) setValue("customerId", value);
          }}
          disabled={customersLoading}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select customer">
              {customers.find((customer: { _id: string; customerName: string }) => customer._id === watch("customerId"))?.customerName}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {customers.map((customer: { _id: string; customerName: string }) => (
              <SelectItem key={customer._id} value={customer._id}>{customer.customerName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.customerId && <p className="mt-1 text-sm text-red-500">{errors.customerId.message}</p>}
      </div>
      {/* select location name */}
      <div>
        <label className="mb-1 block text-sm font-medium">
          Client ATM ID
        </label>
        <input
          {...register("clientAtmId")}
          required={!initialATM}
          placeholder="Enter client ATM ID"
          className="w-full rounded-md border px-3 py-2"
        />
        {errors.clientAtmId && (
          <p className="mt-1 text-sm text-red-500">
            {errors.clientAtmId.message}
          </p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">City</label>
        <input
          {...register("city")}
          required={!initialATM}
          placeholder="Enter city"
          className="w-full rounded-md border px-3 py-2"
        />
        {errors.city && (
          <p className="mt-1 text-sm text-red-500">{errors.city.message}</p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Location Name</label>

        <input
          {...register("locationName")}
          placeholder="Enter ATM location"
          className="w-full rounded-md border px-3 py-2"
        />
        {errors.locationName && (
          <p className="mt-1 text-sm text-red-500">
            {errors.locationName.message}
          </p>
        )}
      </div>
      {/* select address */}
      <div>
        <label className="mb-1 block text-sm font-medium">Address</label>

        <input
          {...register("address")}
          placeholder="Enter ATM address"
          className="w-full rounded-md border px-3 py-2"
        />
        {errors.address && (
          <p className="mt-1 text-sm text-red-500">{errors.address.message}</p>
        )}
      </div>
      {/* installation type */}
      <div>
        <label className="mb-1 block text-sm font-medium">
          Installation Type
        </label>

        <Select
          value={watch("installationType")}
          onValueChange={(value) =>
            setValue("installationType", value as "ONSITE" | "OFFSITE")
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select installation type" />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="ONSITE">ONSITE</SelectItem>
            <SelectItem value="OFFSITE">OFFSITE</SelectItem>
          </SelectContent>
        </Select>

        {errors.installationType && (
          <p className="mt-1 text-sm text-red-500">
            {errors.installationType.message}
          </p>
        )}
      </div>
      {/* status */}
      <div>
        <label className="mb-1 block text-sm font-medium">Status</label>

        <Select
          value={watch("status")}
          onValueChange={(value) =>
            setValue(
              "status",
              value as "ACTIVE" | "INACTIVE" | "UNDER_MAINTENANCE" | "REMOVED",
            )
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="ACTIVE">ACTIVE</SelectItem>
            <SelectItem value="INACTIVE">INACTIVE</SelectItem>
            <SelectItem value="UNDER_MAINTENANCE">UNDER MAINTENANCE</SelectItem>
            <SelectItem value="REMOVED">REMOVED</SelectItem>
          </SelectContent>
        </Select>

        {errors.status && (
          <p className="mt-1 text-sm text-red-500">{errors.status.message}</p>
        )}
      </div>
      {/* assign employees */}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Assigned Employees</legend>
        <input
          type="text"
          placeholder="Search employee..."
          value={employeeSearch}
          onChange={(e) => setEmployeeSearch(e.target.value)}
          className="mb-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
          {employeesLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading employees...
            </p>
          ) : availableEmployeeOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No matching active employees.
            </p>
          ) : (
            availableEmployeeOptions.map(
              (employee: {
                _id: string;
                employeeCode: string;
                status?: string;
                userId?: {
                  firstName?: string;
                  lastName?: string;
                  status?: string;
                };
              }) => (
                <label
                  key={employee._id}
                  className="flex cursor-pointer items-center gap-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedEmployeeIds.includes(employee._id)}
                    onChange={(event) =>
                      toggleEmployee(employee._id, event.target.checked)
                    }
                    className="size-4 accent-primary"
                  />
                  <span>
                    {employee.employeeCode} —{" "}
                    {`${employee.userId?.firstName || ""} ${
                      employee.userId?.lastName || ""
                    }`.trim()}
                    {employee.status !== "active" && " (inactive)"}
                  </span>
                </label>
              ),
            )
          )}
        </div>
        {errors.assignedEmployeeId && (
          <p className="mt-1 text-sm text-red-500">
            {errors.assignedEmployeeId.message}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Select any number of employees assigned to this ATM.
        </p>
      </fieldset>

      {/* submit button */}
      <button
        type="submit"
        disabled={createATM.isPending || updateATM.isPending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        {initialATM
          ? updateATM.isPending
            ? "Updating..."
            : "Update ATM"
          : createATM.isPending
            ? "Creating..."
            : "Create ATM"}
      </button>

      <Dialog
        open={moveConfirmationOpen}
        onOpenChange={(open) => {
          if (!open) {
            setMoveConfirmationOpen(false);
            setPendingFormData(null);
          }
        }}
      >
        <DialogContent>
          <DialogTitle>Confirm ATM geographic move</DialogTitle>
          <DialogDescription>
            This move is allowed only when the ATM has no unresolved Jobs,
            unresolved AMC work, or active recurring maintenance plans.
          </DialogDescription>
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-medium">From:</span>{" "}
              {initialATM?.districtId?.districtName || "District unavailable"}
              {" / "}
              {initialATM?.regionId?.name || "No Region"}
            </p>
            <p>
              <span className="font-medium">To:</span>{" "}
              {districts.find((district) => district._id === selectedDistrictId)
                ?.districtName || "District unavailable"}
              {" / "}
              {destinationRegionId
                ? regions.find((region) => region._id === destinationRegionId)
                    ?.name || "Region unavailable"
                : "No Region"}
            </p>
            <p className="text-muted-foreground">
              The existing employee assignment, customer relationship, Jobs,
              AMC records, and recurring plans will not be reassigned or
              rewritten.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMoveConfirmationOpen(false);
                setPendingFormData(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={updateATM.isPending || !pendingFormData}
              onClick={() => {
                if (!pendingFormData) return;
                const submitted = pendingFormData;
                setMoveConfirmationOpen(false);
                setPendingFormData(null);
                void saveATM(submitted);
              }}
            >
              {updateATM.isPending ? "Moving..." : "Confirm move"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </form>
  );
}
