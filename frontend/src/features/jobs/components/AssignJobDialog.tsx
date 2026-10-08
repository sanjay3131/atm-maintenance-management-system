import { useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { useATMs } from "@/features/atms/hooks/useATMs";
import { useEmployees } from "@/features/employees/hooks/useEmployees";
import type { Employee } from "@/services/employee.service";
import { Button } from "@/components/ui/button";
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
import { useAssignJob } from "../hooks/useAssignJob";
import { useReassignJob } from "../hooks/useReassignJob";
import type { Job } from "../types/job.types";

interface AssignJobDialogProps {
  job: Job;
  onClose: () => void;
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Unable to update the job assignment.";
  }

  return error instanceof Error
    ? error.message
    : "Unable to update the job assignment.";
}

function getEmployeeDisplayName(employee: Employee) {
  return [employee.userId.firstName, employee.userId.lastName]
    .filter(Boolean)
    .join(" ");
}

export default function AssignJobDialog({
  job,
  onClose,
}: AssignJobDialogProps) {
  const [employeeId, setEmployeeId] = useState("");
  const {
    data: atms = [],
    isLoading: isATMsLoading,
    isError: isATMsError,
    refetch: refetchATMs,
    isFetching: isATMsFetching,
  } = useATMs();
  const {
    data: employees = [],
    isLoading: isEmployeesLoading,
    isError: isEmployeesError,
    refetch,
    isFetching,
  } = useEmployees();
  const assignMutation = useAssignJob();
  const reassignMutation = useReassignJob();
  const isInitialAssignment = job.status === "PENDING";
  const isPending = assignMutation.isPending || reassignMutation.isPending;
  const [reason, setReason] = useState("");
  const atm =
    typeof job.atmId === "object" && job.atmId !== null ? job.atmId : null;
  const jobATMId =
    typeof job.atmId === "object" && job.atmId !== null
      ? job.atmId._id
      : job.atmId;
  const assignedATM = atms.find((option) => option._id === jobATMId);
  const hasATMEmployeeAssignmentData = Array.isArray(
    assignedATM?.assignedEmployeeId,
  );
  const assignedEmployeeIds = new Set(
    (hasATMEmployeeAssignmentData ? assignedATM.assignedEmployeeId : [])
      .map((assignment) =>
        typeof assignment === "string" ? assignment : assignment?._id,
      )
      .filter((id): id is string => Boolean(id))
      .map((id) => id.toLowerCase()),
  );
  const assignableEmployees = employees.filter(
    (employee) =>
      employee.status === "active" &&
      employee.userId?.status === "active" &&
      employee.userId.userType === "employee" &&
      Boolean(employee.userId._id) &&
      assignedEmployeeIds.has(employee._id.toLowerCase()),
  );
  const jobAssignedUserId =
    typeof job.assignedEmployeeId === "object" &&
    job.assignedEmployeeId !== null
      ? job.assignedEmployeeId._id
      : job.assignedEmployeeId;
  const eligibilityDataLoaded =
    !isATMsLoading &&
    !isEmployeesLoading &&
    !isATMsError &&
    !isEmployeesError &&
    Boolean(assignedATM);
  const assignmentDataReady =
    eligibilityDataLoaded && hasATMEmployeeAssignmentData;
  const currentAssignee = assignableEmployees.find(
    (employee) =>
      employee.userId._id.toLowerCase() === jobAssignedUserId?.toLowerCase(),
  );
  const eligibleByEmployeeId = new Map(
    assignableEmployees.map((employee) => [
      employee._id.toLowerCase(),
      employee,
    ]),
  );
  const firstEligibleEmployee = (assignedATM?.assignedEmployeeId ?? [])
    .map((assignment) =>
      typeof assignment === "string" ? assignment : assignment?._id,
    )
    .map((id) => (id ? eligibleByEmployeeId.get(id.toLowerCase()) : undefined))
    .find((employee) => employee !== undefined);
  const defaultEmployee = currentAssignee ?? firstEligibleEmployee;
  const selectedEmployee = employeeId
    ? assignableEmployees.find(
        (employee) =>
          employee.userId._id.toLowerCase() === employeeId.toLowerCase(),
      )
    : defaultEmployee;
  const selectedEmployeeId = selectedEmployee?.userId._id ?? "";
  const isUnchangedAssignment =
    !isInitialAssignment &&
    job.status !== "REJECTED" &&
    selectedEmployeeId === jobAssignedUserId;

  const handleAssign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !selectedEmployee ||
      isPending ||
      isUnchangedAssignment ||
      (!isInitialAssignment && reason.trim().length < 5)
    ) {
      return;
    }

    const handleSuccess = () => {
      toast.success(
        !isInitialAssignment
          ? `Job ${job.jobNumber || job.jobId} reassigned successfully.`
          : `Job ${job.jobNumber || job.jobId} assigned successfully.`,
      );
      onClose();
    };
    const handleError = (error: Error) => toast.error(getErrorMessage(error));

    if (!isInitialAssignment) {
      reassignMutation.mutate(
        {
          jobId: job._id,
          employeeId: selectedEmployee.userId._id,
          reason: reason.trim(),
        },
        { onSuccess: handleSuccess, onError: handleError },
      );
    } else {
      assignMutation.mutate(
        { jobId: job._id, employeeId: selectedEmployee.userId._id },
        { onSuccess: handleSuccess, onError: handleError },
      );
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogTitle>
          {isInitialAssignment ? "Assign Job" : "Reassign Job"}
        </DialogTitle>
        <DialogDescription className="mt-1">
          {!isInitialAssignment
            ? "Choose an active employee linked to this ATM. The current employee is selected by default when eligible."
            : "Select an employee for this pending job."}
        </DialogDescription>

        <div className="mt-4 space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
          <p>
            <span className="text-muted-foreground">Job ID: </span>
            <span className="font-medium">{job.jobNumber || job.jobId}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Title: </span>
            <span className="font-medium">{job.title}</span>
          </p>
          <p>
            <span className="text-muted-foreground">ATM: </span>
            <span className="font-medium">
              {atm
                ? [atm.atmId, atm.locationName].filter(Boolean).join(" · ") ||
                  "ATM details unavailable"
                : "ATM details unavailable"}
            </span>
          </p>
        </div>

        <form onSubmit={handleAssign} className="mt-5 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Employee</label>
            <Select
              value={selectedEmployeeId || null}
              onValueChange={(value) => setEmployeeId(value ?? "")}
              disabled={
                isATMsLoading ||
                isATMsError ||
                isEmployeesLoading ||
                isEmployeesError ||
                !assignedATM ||
                assignableEmployees.length === 0 ||
                isPending
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    isATMsLoading || isEmployeesLoading
                      ? "Loading employees..."
                      : isATMsError || isEmployeesError
                        ? "Could not load assignment eligibility"
                        : !assignedATM
                          ? "Could not find the Job ATM"
                          : assignableEmployees.length === 0
                            ? "No eligible ATM employees"
                            : "Select an employee"
                  }
                >
                  {selectedEmployee
                    ? `${getEmployeeDisplayName(selectedEmployee)} · ${selectedEmployee.employeeCode}`
                    : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {assignableEmployees.map((employee) => (
                  <SelectItem key={employee._id} value={employee.userId._id}>
                    <span className="font-medium">
                      {getEmployeeDisplayName(employee)}
                    </span>
                    <span className="text-muted-foreground">
                      {employee.employeeCode}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isATMsLoading && (
            <p className="text-sm text-muted-foreground" role="status">
              Loading ATM assignments...
            </p>
          )}

          {isATMsError && (
            <div className="flex items-center justify-between gap-3 text-sm text-destructive">
              <span>Could not load the Job ATM assignment list.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refetchATMs()}
                disabled={isATMsFetching}
              >
                {isATMsFetching ? "Retrying..." : "Retry"}
              </Button>
            </div>
          )}

          {!isATMsLoading && !isATMsError && !assignedATM && (
            <p className="text-sm text-destructive">
              The Job ATM could not be found. Refresh the page before assigning.
            </p>
          )}

          {eligibilityDataLoaded && !hasATMEmployeeAssignmentData && (
            <p className="text-sm text-destructive">
              ATM assignment data is unavailable. Refresh the ATM data before
              assigning.
            </p>
          )}

          {!isInitialAssignment && (
            <div>
              <label
                htmlFor="job-reassignment-reason"
                className="mb-2 block text-sm font-medium"
              >
                Reassignment reason
              </label>
              <textarea
                id="job-reassignment-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={5}
                maxLength={1000}
                rows={3}
                required
                disabled={isPending}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              {reason.trim().length > 0 && reason.trim().length < 5 && (
                <p className="mt-1 text-sm text-destructive">
                  Enter at least 5 characters.
                </p>
              )}
              {isUnchangedAssignment && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose a different eligible employee to change the assignment.
                </p>
              )}
            </div>
          )}

          {isEmployeesLoading && (
            <div className="space-y-2" role="status">
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              <div className="h-9 animate-pulse rounded-lg bg-muted" />
              <p className="sr-only">Loading employees...</p>
            </div>
          )}

          {isEmployeesError && (
            <div className="flex items-center justify-between gap-3 text-sm text-destructive">
              <span>Could not load employees.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                {isFetching ? "Retrying..." : "Retry"}
              </Button>
            </div>
          )}

          {!isEmployeesLoading &&
            !isEmployeesError &&
            assignmentDataReady &&
            assignableEmployees.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No active, eligible employees are assigned to this ATM.
              </p>
            )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !selectedEmployee ||
                isPending ||
                !assignmentDataReady ||
                  isUnchangedAssignment ||
                  (!isInitialAssignment && reason.trim().length < 5)
                }
              >
              {isPending
                  ? !isInitialAssignment
                    ? "Reassigning..."
                    : "Assigning..."
                  : !isInitialAssignment
                    ? "Reassign job"
                    : "Assign job"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
