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
import { useUpdateATM } from "@/features/atms/hooks/useUpdateATM";
import { useSetATMAMCResponsibleEmployee } from "@/features/atms/hooks/useSetATMAMCResponsibleEmployee";
import { useATM } from "@/features/atms/hooks/useATM";
import type { ATMEmployee, ATMStatus } from "@/features/atms/types/atm.types";

const NOT_AVAILABLE = "Not available";
const NOT_ASSIGNED = "not-assigned";

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
  const updateATM = useUpdateATM();
  const setAMCResponsibleEmployee = useSetATMAMCResponsibleEmployee();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [amcResponsibleDraft, setAMCResponsibleDraft] = useState<
    string | undefined
  >();
  const { data: atm, isLoading, isError, refetch, isFetching } = useATM(id);
  const {
    data: availableEmployees = [],
    isLoading: employeesLoading,
    isError: employeesError,
    refetch: refetchEmployees,
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
  });
  const assignedEmployeeIds = (atm?.assignedEmployeeId ?? []).flatMap(
    (employee) =>
      typeof employee === "string"
        ? [employee]
        : employee
          ? [employee._id]
          : [],
  );
  const employeesAvailableForAssignment = availableEmployees.filter(
    (employee) => !assignedEmployeeIds.includes(employee._id),
  );
  const selectedEmployee = employeesAvailableForAssignment.find(
    (employee) => employee._id === selectedEmployeeId,
  );
  const eligibleAssignedEmployees = availableEmployees.filter((employee) =>
    assignedEmployeeIds.includes(employee._id),
  );
  const currentAMCResponsibleId =
    typeof atm?.amcResponsibleEmployeeId === "string"
      ? atm.amcResponsibleEmployeeId
      : (atm?.amcResponsibleEmployeeId?._id ?? null);
  const displayedAMCResponsibleDraft =
    amcResponsibleDraft ?? currentAMCResponsibleId ?? NOT_ASSIGNED;
  const selectedAMCResponsibleEmployee = eligibleAssignedEmployees.find(
    (employee) => employee._id === displayedAMCResponsibleDraft,
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

    assignEmployee.mutate(
      { atmId: atm._id, employeeId: selectedEmployeeId },
      {
        onSuccess: () => {
          toast.success("Employee added to this ATM.");
          invalidateAssignmentQueries(atm._id);
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

  const invalidateAssignmentQueries = (atmId: string) => {
    [
      ["atm", atmId],
      ["atms"],
      ["employees"],
      ["district-atms"],
      ["region-atms"],
      ["district-employees"],
      ["region-employees"],
    ].forEach((queryKey) => {
      void queryClient.invalidateQueries({ queryKey });
    });
  };

  const handleRemoveEmployee = (employeeId: string) => {
    if (!atm) return;
    const remainingEmployeeIds = assignedEmployeeIds.filter(
      (id) => id !== employeeId,
    );
    updateATM.mutate(
      {
        atmId: atm._id,
        data: {
          bankId: atm.bankId._id,
          ...(atm.customer
            ? {
                customerId:
                  typeof atm.customer === "string"
                    ? atm.customer
                    : atm.customer._id,
              }
            : {}),
          districtId: atm.districtId._id,
          regionId: atm.regionId?._id ?? null,
          locationName: atm.locationName,
          address: atm.address,
          installationType: atm.installationType,
          status: atm.status,
          assignedEmployeeId: remainingEmployeeIds,
        },
      },
      {
        onSuccess: () => {
          toast.success("Employee removed from this ATM.");
          invalidateAssignmentQueries(atm._id);
        },
        onError: (error) => {
          const message = isAxiosError<{ message?: string }>(error)
            ? error.response?.data?.message
            : undefined;
          toast.error(message || "Employee removal failed.");
          void refetch();
        },
      },
    );
  };

  const handleSaveAMCResponsible = () => {
    if (!atm) return;
    const employeeId =
      displayedAMCResponsibleDraft === NOT_ASSIGNED
        ? null
        : displayedAMCResponsibleDraft;
    setAMCResponsibleEmployee.mutate(
      { atmId: atm._id, employeeId },
      {
        onSuccess: () => {
          setAMCResponsibleDraft(undefined);
          toast.success(
            employeeId
              ? "AMC responsible employee updated."
              : "AMC responsibility cleared.",
          );
        },
        onError: (error) => {
          setAMCResponsibleDraft(undefined);
          const message = isAxiosError<{ message?: string }>(error)
            ? error.response?.data?.message
            : undefined;
          toast.error(message || "AMC responsibility could not be updated.");
          void refetch();
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
  const assignedEmployees = (atm.assignedEmployeeId ?? []).filter(
    (employee): employee is string | ATMEmployee => employee !== null,
  );
  const currentAMCResponsibleIsEligible =
    currentAMCResponsibleId === null ||
    eligibleAssignedEmployees.some(
      (employee) => employee._id === currentAMCResponsibleId,
    );

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
              setSelectedEmployeeId("");
              setAssignDialogOpen(true);
            }}
          >
            Add Employee
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
            <DialogTitle>Add Employee</DialogTitle>
            <DialogDescription>
              Add an employee without changing the other employees assigned to
              this ATM.
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
              {employeesAvailableForAssignment.map((employee) => (
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
          {employeesAvailableForAssignment.length === 0 &&
            !employeesLoading &&
            !employeesError && (
              <p className="mt-2 text-sm text-muted-foreground">
                {availableEmployees.length === 0
                  ? "No active employees are available."
                  : "All active employees are already assigned."}
              </p>
            )}
          <div className="mt-6 flex justify-end gap-2">
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
            <CardTitle>Assigned Employees</CardTitle>
          </CardHeader>
          <CardContent>
            {assignedEmployees.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not Assigned</p>
            ) : (
              <div className="space-y-3">
                {assignedEmployees.map((employee) => {
                  const employeeId =
                    typeof employee === "string" ? employee : employee._id;
                  return (
                    <div
                      key={employeeId}
                      className="flex items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {typeof employee === "string"
                            ? "?"
                            : getEmployeeInitials(employee)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {typeof employee === "string"
                              ? "Employee details unavailable"
                              : getEmployeeName(employee)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {typeof employee === "string"
                              ? `ID: ${employee}`
                              : `Code: ${formatValue(employee.employeeCode)}`}
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveEmployee(employeeId)}
                        disabled={updateATM.isPending}
                      >
                        Remove
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AMC Responsible</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select
              value={displayedAMCResponsibleDraft}
              onValueChange={(value) =>
                setAMCResponsibleDraft(value ?? NOT_ASSIGNED)
              }
              disabled={
                employeesLoading ||
                employeesError ||
                setAMCResponsibleEmployee.isPending
              }
            >
              <SelectTrigger className="w-full sm:max-w-md">
                <SelectValue
                  placeholder={
                    employeesLoading
                      ? "Loading assigned employees..."
                      : "Select AMC responsible employee"
                  }
                >
                  {displayedAMCResponsibleDraft === NOT_ASSIGNED
                    ? "Not assigned"
                    : selectedAMCResponsibleEmployee
                      ? `${formatValue(
                          selectedAMCResponsibleEmployee.employeeCode,
                        )} — ${[
                          selectedAMCResponsibleEmployee.userId?.firstName,
                          selectedAMCResponsibleEmployee.userId?.lastName,
                        ]
                          .filter(Boolean)
                          .join(" ")}`
                      : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_ASSIGNED}>Not assigned</SelectItem>
                {eligibleAssignedEmployees.map((employee) => (
                  <SelectItem key={employee._id} value={employee._id}>
                    {employee.employeeCode} —{" "}
                    {`${employee.userId?.firstName || ""} ${
                      employee.userId?.lastName || ""
                    }`.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              onClick={handleSaveAMCResponsible}
              disabled={
                employeesLoading ||
                employeesError ||
                setAMCResponsibleEmployee.isPending ||
                ((displayedAMCResponsibleDraft === NOT_ASSIGNED
                  ? null
                  : displayedAMCResponsibleDraft) === currentAMCResponsibleId &&
                  currentAMCResponsibleIsEligible)
              }
            >
              {setAMCResponsibleEmployee.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
          {employeesError && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              <span>Could not load employee eligibility.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refetchEmployees()}
              >
                Retry
              </Button>
            </div>
          )}
          {!employeesLoading &&
            !employeesError &&
            eligibleAssignedEmployees.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Assign an active employee to this ATM before setting AMC
                responsibility.
              </p>
            )}
          {!currentAMCResponsibleIsEligible && (
            <p className="text-sm text-destructive">
              The configured AMC responsible employee is no longer eligible or
              assigned. Select an eligible assigned employee or clear the
              responsibility.
            </p>
          )}
        </CardContent>
      </Card>

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
