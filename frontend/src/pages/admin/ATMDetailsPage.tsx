import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, MapPin, Pencil, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import api from "@/lib/axios";
import { useDeleteATM } from "@/features/atms/hooks/useDeleteATM";
import { useAssignEmployeeToATM } from "@/features/atms/hooks/useAssignEmployeeToATM";
import { useATM } from "@/features/atms/hooks/useATM";
import type { ATMEmployee, ATMStatus } from "@/features/atms/types/atm.types";

const NOT_AVAILABLE = "Not available";

interface EmployeeOption extends ATMEmployee {
  status?: string;
  userId?: NonNullable<ATMEmployee["userId"]> | null;
}

function formatValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === ""
    ? NOT_AVAILABLE
    : String(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return NOT_AVAILABLE;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? NOT_AVAILABLE : date.toLocaleString();
}

function getStatusVariant(status?: ATMStatus) {
  if (status === "ACTIVE") return "default" as const;
  if (status === "REMOVED") return "destructive" as const;
  return "secondary" as const;
}

function getEmployeeName(employee: ATMEmployee) {
  const name = [employee.userId?.firstName, employee.userId?.lastName]
    .filter(Boolean)
    .join(" ");

  return name || NOT_AVAILABLE;
}

function getEmployeeInitials(employee: ATMEmployee) {
  const name = getEmployeeName(employee);
  if (name === NOT_AVAILABLE) return "?";

  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium sm:max-w-[65%] sm:text-right">
        {value}
      </dd>
    </div>
  );
}

