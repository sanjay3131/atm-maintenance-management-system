import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createATMFormSchema,
  type CreateATMFormData,
} from "../types/create-atm.schema";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";
import { useRegionsByDistrict } from "@/features/users/hooks/useRegionsByDistrict";
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

interface CreateATMFormProps {
  onClose: () => void;
  initialATM?: ATM;
}

export default function CreateATMForm({
  onClose,
  initialATM,
}: CreateATMFormProps) {
  const [employeeSearch, setEmployeeSearch] = useState("");
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
  const { data: districts = [], isLoading: districtsLoading } = useQuery({
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
      regionId: initialATM.regionId?._id ?? "",
      locationName: initialATM.locationName,
      address: initialATM.address,
      installationType: initialATM.installationType,
      status: initialATM.status,
      assignedEmployeeId: [],
    });
  }, [initialATM, reset]);

  const selectedDistrictId = watch("districtId");

  const { data: regions = [], isLoading: regionsLoading } =
    useRegionsByDistrict(selectedDistrictId);
  // on submit function
  const onSubmit = (data: CreateATMFormData) => {
    if (initialATM) {
      const updateData: UpdateATMData = {
        customerId: data.customerId,
        bankId: data.bankId,
        districtId: data.districtId,
        regionId: data.regionId,
        locationName: data.locationName,
        address: data.address,
        installationType: data.installationType,
        status: data.status,
      };

      updateATM.mutate(
        { atmId: initialATM._id, data: updateData },
        {
          onSuccess: () => {
            toast.success(`ATM ${initialATM.atmId} updated successfully!`);
            queryClient.invalidateQueries({ queryKey: ["atms"] });
            queryClient.invalidateQueries({
              queryKey: ["atm", initialATM._id],
            });
            onClose();
          },
          onError: (error) => {
            toast.error("ATM update failed!");
            console.error("ATM update failed:", error);
          },
        },
      );
      return;
    }

    createATM.mutate(data, {
      onSuccess: (atm) => {
        toast.success(`ATM ${atm.atmId} created successfully!`);

        queryClient.invalidateQueries({
          queryKey: ["atms"],
        });

        onClose();
      },
      onError: (error) => {
        toast.error("ATM creation failed!");
        console.error("ATM creation failed:", error);
      },
    });
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
            if (value) {
              setValue("districtId", value);
              setValue("regionId", "");
            }
          }}
          disabled={districtsLoading}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select district">
              {
                districts.find(
                  (district: { _id: string; districtName: string }) =>
                    district._id === watch("districtId"),
                )?.districtName
              }
            </SelectValue>
          </SelectTrigger>

          <SelectContent>
            {districts.map(
              (district: { _id: string; districtName: string }) => (
                <SelectItem key={district._id} value={district._id}>
                  {district.districtName}
                </SelectItem>
              ),
            )}
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
          disabled={!selectedDistrictId || regionsLoading}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                !selectedDistrictId
                  ? "Select district first"
                  : regionsLoading
                    ? "Loading regions..."
                    : "Select region"
              }
            >
              {
                regions.find(
                  (region: { _id: string; name: string }) =>
                    region._id === watch("regionId"),
                )?.name
              }
            </SelectValue>
          </SelectTrigger>

          <SelectContent>
            {regions.map((region: { _id: string; name: string }) => (
              <SelectItem key={region._id} value={region._id}>
                {region.name}
              </SelectItem>
            ))}
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
      {!initialATM && (
        <div>
          <label className="mb-2 block text-sm font-medium">
            Assign Employees
          </label>
          <p className="mb-2 text-xs text-muted-foreground">
            {watch("assignedEmployeeId")?.length || 0} employee(s) selected
          </p>
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
            ) : filteredEmployees.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No employees found
              </p>
            ) : (
              filteredEmployees.map(
                (employee: {
                  _id: string;
                  employeeCode: string;
                  userId: {
                    firstName: string;
                    lastName?: string;
                  };
                }) => {
                  const firstName = employee.userId?.firstName || "";
                  const lastName = employee.userId?.lastName || "";

                  const fullName = `${firstName} ${lastName}`.trim();

                  const initials = lastName
                    ? `${firstName.charAt(0)}${lastName.charAt(0)}`
                    : firstName.charAt(0);

                  const displayInitials = initials.toUpperCase() || "E";
                  return (
                    <label
                      key={employee._id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        value={employee._id}
                        {...register("assignedEmployeeId")}
                        className="h-4 w-4"
                      />

                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {displayInitials}{" "}
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {fullName || "Unknown Employee"}
                        </p>

                        <p className="text-xs text-muted-foreground">
                          {employee.employeeCode}
                        </p>
                      </div>
                    </label>
                  );
                },
              )
            )}
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            Select one or more employees to assign this ATM.
          </p>
        </div>
      )}

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
    </form>
  );
}
