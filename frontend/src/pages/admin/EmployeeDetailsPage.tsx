import { useState } from "react";
import { isAxiosError } from "axios";
import { ArrowLeft, Pencil, RefreshCw } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import EmployeeEditForm from "@/features/employees/components/EmployeeEditForm";
import { useEmployee } from "@/features/employees/hooks/useEmployee";
import EmployeePerformance from "@/features/dashboard/components/EmployeePerformance";
import EmployeeAttendanceCalendar from "@/features/attendance/components/EmployeeAttendanceCalendar";
import { useJobs } from "@/features/jobs/hooks/useJobs";

const JOBS_PAGE_LIMIT = 10;

function formatDate(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function formatStatus(status: string) {
  return status === "on_leave"
    ? "On Leave"
    : status.charAt(0).toUpperCase() + status.slice(1);
}

function formatJobStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getStatusVariant(status: string) {
  if (status === "active") return "secondary" as const;
  if (status === "resigned") return "destructive" as const;
  return "outline" as const;
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return (
      error.response?.data?.message ||
      "The employee request could not be completed."
    );
  }
  return error instanceof Error
    ? error.message
    : "The employee request could not be completed.";
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-all text-sm font-medium sm:max-w-[65%] sm:text-right">
        {value}
      </dd>
    </div>
  );
}

