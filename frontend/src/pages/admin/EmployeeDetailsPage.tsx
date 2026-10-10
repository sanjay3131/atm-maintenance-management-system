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
  const isValidEmployeeId = /^[a-fA-F0-9]{24}$/.test(employeeId);
  const employeeQuery = useEmployee(employeeId);
  const employee = employeeQuery.data;

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
                label="Supervisor User ID"
                value={employee.supervisorId ?? "—"}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Geographic and ATM assignments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Related records are returned as IDs by this endpoint; names are
              not available here.
            </p>
            <dl>
              <DetailList
                label="District IDs"
                values={employee.districtIds ?? []}
              />
              <DetailList
                label="Region IDs"
                values={employee.regionIds ?? []}
              />
              <DetailList
                label="Assigned ATM IDs"
                values={employee.assignedAtmIds ?? []}
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
    </main>
  );
}

function isNotFound(error: unknown) {
  return isAxiosError(error) && error.response?.status === 404;
}
