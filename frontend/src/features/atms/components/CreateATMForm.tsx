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

interface CreateATMFormProps {
  onClose: () => void;
}

export default function CreateATMForm({ onClose }: CreateATMFormProps) {
  const queryClient = useQueryClient();
  const createATM = useCreateATM();
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
    formState: { errors },
  } = useForm<CreateATMFormData>({
    resolver: zodResolver(createATMFormSchema),
    defaultValues: {
      installationType: "ONSITE",
      status: "ACTIVE",
      assignedEmployeeId: [],
    },
  });
  const selectedDistrictId = watch("districtId");

  const { data: regions = [], isLoading: regionsLoading } =
    useRegionsByDistrict(selectedDistrictId);
  // on submit function
  const onSubmit = (data: CreateATMFormData) => {
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
      {/* select bank */}
      <div>
        <label className="mb-1 block text-sm font-medium">Bank</label>

        <select
          {...register("bankId")}
          className="w-full rounded-md border px-3 py-2"
          disabled={banksLoading}
        >
          <option value="">
            {banksLoading ? "Loading banks..." : "Select bank"}
          </option>

          {banks.map((bank: { _id: string; bankName: string }) => (
            <option key={bank._id} value={bank._id}>
              {bank.bankName}
            </option>
          ))}
        </select>
      </div>
      {/* select customer */}
      <div>
        <label className="mb-1 block text-sm font-medium">Customer</label>

        <select
          {...register("customerId")}
          className="w-full rounded-md border px-3 py-2"
          disabled={customersLoading}
        >
          <option value="">
            {customersLoading ? "Loading customers..." : "Select customer"}
          </option>

          {customers.map((customer: { _id: string; customerName: string }) => (
            <option key={customer._id} value={customer._id}>
              {customer.customerName}
            </option>
          ))}
        </select>
      </div>
      {/* select district */}
      <div>
        <label className="mb-1 block text-sm font-medium">District</label>

        <select
          {...register("districtId")}
          className="w-full rounded-md border px-3 py-2"
          disabled={districtsLoading}
        >
          <option value="">
            {districtsLoading ? "Loading districts..." : "Select district"}
          </option>

          {districts.map((district: { _id: string; districtName: string }) => (
            <option key={district._id} value={district._id}>
              {district.districtName}
            </option>
          ))}
        </select>
      </div>
      {/* select region */}
      <div>
        <label className="mb-1 block text-sm font-medium">Region</label>

        <select
          {...register("regionId")}
          className="w-full rounded-md border px-3 py-2"
          disabled={!selectedDistrictId || regionsLoading}
        >
          <option value="">
            {!selectedDistrictId
              ? "Select district first"
              : regionsLoading
                ? "Loading regions..."
                : "Select region"}
          </option>

          {regions.map((region: { _id: string; name: string }) => (
            <option key={region._id} value={region._id}>
              {region.name}
            </option>
          ))}
        </select>
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

        <select
          {...register("installationType")}
          className="w-full rounded-md border px-3 py-2"
        >
          <option value="ONSITE">ONSITE</option>
          <option value="OFFSITE">OFFSITE</option>
        </select>

        {errors.installationType && (
          <p className="mt-1 text-sm text-red-500">
            {errors.installationType.message}
          </p>
        )}
      </div>
      {/* status */}
      <div>
        <label className="mb-1 block text-sm font-medium">Status</label>

        <select
          {...register("status")}
          className="w-full rounded-md border px-3 py-2"
        >
          <option value="ACTIVE">ACTIVE</option>
          <option value="INACTIVE">INACTIVE</option>
          <option value="UNDER_MAINTENANCE">UNDER MAINTENANCE</option>
          <option value="REMOVED">REMOVED</option>
        </select>

        {errors.status && (
          <p className="mt-1 text-sm text-red-500">{errors.status.message}</p>
        )}
      </div>
      {/* assign employee */}
      <div>
        <label className="mb-1 block text-sm font-medium">
          Assign Employees
        </label>

        <select
          multiple
          {...register("assignedEmployeeId")}
          className="w-full rounded-md border px-3 py-2"
          disabled={employeesLoading}
        >
          {employees.map((employee: { _id: string; employeeCode: string }) => (
            <option key={employee._id} value={employee._id}>
              {employee.employeeCode}
            </option>
          ))}
        </select>

        <p className="mt-1 text-xs text-muted-foreground">
          Hold Ctrl (Windows/Linux) or Cmd (Mac) to select multiple employees.
        </p>
      </div>

      {/* submit button */}
      <button
        type="submit"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        {createATM.isPending ? "Creating..." : "Create ATM"}
      </button>
    </form>
  );
}
