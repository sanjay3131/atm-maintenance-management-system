import { useForm } from "react-hook-form";
import type { CustomerDetailsForm } from "../types/user.types";

interface CustomerDetailsStepProps {
  defaultValues: CustomerDetailsForm;
  onSubmit: (data: CustomerDetailsForm) => void;
  onBack: () => void;
}

export default function CustomerDetailsStep({
  defaultValues,
  onSubmit,
  onBack,
}: CustomerDetailsStepProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CustomerDetailsForm>({
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Customer Details</h2>

        <p className="mt-1 text-sm text-gray-500">
          Enter the customer-specific information.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Customer Name */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Customer Name
          </label>

          <input
            {...register("customerName", {
              required: "Customer name is required",
              minLength: {
                value: 2,
                message: "Customer name must be at least 2 characters",
              },
            })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Customer name"
          />

          {errors.customerName && (
            <p className="mt-1 text-sm text-red-500">
              {errors.customerName.message}
            </p>
          )}
        </div>

        {/* Customer Email */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Customer Email
          </label>

          <input
            type="email"
            {...register("customerEmail", {
              required: "Customer email is required",
              pattern: {
                value: /^\S+@\S+\.\S+$/,
                message: "Please enter a valid email address",
              },
            })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="customer@example.com"
          />

          {errors.customerEmail && (
            <p className="mt-1 text-sm text-red-500">
              {errors.customerEmail.message}
            </p>
          )}
        </div>

        {/* Customer Phone */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Customer Phone
          </label>

          <input
            type="tel"
            {...register("customerPhone", {
              required: "Customer phone is required",
              minLength: {
                value: 10,
                message: "Phone number must be at least 10 digits",
              },
            })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="9876543210"
          />

          {errors.customerPhone && (
            <p className="mt-1 text-sm text-red-500">
              {errors.customerPhone.message}
            </p>
          )}
        </div>

        {/* Bank Name */}
        <div>
          <label className="mb-1 block text-sm font-medium">Bank Name</label>

          <input
            {...register("bankName", {
              required: "Bank name is required",
            })}
            className="w-full rounded-md border px-3 py-2"
            placeholder=" Eg : Karur Vysya Bank"
          />
          {errors.bankName && (
            <p className="mt-1 text-sm text-red-500">
              {errors.bankName.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={isSubmitting}
          className="rounded-md border px-5 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Back
        </button>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "Creating..." : "Create Customer"}
        </button>
      </div>
    </form>
  );
}
