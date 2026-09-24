import { useState } from "react";
import UserDetailsStep from "./UserDetailsStep";
import RoleSelectionStep from "./RoleSelectionStep";
import EmployeeDetailsStep from "./EmployeeDetailsStep";
import CustomerDetailsStep from "./CustomerDetailsStep";
import { useCreateUserWizard } from "../hooks/user.hooks";
import { useQueryClient } from "@tanstack/react-query";

import type {
  UserRole,
  UserDetailsForm,
  EmployeeDetailsForm,
  CustomerDetailsForm,
} from "../types/user.types";

const initialUserDetails: UserDetailsForm = {
  firstName: "",
  lastName: "",
  email: "",
  phoneNumber: "",
  password: "",
};

const initialEmployeeDetails: EmployeeDetailsForm = {
  designation: "",
  department: "",
  joiningDate: "",
  employmentType: "full-time",
  districtIds: [],
  assignedAtmIds: [],
  regionIds: [],
  salary: undefined,
};

const initialCustomerDetails: CustomerDetailsForm = {
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  bankName: "",
  atmIds: [],
  districtIds: [],
};

export default function CreateUserWizard({
  onClose,
}: {
  onClose?: () => void;
}) {
  const createUserMutation = useCreateUserWizard();
  const queryClient = useQueryClient();
  const handleCreateSuccess = () => {
    alert("User created successfully!");
    queryClient.invalidateQueries({ queryKey: ["employees"] });
    setStep(1);
    setUserDetails(initialUserDetails);
    setRole("");
    setEmployeeDetails(initialEmployeeDetails);
    setCustomerDetails(initialCustomerDetails);

    onClose?.();
  };

  const handleCreateError = (error: Error) => {
    alert(error.message || "Failed to create user");
  };
  const [step, setStep] = useState(1);

  const [userDetails, setUserDetails] =
    useState<UserDetailsForm>(initialUserDetails);

  const [role, setRole] = useState<UserRole | "">("");

  const [employeeDetails, setEmployeeDetails] = useState<EmployeeDetailsForm>(
    initialEmployeeDetails,
  );

  const [customerDetails, setCustomerDetails] = useState<CustomerDetailsForm>(
    initialCustomerDetails,
  );

  const handleUserDetailsNext = (data: UserDetailsForm) => {
    setUserDetails(data);
    setStep(2);
  };

  const handleRoleNext = (selectedRole: UserRole) => {
    setRole(selectedRole);
    setStep(3);
  };

  const handleEmployeeSubmit = (data: EmployeeDetailsForm) => {
    setEmployeeDetails(data);

    createUserMutation.mutate(
      {
        user: userDetails,
        role: "employee",
        employee: data,
      },
      {
        onSuccess: handleCreateSuccess,
        onError: handleCreateError,
      },
    );
  };

  const handleCustomerSubmit = (data: CustomerDetailsForm) => {
    setCustomerDetails(data);

    createUserMutation.mutate(
      {
        user: userDetails,
        role: "customer",
        customer: data,
      },
      {
        onSuccess: handleCreateSuccess,
        onError: handleCreateError,
      },
    );
  };

  return (
    <div className="relative mx-auto w-fit rounded-xl border bg-white p-6 shadow-sm">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-0 rounded-md px-2 py-1 text-sm font-bold text-gray-500  hover:bg-gray-100 hover:text-gray-900"
        >
          ✕
        </button>
      )}
      {/* Step indicator */}
      <div className="mb-8 flex items-center justify-between ">
        {[1, 2, 3].map((item) => (
          <div key={item} className="flex items-center ">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
                step >= item
                  ? "bg-black text-white"
                  : "bg-gray-200 text-gray-500"
              }`}
            >
              {item}
            </div>

            {item !== 3 && (
              <div
                className={`mx-2 h-1 w-24 ${
                  step > item ? "bg-black" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <UserDetailsStep
          defaultValues={userDetails}
          onNext={handleUserDetailsNext}
        />
      )}

      {/* Step 2 */}
      {step === 2 && (
        <RoleSelectionStep
          value={role}
          onNext={handleRoleNext}
          onBack={() => setStep(1)}
        />
      )}

      {/* Step 3 - Employee */}
      {step === 3 && role === "employee" && (
        <EmployeeDetailsStep
          defaultValues={employeeDetails}
          onSubmit={handleEmployeeSubmit}
          onBack={() => setStep(2)}
        />
      )}

      {/* Step 3 - Customer */}
      {step === 3 && role === "customer" && (
        <CustomerDetailsStep
          defaultValues={customerDetails}
          onSubmit={handleCustomerSubmit}
          onBack={() => setStep(2)}
        />
      )}

      {/* Step 3 - Supervisor */}
      {step === 3 && role === "supervisor" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold">Supervisor</h2>

            <p className="mt-1 text-sm text-gray-500">
              No additional supervisor details are required.
            </p>
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-md border px-5 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Back
            </button>

            <button
              type="button"
              onClick={() => {
                createUserMutation.mutate(
                  {
                    user: userDetails,
                    role: "supervisor",
                  },
                  {
                    onSuccess: handleCreateSuccess,
                    onError: handleCreateError,
                  },
                );
              }}
              className="rounded-md bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Create Supervisor
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
