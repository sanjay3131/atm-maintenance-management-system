import type { UserRole } from "../types/user.types";

interface RoleSelectionStepProps {
  value: UserRole | "";
  onNext: (role: UserRole) => void;
  onBack: () => void;
}

const roles: {
  value: UserRole;
  label: string;
  description: string;
}[] = [
  {
    value: "employee",
    label: "Employee",
    description: "Field technician or maintenance employee",
  },
  {
    value: "supervisor",
    label: "Supervisor",
    description: "Supervisor who monitors assigned employees",
  },
  {
    value: "customer",
    label: "Customer",
    description: "Bank or ATM customer account",
  },
];

export default function RoleSelectionStep({
  value,
  onNext,
  onBack,
}: RoleSelectionStepProps) {
  const handleNext = () => {
    if (!value) return;

    onNext(value);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Select Role</h2>

        <p className="mt-1 text-sm text-gray-500">
          Choose what type of user this account belongs to.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {roles.map((role) => {
          const selected = value === role.value;

          return (
            <button
              key={role.value}
              type="button"
              onClick={() => onNext(role.value)}
              className={`rounded-lg border p-5 text-left transition ${
                selected
                  ? "border-black bg-gray-50 ring-2 ring-black"
                  : "hover:border-gray-400"
              }`}
            >
              <h3 className="font-semibold">{role.label}</h3>

              <p className="mt-2 text-sm text-gray-500">{role.description}</p>
            </button>
          );
        })}
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
          type="button"
          onClick={handleNext}
          disabled={!value}
          className="rounded-md bg-black px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
