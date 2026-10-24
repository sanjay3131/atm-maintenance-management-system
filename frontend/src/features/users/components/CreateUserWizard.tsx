import { useState } from "react";
import { useBanks } from "@/features/banks/hooks/useBanks";
import UserDetailsStep from "./UserDetailsStep";
import RoleSelectionStep from "./RoleSelectionStep";
import EmployeeDetailsStep from "./EmployeeDetailsStep";
import CustomerDetailsStep from "./CustomerDetailsStep";
import {
  useCreateSupervisor,
  useCreateCustomerWizard,
  useCreateUserWizard,
} from "../hooks/user.hooks";
import {
  createCustomerWizardPayload,
  getCustomerWizardSteps,
  prefillCustomerDetails,
  type CustomerEditedFields,
  type CustomerIdentityField,
} from "../utils/customerWizard";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
  supervisorId: null,
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
  customerOnly = false,
  fixedRole,
}: {
  onClose?: () => void;
  customerOnly?: boolean;
  fixedRole?: "supervisor";
}) {
  const createUserMutation = useCreateUserWizard();
  const createCustomerMutation = useCreateCustomerWizard();
  const createSupervisorMutation = useCreateSupervisor();
  const { data: banks = [], isLoading: isBanksLoading, isError: isBanksError, refetch: refetchBanks } =
    useBanks({ isActive: true });
  const queryClient = useQueryClient();
  const handleCreateSuccess = () => {
    toast.success("User created successfully!");
    queryClient.invalidateQueries({ queryKey: ["employees"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["users"] });
    setStep(1);
    setUserDetails(initialUserDetails);
    setRole("");
    setEmployeeDetails(initialEmployeeDetails);
    setCustomerDetails(initialCustomerDetails);
    setCustomerEditedFields({});

    onClose?.();
  };

  const handleCreateError = (error: Error) => {
    toast.error(error.message || "Failed to create user");
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
  const [customerEditedFields, setCustomerEditedFields] =
    useState<CustomerEditedFields>({});

  const handleUserDetailsNext = (data: UserDetailsForm) => {
    setUserDetails(data);
    if (fixedRole) {
      setRole(fixedRole);
      setStep(2);
      return;
    }
    if (customerOnly) {
      setCustomerDetails((current) =>
        prefillCustomerDetails(data, current, customerEditedFields),
      );
    }
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

    if (customerOnly) {
      createCustomerMutation.mutate(
        createCustomerWizardPayload(userDetails, data),
        {
          onSuccess: handleCreateSuccess,
          onError: handleCreateError,
        },
      );
    } else {
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
    }
  };

  const handleCustomerFieldChange = (
    field: CustomerIdentityField,
    value: string,
  ) => {
    setCustomerDetails((current) => ({ ...current, [field]: value }));
    setCustomerEditedFields((current) =>
      current[field] ? current : { ...current, [field]: true },
    );
  };

  const visibleSteps = fixedRole
    ? [1, 2]
    : getCustomerWizardSteps(customerOnly);

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
        {visibleSteps.map((item, index) => (
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

            {index < visibleSteps.length - 1 && (
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
          {...(customerOnly
            ? {
                customerBank: {
                  value: customerDetails.bankName,
                  banks,
                  isLoading: isBanksLoading,
                  isError: isBanksError,
                  onChange: (value: string) => {
                    setCustomerDetails((current) => ({
                      ...current,
                      bankName: value,
                    }));
                  },
                  onRetry: () => void refetchBanks(),
                },
              }
            : {})}
        />
      )}

      {/* Step 2 */}
      {!customerOnly && !fixedRole && step === 2 && (
        <RoleSelectionStep
          value={role}
          onNext={handleRoleNext}
          onBack={() => setStep(1)}
        />
      )}

      {/* Step 3 - Employee */}
      {!customerOnly && step === 3 && role === "employee" && (
        <EmployeeDetailsStep
          defaultValues={employeeDetails}
          onSubmit={handleEmployeeSubmit}
          onBack={() => setStep(2)}
        />
      )}

      {/* Step 3 - Customer */}
      {((customerOnly && step === 2) ||
        (!customerOnly && step === 3 && role === "customer")) && (
        <CustomerDetailsStep
          defaultValues={customerDetails}
          onSubmit={handleCustomerSubmit}
          onBack={() => setStep(customerOnly ? 1 : 2)}
          onFieldChange={handleCustomerFieldChange}
          banks={banks}
          isBanksLoading={isBanksLoading}
          isBanksError={isBanksError}
          onRetryBanks={() => void refetchBanks()}
          isCreating={
            customerOnly
              ? createCustomerMutation.isPending
              : createUserMutation.isPending
          }
        />
      )}

      {/* Step 3 - Supervisor */}
      {!customerOnly &&
        step === (fixedRole ? 2 : 3) &&
        role === "supervisor" && (
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
              onClick={() => setStep(fixedRole ? 1 : 2)}
              className="rounded-md border px-5 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Back
            </button>

            <button
              type="button"
              onClick={() => {
                if (fixedRole === "supervisor") {
                  createSupervisorMutation.mutate(userDetails, {
                    onSuccess: handleCreateSuccess,
                    onError: handleCreateError,
                  });
                } else {
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
                }
              }}
              disabled={
                createSupervisorMutation.isPending ||
                createUserMutation.isPending
              }
              className="rounded-md bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              {createSupervisorMutation.isPending || createUserMutation.isPending
                ? "Creating..."
                : "Create Supervisor"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
