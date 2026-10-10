import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Pencil, RefreshCw, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { useEmployees } from "@/features/employees/hooks/useEmployees";
import CreateUserWizard from "@/features/users/components/CreateUserWizard";
import type { Employee } from "@/services/employee.service";

const PAGE_SIZES = [10, 25, 50, 100];

const STATUS_OPTIONS: Array<{
  value: Employee["status"] | "all";
  label: string;
}> = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "on_leave", label: "On Leave" },
  { value: "resigned", label: "Resigned" },
];

function getEmployeeName(employee: Employee) {
  return (
    [employee.userId?.firstName, employee.userId?.lastName]
      .filter(Boolean)
      .join(" ") || "Name unavailable"
  );
}

function getStatusClass(status: Employee["status"]) {
  if (status === "active") return "bg-green-100 text-green-700";
  if (status === "inactive") return "bg-gray-100 text-gray-700";
  if (status === "on_leave") return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}

function getStatusLabel(status: Employee["status"]) {
  return status === "on_leave"
    ? "On Leave"
    : status.charAt(0).toUpperCase() + status.slice(1);
}

function getSearchText(employee: Employee) {
  return [
    getEmployeeName(employee),
    employee.employeeCode,
    employee.designation,
    employee.department,
    employee.userId?.email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Failed to load employees.";
}

function LoadingState() {
  return (
    <div className="space-y-4 p-4 sm:p-6" role="status">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="h-16 animate-pulse rounded-lg border bg-muted/40" />
      <div className="h-72 animate-pulse rounded-lg border bg-muted/40" />
      <p className="sr-only">Loading employees...</p>
    </div>
  );
}

export default function EmployeesPage() {
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<Employee["status"] | "all">("all");
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const employeesQuery = useEmployees();
  const employees = employeesQuery.data ?? [];

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredEmployees = employees.filter((employee) => {
    const matchesSearch =
      normalizedSearch === "" || getSearchText(employee).includes(normalizedSearch);
    const matchesStatus =
      statusFilter === "all" || employee.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleEmployees = filteredEmployees.slice(pageStart, pageStart + pageSize);
  const firstVisible = filteredEmployees.length === 0 ? 0 : pageStart + 1;
  const lastVisible = Math.min(pageStart + pageSize, filteredEmployees.length);

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const updateStatusFilter = (value: Employee["status"] | "all") => {
    setStatusFilter(value);
    setPage(1);
  };

  const updatePageSize = (value: number) => {
    setPageSize(value);
    setPage(1);
  };

  if (employeesQuery.isLoading) {
    return <LoadingState />;
  }

  if (employeesQuery.isError) {
    return (
      <main className="space-y-6 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-sm text-muted-foreground">
            Manage ATM maintenance employees
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div role="alert">
              <p className="font-medium text-destructive">
                Failed to load employees.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {getErrorMessage(employeesQuery.error)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void employeesQuery.refetch()}
              disabled={employeesQuery.isFetching}
            >
              <RefreshCw
                className={employeesQuery.isFetching ? "animate-spin" : ""}
              />
              {employeesQuery.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="space-y-6 p-4 sm:p-6">
      {showCreateUser && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 backdrop-blur-sm">
          <div className="min-h-full py-8">
            <CreateUserWizard onClose={() => setShowCreateUser(false)} />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-sm text-muted-foreground">
            Manage ATM maintenance employees
          </p>
        </div>
        <Button type="button" onClick={() => setShowCreateUser(true)}>
          <UserPlus />
          Create User
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="employee-search"
                className="mb-1 block text-sm font-medium"
              >
                Search employees
              </label>
              <input
                id="employee-search"
                type="search"
                placeholder="Name, code, designation, department, or email"
                value={search}
                onChange={(event) => updateSearch(event.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            <div>
              <label
                htmlFor="employee-status-filter"
                className="mb-1 block text-sm font-medium"
              >
                Employee work status
              </label>
              <select
                id="employee-status-filter"
                value={statusFilter}
                onChange={(event) =>
                  updateStatusFilter(
                    event.target.value as Employee["status"] | "all",
                  )
                }
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="employee-page-size" className="text-sm font-medium">
              Rows per page
            </label>
            <select
              id="employee-page-size"
              value={pageSize}
              onChange={(event) => updatePageSize(Number(event.target.value))}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Employee records, filtered by Employee work status and search
            </caption>
            <thead className="border-b bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Employee</th>
                <th scope="col" className="px-4 py-3 text-left">Code</th>
                <th scope="col" className="px-4 py-3 text-left">Designation</th>
                <th scope="col" className="px-4 py-3 text-left">Department</th>
                <th scope="col" className="px-4 py-3 text-left">Employment</th>
                <th scope="col" className="px-4 py-3 text-left">Employee status</th>
                <th scope="col" className="px-4 py-3 text-left">ATMs</th>
                <th scope="col" className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map((employee) => {
                const detailsPath = `/admin/employees/${employee._id}`;
                const employeeName = getEmployeeName(employee);
                return (
                  <tr key={employee._id} className="border-b last:border-b-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{employeeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {employee.userId?.email ?? "Email unavailable"}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {employee.employeeCode}
                    </td>
                    <td className="px-4 py-3">{employee.designation}</td>
                    <td className="px-4 py-3">{employee.department}</td>
                    <td className="px-4 py-3">{employee.employmentType}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClass(employee.status)}`}
                      >
                        {getStatusLabel(employee.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {employee.assignedAtmIds?.length ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          render={<Link to={detailsPath} />}
                          aria-label={`View ${employeeName}`}
                        >
                          <Eye />
                          <span className="hidden lg:inline">View</span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          render={<Link to={`${detailsPath}?edit=true`} />}
                          aria-label={`Edit ${employeeName}`}
                        >
                          <Pencil />
                          <span className="hidden lg:inline">Edit</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredEmployees.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {employees.length === 0
              ? "No employees have been created yet."
              : "No employees match the current search and status filters."}
          </div>
        ) : (
          <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Showing {firstVisible}–{lastVisible} of {filteredEmployees.length}
              {filteredEmployees.length !== employees.length
                ? ` filtered from ${employees.length} employees`
                : " employees"}
            </p>
            <nav
              aria-label="Employee list pagination"
              className="flex flex-wrap items-center gap-2"
            >
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
              >
                Previous
              </Button>
              <span className="px-2 text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
              </Button>
            </nav>
          </div>
        )}
      </Card>
    </main>
  );
}