function DetailList({
  label,
  values,
}: {
  label: string;
  values: string[];
}) {
  return (
    <div className="border-b py-3 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-2">
        {values.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label={label}>
            {values.map((value) => (
              <li
                key={value}
                className="max-w-full break-all rounded-md bg-muted px-2 py-1 text-xs font-medium"
              >
                {value}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-sm font-medium">None assigned</span>
        )}
      </dd>
    </div>
  );
}

function assignmentNames(
  values: Array<
    | string
    | { districtName?: string; name?: string; atmId?: string }
    | null
  >,
  getName: (value: { districtName?: string; name?: string; atmId?: string }) =>
    | string
    | undefined,
  unavailableLabel: string,
) {
  return values.map((value) =>
    value && typeof value !== "string"
      ? getName(value) || unavailableLabel
      : unavailableLabel,
  );
}

function DetailsSkeleton() {
  return (
    <div className="space-y-6 p-4 sm:p-6" role="status">
      <div className="h-9 w-40 animate-pulse rounded bg-muted" />
      <div className="h-28 animate-pulse rounded-lg border bg-muted/40" />
      <div className="grid gap-6 lg:grid-cols-2">
        {["identity", "employment", "coverage"].map((section) => (
          <div
            key={section}
            className="h-64 animate-pulse rounded-lg border bg-muted/40"
          />
        ))}
      </div>
      <p className="sr-only">Loading employee details...</p>
    </div>
  );
}

export default function EmployeeDetailsPage() {
  const navigate = useNavigate();
  const { employeeId = "" } = useParams<{ employeeId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isEditOpen, setIsEditOpen] = useState(
    searchParams.get("edit") === "true",
  );
  const [jobsPageState, setJobsPageState] = useState({
    employeeId,
    page: 1,
  });
  const jobsPage =
    jobsPageState.employeeId === employeeId ? jobsPageState.page : 1;
  const isValidEmployeeId = /^[a-fA-F0-9]{24}$/.test(employeeId);
  const employeeQuery = useEmployee(employeeId);
  const employee = employeeQuery.data;
  const employeeJobsQuery = useJobs(
    {
      page: jobsPage,
      limit: JOBS_PAGE_LIMIT,
      ...(employee?.userId?._id ? { employeeId: employee.userId._id } : {}),
    },
    Boolean(isValidEmployeeId && employee?.userId?._id),
  );

  if (employeeQuery.isLoading) {
    return <DetailsSkeleton />;
  }

  if (
    !isValidEmployeeId ||
    (employeeQuery.isError && isNotFound(employeeQuery.error))
  ) {
    return (
      <main className="space-y-6 p-4 sm:p-6">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate("/admin/employees")}
        >
          <ArrowLeft />
          Back to Employees
        </Button>
        <Card>
          <CardContent className="p-6 text-center">
            <h1 className="text-xl font-semibold">Employee not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The requested employee record could not be found.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (employeeQuery.isError) {
    return (
      <main className="space-y-6 p-4 sm:p-6">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate("/admin/employees")}
        >
          <ArrowLeft />
          Back to Employees
        </Button>
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div role="alert">
              <h1 className="font-medium text-destructive">
                Failed to load employee details.
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {getErrorMessage(employeeQuery.error)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void employeeQuery.refetch()}
              disabled={employeeQuery.isFetching}
            >
              <RefreshCw
                className={employeeQuery.isFetching ? "animate-spin" : ""}
              />
              {employeeQuery.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!employee) {
    return (
      <main className="space-y-6 p-4 sm:p-6">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate("/admin/employees")}
        >
          <ArrowLeft />
          Back to Employees
        </Button>
        <Card>
          <CardContent className="p-6 text-center">
            <h1 className="text-xl font-semibold">Employee not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The requested employee record could not be found.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const linkedUserName = [
    employee.userId?.firstName,
    employee.userId?.lastName,
  ]
    .filter(Boolean)
    .join(" ");

  const closeEdit = () => {
    setIsEditOpen(false);
    if (searchParams.has("edit")) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete("edit");
      setSearchParams(nextSearchParams, { replace: true });
    }
  };

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <Button
        type="button"
        variant="outline"
        onClick={() => navigate("/admin/employees")}
      >
        <ArrowLeft />
        Back to Employees
      </Button>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h1 className="text-2xl font-bold">
              {linkedUserName || "Employee Details"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Employee code {employee.employeeCode}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={getStatusVariant(employee.status)}>
              {formatStatus(employee.status)}
            </Badge>
            <Button type="button" onClick={() => setIsEditOpen(true)}>
              <Pencil />
              Edit Employee
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={isEditOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsEditOpen(true);
          } else {
            closeEdit();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <div className="space-y-2">
            <DialogTitle>Edit Employee</DialogTitle>
            <DialogDescription>
              Update work profile and geographic assignments for Employee
              document {employee._id}. The linked User account is not edited.
            </DialogDescription>
          </div>
          {isEditOpen && (
            <EmployeeEditForm
              key={`${employee._id}-${employee.updatedAt}`}
              employee={employee}
              onCancel={closeEdit}
              onSaved={closeEdit}
            />
          )}
        </DialogContent>
      </Dialog>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identity and employment</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label="Employee document ID" value={employee._id} />
              <DetailRow label="Employee code" value={employee.employeeCode} />
              <DetailRow
                label="Linked User name"
                value={linkedUserName || "—"}
              />
              <DetailRow
                label="Linked User ID"
                value={employee.userId?._id ?? "—"}
              />
              <DetailRow
                label="User email"
                value={employee.userId?.email ?? "—"}
              />
              <DetailRow
                label="User type"
                value={employee.userId?.userType ?? "—"}
              />
              <DetailRow label="Designation" value={employee.designation} />
              <DetailRow label="Department" value={employee.department} />
              <DetailRow
                label="Employment type"
                value={employee.employmentType}
              />
              <DetailRow
                label="Joining date"
                value={formatDate(employee.joiningDate)}
              />
              {employee.salary !== undefined && (
                <DetailRow
                  label="Salary"
                  value={new Intl.NumberFormat().format(employee.salary)}
                />
              )}
              <DetailRow
                label="Supervisor"
                value={
                  employee.supervisor
                    ? [employee.supervisor.firstName, employee.supervisor.lastName]
                        .filter(Boolean)
                        .join(" ") ||
                      employee.supervisor.email ||
                      "Supervisor unavailable"
                    : employee.supervisorId
                      ? "Supervisor details unavailable"
                      : "Unassigned"
                }
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Geographic and ATM assignments</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailList
                label="Districts"
                values={assignmentNames(
                  employee.districts ?? [],
                  (district) => district.districtName,
                  "District unavailable",
                )}
              />
              <DetailList
                label="Regions"
                values={assignmentNames(
                  employee.regions ?? [],
                  (region) => region.name,
                  "Region unavailable",
                )}
              />
              <DetailList
                label="Assigned ATMs"
                values={assignmentNames(
                  employee.assignedAtms ?? [],
                  (atm) => atm.atmId,
                  "ATM unavailable",
                )}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Record metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow
                label="Created"
                value={formatDate(employee.createdAt)}
              />
              <DetailRow
                label="Last updated"
                value={formatDate(employee.updatedAt)}
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      <EmployeePerformance employee={employee} />

      <EmployeeAttendanceCalendar employeeId={employee._id} />

      <Card>
        <CardHeader>
          <CardTitle>Job history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {employeeJobsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading job history...
            </p>
          ) : employeeJobsQuery.isError ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-destructive" role="alert">
                Failed to load job history.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void employeeJobsQuery.refetch()}
                disabled={employeeJobsQuery.isFetching}
              >
                <RefreshCw
                  className={employeeJobsQuery.isFetching ? "animate-spin" : ""}
                />
                {employeeJobsQuery.isFetching ? "Retrying..." : "Retry"}
              </Button>
            </div>
          ) : !employeeJobsQuery.data?.jobs.length ? (
            <p className="text-sm text-muted-foreground">
              No job history is available for this employee.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[720px] text-sm">
                  <caption className="sr-only">
                    Paginated job history for {employee.employeeCode}
                  </caption>
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="p-3 font-medium">Job</th>
                      <th className="p-3 font-medium">ATM</th>
                      <th className="p-3 font-medium">Status</th>
                      <th className="p-3 font-medium">Assigned</th>
                      <th className="p-3 font-medium">Completed</th>
                      <th className="p-3 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {employeeJobsQuery.data.jobs.map((job) => (
                      <tr key={job._id}>
                        <td className="p-3">
                          <p className="font-medium">{job.jobId}</p>
                          <p className="text-muted-foreground">{job.title}</p>
                        </td>
                        <td className="p-3">
                          {typeof job.atmId === "object" && job.atmId
                            ? job.atmId.atmId || "ATM unavailable"
                            : "ATM unavailable"}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline">
                            {formatJobStatus(job.status)}
                          </Badge>
                        </td>
                        <td className="p-3">{formatDate(job.assignedAt)}</td>
                        <td className="p-3">{formatDate(job.completedAt)}</td>
                        <td className="p-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              navigate(`/admin/jobs/${job._id}`)
                            }
                          >
                            View job
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {employeeJobsQuery.data.pagination.total} job(s) · Page{" "}
                  {employeeJobsQuery.data.pagination.page} of{" "}
                  {Math.max(employeeJobsQuery.data.pagination.totalPages, 1)}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setJobsPageState({
                        employeeId,
                        page: Math.max(jobsPage - 1, 1),
                      })
                    }
                    disabled={jobsPage <= 1 || employeeJobsQuery.isFetching}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setJobsPageState({ employeeId, page: jobsPage + 1 })
                    }
                    disabled={
                      jobsPage >= employeeJobsQuery.data.pagination.totalPages ||
                      employeeJobsQuery.isFetching
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function isNotFound(error: unknown) {
  return isAxiosError(error) && error.response?.status === 404;
}