function DetailsSkeleton() {
  return (
    <div className="space-y-6 p-6" role="status">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-6 lg:grid-cols-2">
        {["basic", "organization", "location", "employees"].map((section) => (
          <div
            key={section}
            className="h-56 animate-pulse rounded-lg border bg-muted/40"
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Loading ATM details...</p>
    </div>
  );
}

export default function ATMDetailsPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const deleteATM = useDeleteATM();
  const assignEmployee = useAssignEmployeeToATM();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const { data: atm, isLoading, isError, refetch, isFetching } = useATM(id);
  const {
    data: availableEmployees = [],
    isLoading: employeesLoading,
    isError: employeesError,
  } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const response = await api.get<{ data: EmployeeOption[] }>("/employees");
      return response.data.data;
    },
    select: (items) =>
      items.filter(
        (employee) =>
          employee.status === "active" &&
          employee.userId?.status === "active" &&
          employee.userId.userType === "employee",
      ),
    enabled: assignDialogOpen,
  });
  const selectedEmployee = availableEmployees.find(
    (employee) => employee._id === selectedEmployeeId,
  );

  const handleDelete = () => {
    if (!atm) return;

    deleteATM.mutate(atm._id, {
      onSuccess: () => {
        toast.success(`ATM ${atm.atmId} deleted successfully.`);
        void queryClient.invalidateQueries({ queryKey: ["atms"] });
        queryClient.removeQueries({ queryKey: ["atm", atm._id] });
        navigate("/admin/atms");
      },
      onError: () => {
        toast.error("ATM deletion failed. Please try again.");
      },
    });
  };

  const handleAssignEmployee = () => {
    if (!atm || !selectedEmployeeId) return;

    saveEmployeeAssignment(selectedEmployeeId);
  };

  const handleUnassignEmployee = () => {
    if (!atm) return;
    saveEmployeeAssignment(null);
  };

  const saveEmployeeAssignment = (employeeId: string | null) => {
    if (!atm) return;
    assignEmployee.mutate(
      { atmId: atm._id, employeeId },
      {
        onSuccess: () => {
          toast.success(
            employeeId
              ? "Maintenance employee updated successfully."
              : "Maintenance employee unassigned successfully.",
          );
          [
            ["atm", atm._id],
            ["atms"],
            ["employees"],
            ["district-atms"],
            ["region-atms"],
            ["district-employees"],
            ["region-employees"],
          ].forEach((queryKey) => {
            void queryClient.invalidateQueries({ queryKey });
          });
          setAssignDialogOpen(false);
        },
        onError: (error) => {
          const message = isAxiosError<{ message?: string }>(error)
            ? error.response?.data?.message
            : undefined;
          toast.error(message || "Employee assignment failed.");
        },
      },
    );
  };

  if (isLoading) return <DetailsSkeleton />;

  if (isError || !atm) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate("/admin/atms")}>
          <ArrowLeft />
          Back to ATMs
        </Button>
        <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h1 className="font-semibold text-destructive">
            ATM details unavailable
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This ATM may not exist or could not be loaded.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? "Retrying..." : "Retry"}
          </Button>
        </div>
      </div>
    );
  }

  const coordinates = atm.location?.coordinates;
  const assignedEmployees = atm.assignedEmployeeId.filter(
    (employee): employee is ATMEmployee =>
      employee !== null && typeof employee === "object",
  );
  const assignment = assignedEmployees[0];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            className="-ml-3 mb-3"
            onClick={() => navigate("/admin/atms")}
          >
            <ArrowLeft />
            Back to ATMs
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">ATM Details</h1>
            <Badge variant={getStatusVariant(atm.status)}>
              {formatValue(atm.status)}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatValue(atm.atmId)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedEmployeeId(assignment?._id || "");
              setAssignDialogOpen(true);
            }}
          >
            {assignment ? "Change Employee" : "Assign Employee"}
          </Button>
          <Button onClick={() => navigate(`/admin/atms/${atm._id}/edit`)}>
            <Pencil />
            Edit ATM
          </Button>
          <Button
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={deleteATM.isPending}
          >
            <Trash2 />
            Delete ATM
          </Button>
        </div>
      </div>

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!deleteATM.isPending) setDeleteDialogOpen(open);
        }}
      >
        <DialogContent>
          <div className="space-y-2">
            <DialogTitle>Delete ATM?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this ATM? This action will remove
              the ATM from the active ATM list.
            </DialogDescription>
          </div>
          <p className="mt-4 text-sm">
            ATM ID: <span className="font-medium">{atm.atmId}</span>
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleteATM.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteATM.isPending}
            >
              <Trash2 />
              {deleteATM.isPending ? "Deleting..." : "Delete ATM"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={assignDialogOpen}
        onOpenChange={(open) => {
          if (!assignEmployee.isPending) setAssignDialogOpen(open);
        }}
      >
        <DialogContent>
          <div className="space-y-2">
            <DialogTitle>
              {assignment ? "Change Maintenance Employee" : "Assign Employee"}
            </DialogTitle>
            <DialogDescription>
              Choose the one employee responsible for maintenance at this ATM.
            </DialogDescription>
          </div>
          <p className="mt-4 text-sm">
            ATM: <span className="font-medium">{atm.atmId}</span>
          </p>
          <label className="mt-4 block text-sm font-medium" htmlFor="employee">
            Employee
          </label>
          <Select
            value={selectedEmployeeId}
            onValueChange={(value) => setSelectedEmployeeId(value || "")}
            disabled={employeesLoading || employeesError}
          >
            <SelectTrigger id="employee" className="mt-2 w-full">
              <SelectValue
                placeholder={
                  employeesLoading ? "Loading employees..." : "Select employee"
                }
              >
                {selectedEmployee
                  ? `${selectedEmployee.employeeCode} — ${[
                      selectedEmployee.userId?.firstName,
                      selectedEmployee.userId?.lastName,
                    ]
                      .filter(Boolean)
                      .join(" ")}`
                  : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableEmployees.map((employee) => (
                <SelectItem key={employee._id} value={employee._id}>
                  {employee.employeeCode} —{" "}
                  {`${employee.userId?.firstName || ""} ${
                    employee.userId?.lastName || ""
                  }`.trim()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {employeesError && (
            <p className="mt-2 text-sm text-destructive">
              Failed to load employees. Close and reopen the dialog to retry.
            </p>
          )}
          {availableEmployees.length === 0 &&
            !employeesLoading &&
            !employeesError && (
            <p className="mt-2 text-sm text-muted-foreground">
              No active employees are available.
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            {assignment && (
              <Button
                variant="outline"
                onClick={handleUnassignEmployee}
                disabled={assignEmployee.isPending}
              >
                {assignEmployee.isPending ? "Saving..." : "Unassign"}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setAssignDialogOpen(false)}
              disabled={assignEmployee.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssignEmployee}
              disabled={
                !selectedEmployeeId ||
                employeesLoading ||
                employeesError ||
                assignEmployee.isPending
              }
            >
              {assignEmployee.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label="ATM ID" value={formatValue(atm.atmId)} />
              <DetailRow
                label="Location name"
                value={formatValue(atm.locationName)}
              />
              <DetailRow
                label="Full address"
                value={formatValue(atm.address)}
              />
              <DetailRow
                label="Installation type"
                value={formatValue(atm.installationType)}
              />
              <DetailRow label="Status" value={formatValue(atm.status)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow
                label="Bank"
                value={formatValue(atm.bankId?.bankName)}
              />
              <DetailRow
                label="Customer"
                value={formatValue(
                  typeof atm.customer === "object"
                    ? atm.customer?.customerName
                    : atm.customer,
                )}
              />
              <DetailRow
                label="District"
                value={formatValue(atm.districtId?.districtName)}
              />
              <DetailRow
                label="Region"
                value={formatValue(atm.regionId?.name)}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Location</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow
                label="Configured"
                value={
                  atm.locationConfigured === undefined
                    ? NOT_AVAILABLE
                    : atm.locationConfigured
                      ? "Configured"
                      : "Not configured"
                }
              />
              <DetailRow
                label="Latitude"
                value={formatValue(coordinates?.[1])}
              />
              <DetailRow
                label="Longitude"
                value={formatValue(coordinates?.[0])}
              />
              <DetailRow
                label="GPS accuracy"
                value={
                  atm.locationAccuracy === null ||
                  atm.locationAccuracy === undefined
                    ? NOT_AVAILABLE
                    : `${atm.locationAccuracy} meters`
                }
              />
              <DetailRow
                label="Captured date"
                value={formatDate(atm.locationCapturedAt)}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Maintenance Employee</CardTitle>
          </CardHeader>
          <CardContent>
            {assignedEmployees.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not Assigned</p>
            ) : (
              <div className="space-y-3">
                {assignedEmployees.map((employee) => (
                  <div
                    key={employee._id}
                    className="flex items-center gap-3 rounded-md border p-3"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {getEmployeeInitials(employee)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {getEmployeeName(employee)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Code: {formatValue(employee.employeeCode)}
                      </p>
                    </div>
                  </div>
                ))}
                {assignedEmployees.length > 1 && (
                  <p className="text-sm text-destructive">
                    Multiple employee assignments were found in existing data.
                    Use Change Employee to replace them with one assignment.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {!atm.locationConfigured && atm.location && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="size-4" />
          Location coordinates are available, but configuration status was not
          provided.
        </p>
      )}
    </div>
  );
}
