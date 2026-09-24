import { useState } from "react";
import { useEmployees } from "@/features/employees/hooks/useEmployees";
import { UserPlus } from "lucide-react";
import CreateUserWizard from "@/features/users/components/CreateUserWizard";
export default function EmployeesPage() {
  const [showCreateUser, setShowCreateUser] = useState(false);
  const { data: employees, isLoading, isError } = useEmployees();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredEmployees = employees?.filter((employee) => {
    const searchText = search.toLowerCase();

    const name =
      `${employee.userId.firstName} ${employee.userId.lastName ?? ""}`.toLowerCase();

    const matchesSearch =
      name.includes(searchText) ||
      employee.employeeCode.toLowerCase().includes(searchText) ||
      employee.designation.toLowerCase().includes(searchText) ||
      employee.department.toLowerCase().includes(searchText) ||
      employee.userId.email.toLowerCase().includes(searchText);

    const matchesStatus =
      statusFilter === "all" || employee.status === statusFilter;

    return matchesSearch && matchesStatus;
  });
  if (isLoading) {
    return <div className="p-6">Loading employees...</div>;
  }

  if (isError) {
    return <div className="p-6 text-red-600">Failed to load employees.</div>;
  }

  return (
    <div className="p-6">
      {showCreateUser && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm p-4">
          <div className="min-h-full py-8">
            <CreateUserWizard onClose={() => setShowCreateUser(false)} />
          </div>
        </div>
      )}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-sm text-gray-500">
            Manage ATM maintenance employees
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateUser(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          <UserPlus className="h-4 w-4" />
          Create User
        </button>

        <div className="flex w-full gap-2 sm:w-auto">
          <input
            type="text"
            placeholder="Search employees..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black sm:w-72"
          />

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="on_leave">On Leave</option>
            <option value="resigned">Resigned</option>
          </select>
        </div>
      </div>

      <div className="rounded-xl border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Designation</th>
                <th className="px-4 py-3 text-left">Department</th>
                <th className="px-4 py-3 text-left">Employment</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">ATMs</th>
              </tr>
            </thead>

            <tbody>
              {filteredEmployees?.map((employee) => (
                <tr key={employee._id} className="border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">
                        {employee.userId.firstName} {employee.userId.lastName}
                      </p>

                      <p className="text-xs text-gray-500">
                        {employee.userId.email}
                      </p>
                    </div>
                  </td>

                  <td className="px-4 py-3 font-medium">
                    {employee.employeeCode}
                  </td>

                  <td className="px-4 py-3">{employee.designation}</td>

                  <td className="px-4 py-3">{employee.department}</td>

                  <td className="px-4 py-3 capitalize">
                    {employee.employmentType}
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        employee.status === "active"
                          ? "bg-green-100 text-green-700"
                          : employee.status === "inactive"
                            ? "bg-gray-100 text-gray-700"
                            : employee.status === "on_leave"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-700"
                      }`}
                    >
                      {employee.status === "on_leave"
                        ? "On Leave"
                        : employee.status.charAt(0).toUpperCase() +
                          employee.status.slice(1)}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    {employee.assignedAtmIds.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredEmployees?.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            No employees found.
          </div>
        )}
      </div>
    </div>
  );
}
