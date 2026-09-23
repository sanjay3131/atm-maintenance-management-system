import { useForm } from "react-hook-form";
import type { EmployeeDetailsForm } from "../types/user.types";

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
    formState: { errors },
  } = useForm<EmployeeDetailsForm>({
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Employee Details</h2>

        <p className="mt-1 text-sm text-gray-500">
          Enter the employee-specific information.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Employee Code */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Employee Code
          </label>

          <input
            {...register("employeeCode", {
              required: "Employee code is required",
            })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="EMP001"
          />

          {errors.employeeCode && (
            <p className="mt-1 text-sm text-red-500">
              {errors.employeeCode.message}
            </p>
          )}
        </div>

        {/* Designation */}
        <div>
          <label className="mb-1 block text-sm font-medium">Designation</label>

          <input
            {...register("designation", {
              required: "Designation is required",
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
          className="rounded-md border px-5 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Back
        </button>

        <button
          type="submit"
          className="rounded-md bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Create Employee
        </button>
      </div>
    </form>
  );
}
