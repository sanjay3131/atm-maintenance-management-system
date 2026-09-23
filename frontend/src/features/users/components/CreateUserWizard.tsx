import { useState } from "react";
import UserDetailsStep from "./UserDetailsStep";
import RoleSelectionStep from "./RoleSelectionStep";
import EmployeeDetailsStep from "./EmployeeDetailsStep";
import CustomerDetailsStep from "./CustomerDetailsStep";

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
  employeeCode: "",
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

export default function CreateUserWizard() {
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

    console.log("USER:", userDetails);
    console.log("ROLE:", role);
    console.log("EMPLOYEE:", data);
  };

  const handleCustomerSubmit = (data: CustomerDetailsForm) => {
    setCustomerDetails(data);

    console.log("USER:", userDetails);
    console.log("ROLE:", role);
    console.log("CUSTOMER:", data);
  };

  return (
    <div className="mx-auto max-w-4xl rounded-xl border bg-white p-6 shadow-sm">
      {/* Step indicator */}
      <div className="mb-8 flex items-center justify-between">
        {[1, 2, 3].map((item) => (
          <div key={item} className="flex items-center">
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
                className={`mx-2 h-1 w-16 ${
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
                console.log("USER:", userDetails);
                console.log("ROLE:", role);
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
