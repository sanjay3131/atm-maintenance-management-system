import { useForm } from "react-hook-form";
import type { UserDetailsForm } from "../types/user.types";

interface UserDetailsStepProps {
  defaultValues: UserDetailsForm;
  onNext: (data: UserDetailsForm) => void;
}

export default function UserDetailsStep({
  defaultValues,
  onNext,
}: UserDetailsStepProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UserDetailsForm>({
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">User Details</h2>

        <p className="mt-1 text-sm text-gray-500">
          Enter the common details for this user.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* First Name */}
        <div>
          <label className="mb-1 block text-sm font-medium">First Name</label>

          <input
            {...register("firstName", {
              required: "First name is required",
            })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Enter first name"
          />

          {errors.firstName && (
            <p className="mt-1 text-sm text-red-500">
              {errors.firstName.message}
            </p>
          )}
        </div>

        {/* Last Name */}
        <div>
          <label className="mb-1 block text-sm font-medium">Last Name</label>

          <input
            {...register("lastName")}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Enter last name"
          />
        </div>

        {/* Email */}
        <div>
          <label className="mb-1 block text-sm font-medium">Email</label>

          <input
            type="email"
            {...register("email", {
              required: "Email is required",
            })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Enter email"
          />

          {errors.email && (
            <p className="mt-1 text-sm text-red-500">{errors.email.message}</p>
          )}
        </div>

        {/* Phone */}
        <div>
          <label className="mb-1 block text-sm font-medium">Phone Number</label>

          <input
            type="tel"
            {...register("phoneNumber", {
              required: "Phone number is required",
            })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Enter phone number"
          />

          {errors.phoneNumber && (
            <p className="mt-1 text-sm text-red-500">
              {errors.phoneNumber.message}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-medium">Password</label>

          <input
            type="password"
            {...register("password", {
              required: "Password is required",
              minLength: {
                value: 8,
                message: "Password must be at least 8 characters",
              },
            })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Enter password"
          />

          {errors.password && (
            <p className="mt-1 text-sm text-red-500">
              {errors.password.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded-md bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Next
        </button>
      </div>
    </form>
  );
}
