import { useForm } from "react-hook-form";
import { isAxiosError } from "axios";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createATMFormSchema,
  type CreateATMFormData,
} from "../types/create-atm.schema";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";
import { useAllRegionsByDistrict } from "@/features/users/hooks/useAllRegionsByDistrict";
import { useCreateATM } from "../hooks/useCreateATM";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
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
import type { District } from "@/features/users/types/district.types";

const NO_REGION = "NO_REGION";

interface CreateATMFormProps {
  onClose: () => void;
  initialATM?: ATM;
}

export default function CreateATMForm({
  onClose,
  initialATM,
}: CreateATMFormProps) {
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [moveConfirmationOpen, setMoveConfirmationOpen] = useState(false);
  const [pendingFormData, setPendingFormData] =
    useState<CreateATMFormData | null>(null);
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
  const {
    data: districts = [],
    isLoading: districtsLoading,
    isError: districtsError,
  } = useQuery<District[]>({
    queryKey: ["districts"],
    queryFn: async () => {
      const response = await api.get("/districts");
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
    reset,
    formState: { errors },
  } = useForm<CreateATMFormData>({
    resolver: zodResolver(createATMFormSchema),
    defaultValues: {
      bankId: "",
      customerId: "",
      districtId: "",
      regionId: "",
      locationName: "",
      address: "",
      installationType: "ONSITE",
      status: "ACTIVE",
      assignedEmployeeId: [],
    },
  });

  useEffect(() => {
    if (!initialATM) return;

    reset({
      bankId: initialATM.bankId?._id ?? "",
      customerId:
        typeof initialATM.customer === "string"
          ? initialATM.customer
          : (initialATM.customer?._id ?? ""),
      districtId: initialATM.districtId?._id ?? "",
      regionId: initialATM.regionId?._id ?? NO_REGION,
      locationName: initialATM.locationName,
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
      ].slice(0, 1),
    });
  }, [initialATM, reset]);

  const selectedDistrictId = watch("districtId");

  const {
    data: regions = [],
    isLoading: regionsLoading,
    isError: regionsError,
  } = useAllRegionsByDistrict(selectedDistrictId);
  const activeRegions = regions.filter((region) => region.isActive);
  const noRegionsLoaded =
    Boolean(selectedDistrictId) &&
    !regionsLoading &&
    !regionsError &&
    activeRegions.length === 0;
  const selectedRegionId = watch("regionId");
  const destinationRegionId =
    selectedRegionId === NO_REGION ? null : selectedRegionId;
  const geographicAssignmentChanged =
    initialATM !== undefined &&
    (initialATM.districtId?._id !== selectedDistrictId ||
      (initialATM.regionId?._id ?? null) !== destinationRegionId);

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

  const saveATM = async (data: CreateATMFormData) => {
    if (initialATM) {
      const targetRegionId =
        data.regionId === NO_REGION ? null : data.regionId;
      const hasGeographicChange =
        initialATM.districtId?._id !== data.districtId ||
        (initialATM.regionId?._id ?? null) !== targetRegionId;
      const updateData: UpdateATMData = {
        customerId: data.customerId,
        bankId: data.bankId,
        ...(hasGeographicChange
          ? {
              districtId: data.districtId,
              regionId: targetRegionId,
            }
          : {}),
        locationName: data.locationName,
        address: data.address,
        installationType: data.installationType,
        status: data.status,
        assignedEmployeeId: data.assignedEmployeeId,
      };

      updateATM.mutate(
        { atmId: initialATM._id, data: updateData },
        {
          onSuccess: async () => {
            toast.success(`ATM ${initialATM.atmId} updated successfully!`);
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
            toast.error(
              isAxiosError<{ message?: string }>(error)
                ? error.response?.data?.message || "ATM update failed."
                : error.message || "ATM update failed.",
            );
            console.error("ATM update failed:", error);
          },
        },
      );
      return;
    }

    createATM.mutate(
      { ...data, regionId: data.regionId === NO_REGION ? null : data.regionId },
      {
        onSuccess: async (atm) => {
          toast.success(`ATM ${atm.atmId} created successfully!`);
          await invalidateATMGeographyQueries(false);
          onClose();
        },
        onError: (error) => {
          toast.error(
            isAxiosError<{ message?: string }>(error)
              ? error.response?.data?.message || "ATM creation failed."
              : error.message || "ATM creation failed.",
          );
          console.error("ATM creation failed:", error);
        },
      },
    );
  };

  const onSubmit = (data: CreateATMFormData) => {
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
      {/* select bank */}
      <div>
        <label className="mb-2 block text-sm font-medium">Bank</label>

        <Select
          value={watch("bankId")}
          onValueChange={(value) => {
            if (value) setValue("bankId", value);
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
            {banks.map((bank: { _id: string; bankName: string }) => (
              <SelectItem key={bank._id} value={bank._id}>
                {bank.bankName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.bankId && (
          <p className="mt-1 text-sm text-red-500">{errors.bankId.message}</p>
        )}
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
              {
                customers.find(
                  (customer: { _id: string; customerName: string }) =>
                    customer._id === watch("customerId"),
                )?.customerName
              }
            </SelectValue>
          </SelectTrigger>

          <SelectContent>
            {customers.map(
              (customer: { _id: string; customerName: string }) => (
                <SelectItem key={customer._id} value={customer._id}>
                  {customer.customerName}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        {errors.customerId && (
          <p className="mt-1 text-sm text-red-500">
            {errors.customerId.message}
          </p>
        )}
      </div>
      {/* select district */}
      <div>
        <label className="mb-1 block text-sm font-medium">District</label>

        <Select
          value={watch("districtId")}
          onValueChange={(value) => {
            if (value && value !== selectedDistrictId) {
              setValue("districtId", value);
              setValue("regionId", "");
            }
          }}
          disabled={districtsLoading || districtsError}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select district">
              {
                districts.find((district) => district._id === watch("districtId"))
                  ?.districtName ??
                (initialATM?.districtId?._id === watch("districtId")
                  ? `${initialATM.districtId.districtName} (inactive or unavailable)`
                  : null)
              }
            </SelectValue>
          </SelectTrigger>

          <SelectContent>
            {initialATM?.districtId?._id &&
              !districts.some(
                (district) =>
                  district._id === initialATM.districtId._id &&
                  district.isActive,
              ) && (
                <SelectItem value={initialATM.districtId._id} disabled>
                  {initialATM.districtId.districtName} (inactive or unavailable)
                </SelectItem>
              )}
            {districts
              .filter((district) => district.isActive)
              .map((district) => (
                <SelectItem key={district._id} value={district._id}>
                  {district.districtName}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {errors.districtId && (
          <p className="mt-1 text-sm text-red-500">
            {errors.districtId.message}
          </p>
        )}
      </div>
      {/* select region */}
      <div>
        <label className="mb-1 block text-sm font-medium">Region</label>

        <Select
          value={watch("regionId")}
          onValueChange={(value) => {
            if (value) setValue("regionId", value);
          }}
          disabled={
            !selectedDistrictId ||
            regionsLoading ||
            regionsError ||
            districtsError
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                !selectedDistrictId
                  ? "Select district first"
                  : regionsLoading
                    ? "Loading regions..."
                    : regionsError
                      ? "Regions unavailable"
                      : "Select region"
              }
            >
              {
                selectedRegionId === NO_REGION
                  ? noRegionsLoaded
                  ? "No Region"
                  : initialATM?.regionId
                    ? `${initialATM.regionId.name} (existing assignment)`
                    : "Select region"
                  : regions.find((region) => region._id === selectedRegionId)
                    ?.name ??
                  (initialATM?.regionId?._id === selectedRegionId
                    ? `${initialATM.regionId.name} (inactive or unavailable)`
                    : null)
              }
            </SelectValue>
          </SelectTrigger>

          <SelectContent>
            {activeRegions.map((region) => (
              <SelectItem key={region._id} value={region._id}>
                {region.name}
              </SelectItem>
            ))}
            {initialATM?.regionId?._id === selectedRegionId &&
              !activeRegions.some(
                (region) => region._id === selectedRegionId,
              ) && (
                <SelectItem value={selectedRegionId} disabled>
                  {regions.find((region) => region._id === selectedRegionId)
                    ?.name || initialATM.regionId.name}{" "}
                  (inactive or unavailable)
                </SelectItem>
              )}
            {noRegionsLoaded && (
              <SelectItem value={NO_REGION}>No Region (no active regions)</SelectItem>
            )}
            {selectedRegionId === NO_REGION &&
              activeRegions.length > 0 &&
              !regionsLoading &&
              !regionsError && (
                <SelectItem value={NO_REGION} disabled>
                  No Region (existing assignment; select an active region)
                </SelectItem>
              )}
          </SelectContent>
        </Select>
        {errors.regionId && (
          <p className="mt-1 text-sm text-red-500">{errors.regionId.message}</p>
        )}
      </div>
      {/* select location name */}
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
      {/* assign employee */}
      <div>
        <label className="mb-2 block text-sm font-medium">
          Maintenance Employee
        </label>
        <input
          type="text"
          placeholder="Search employee..."
          value={employeeSearch}
          onChange={(e) => setEmployeeSearch(e.target.value)}
          className="mb-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <Select
          value={watch("assignedEmployeeId")?.[0] || "unassigned"}
          onValueChange={(value) =>
            setValue(
              "assignedEmployeeId",
              value && value !== "unassigned" ? [value] : [],
              { shouldValidate: true },
            )
          }
          disabled={employeesLoading}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an employee">
              {watch("assignedEmployeeId")?.length
                ? filteredEmployees.find(
                    (employee: { _id: string }) =>
                      employee._id === watch("assignedEmployeeId")?.[0],
                  )?.userId?.firstName || "Selected employee"
                : "Not Assigned"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">Not Assigned</SelectItem>
            {employeesLoading ? (
              <SelectItem value="loading" disabled>
                Loading employees...
              </SelectItem>
            ) : (
              filteredEmployees
                .filter(
                  (employee: {
                    status?: string;
                    userId?: { status?: string };
                  }) =>
                    employee.status === "active" &&
                    employee.userId?.status === "active",
                )
                .map(
                  (employee: {
                    _id: string;
                    employeeCode: string;
                    userId: { firstName: string; lastName?: string };
                  }) => (
                    <SelectItem key={employee._id} value={employee._id}>
                      {employee.employeeCode} —{" "}
                      {`${employee.userId?.firstName || ""} ${
                        employee.userId?.lastName || ""
                      }`.trim()}
                    </SelectItem>
                  ),
                )
            )}
          </SelectContent>
        </Select>
        {errors.assignedEmployeeId && (
          <p className="mt-1 text-sm text-red-500">
            {errors.assignedEmployeeId.message}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          One employee is responsible for this ATM’s maintenance.
        </p>
      </div>

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
