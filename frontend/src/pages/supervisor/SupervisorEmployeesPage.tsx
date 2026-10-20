import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonBlock } from "@/features/dashboard/components/DashboardSkeleton";
import { useSupervisorEmployees } from "@/features/supervisor/hooks/useSupervisorEmployees";
import type { SupervisorEmployeeSummary } from "@/services/supervisor.service";

const PAGE_SIZE = 20;

const formatStatus = (status: string | null | undefined) => {
  if (!status) return "Status unavailable";
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const statusVariant = (status: string | null | undefined) => {
  if (status === "active") return "secondary" as const;
  if (status === "resigned") return "destructive" as const;
  return "outline" as const;
};

const fullName = (employee: SupervisorEmployeeSummary) =>
  employee.name?.trim() ||
  [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim() ||
  "Name unavailable";

const getErrorMessage = (error: unknown) =>
  isAxiosError<{ message?: string }>(error)
    ? error.response?.data?.message ||
      "The employee list could not be loaded. Please try again."
    : error instanceof Error
      ? error.message
      : "The employee list could not be loaded. Please try again.";

function EmployeeListSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading employees">
      {Array.from({ length: 5 }, (_, index) => (
        <SkeletonBlock key={index} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

function EmployeeStatus({ status }: { status?: string | null }) {
  return <Badge variant={statusVariant(status)}>{formatStatus(status)}</Badge>;
}

function EmployeeCard({ employee }: { employee: SupervisorEmployeeSummary }) {
  const name = fullName(employee);
  const atms = employee.assignedAtms ?? [];

  return (
    <Card className="border-slate-200 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-sm font-bold text-blue-800">
            {(name.charAt(0) || "E").toLocaleUpperCase()}
          </span>
          <div className="min-w-0">
            <Link
              to={`/supervisor/employees/${employee._id}`}
              className="font-semibold text-slate-900 hover:text-blue-800 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {name}
            </Link>
            <p className="mt-0.5 text-sm text-slate-500">
              {employee.employeeCode || "Employee code unavailable"}
              {employee.designation ? ` · ${employee.designation}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <EmployeeStatus status={employee.status} />
              {employee.department && (
                <span className="text-xs text-slate-500">
                  {employee.department}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <p className="text-sm text-slate-600">
            {atms.length} assigned {atms.length === 1 ? "ATM" : "ATMs"}
          </p>
          <Link
            to={`/supervisor/employees/${employee._id}`}
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "min-h-10",
            })}
          >
            View details
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SupervisorEmployeesPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const employeesQuery = useSupervisorEmployees({
    page,
    limit: PAGE_SIZE,
    ...(search ? { search } : {}),
  });
  const employees = employeesQuery.isFetchedAfterMount
    ? employeesQuery.data?.employees
    : undefined;
  const pagination = employeesQuery.isFetchedAfterMount
    ? employeesQuery.data?.pagination
    : undefined;
  const noEmployees = pagination?.total === 0 && !search;
  const noMatches = pagination?.total === 0 && Boolean(search);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
            Team
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Assigned employees
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Employees currently assigned to you, with their team status and ATM
            coverage.
          </p>
        </div>
        {pagination && (
          <p className="text-sm font-medium text-slate-600">
            {pagination.total.toLocaleString("en-IN")}{" "}
            {pagination.total === 1 ? "employee" : "employees"}
          </p>
        )}
      </header>

      <div className="relative max-w-xl">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search name, employee code, or email"
          aria-label="Search assigned employees"
          className="min-h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {(employeesQuery.isLoading ||
        (!employeesQuery.isFetchedAfterMount && employeesQuery.isFetching)) && (
        <EmployeeListSkeleton />
      )}

      {employeesQuery.isError && (
        <Card className="border-rose-200">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div role="alert">
              <p className="font-semibold text-rose-800">
                Could not load assigned employees
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {getErrorMessage(employeesQuery.error)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void employeesQuery.refetch()}
              disabled={employeesQuery.isFetching}
              className="min-h-11 shrink-0"
            >
              {employeesQuery.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      )}

      {employees && employees.length > 0 && (
        <section aria-label="Assigned employees" className="space-y-3">
          {employees.map((employee) => (
            <EmployeeCard key={employee._id} employee={employee} />
          ))}
        </section>
      )}

      {noEmployees && (
        <Card>
          <CardContent className="flex flex-col items-center px-5 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-700">
              <Users className="size-6" aria-hidden="true" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">
              No employees assigned yet
            </h3>
            <p className="mt-1 max-w-md text-sm text-slate-600">
              Employees assigned to you will appear here.
            </p>
          </CardContent>
        </Card>
      )}

      {noMatches && (
        <Card>
          <CardContent className="px-5 py-10 text-center">
            <h3 className="font-semibold text-slate-900">
              No employees match this search
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Try a different name, employee code, or email address.
            </p>
          </CardContent>
        </Card>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1 || employeesQuery.isFetching}
              className="min-h-11 flex-1 sm:flex-none"
            >
              <ChevronLeft aria-hidden="true" />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setPage(Math.min(pagination.totalPages, page + 1))
              }
              disabled={
                page >= pagination.totalPages || employeesQuery.isFetching
              }
              className="min-h-11 flex-1 sm:flex-none"
            >
              Next
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {employeesQuery.isFetching && employees && (
        <p className="sr-only" role="status" aria-live="polite">
          Updating employee list
        </p>
      )}
    </div>
  );
}
