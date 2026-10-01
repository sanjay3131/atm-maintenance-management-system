import { useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { toast } from "sonner";
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
import type { Job } from "../types/job.types";

interface AssignJobDialogProps {
  job: Job;
  onClose: () => void;
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Unable to assign the job.";
  }

  return error instanceof Error ? error.message : "Unable to assign the job.";
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
    data: employees = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useEmployees();
  const assignMutation = useAssignJob();
  const atm =
    typeof job.atmId === "object" && job.atmId !== null ? job.atmId : null;
  const assignableEmployees = employees.filter((employee) =>
    Boolean(employee.userId?._id),
  );
  const selectedEmployee = assignableEmployees.find(
    (employee) => employee.userId._id === employeeId,
  );

  const handleAssign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employeeId || assignMutation.isPending) return;

    assignMutation.mutate(
      { jobId: job._id, employeeId },
      {
        onSuccess: () => {
          toast.success(
            `Job ${job.jobNumber || job.jobId} assigned successfully.`,
          );
          onClose();
        },
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !assignMutation.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogTitle>Assign Job</DialogTitle>
        <DialogDescription className="mt-1">
          Select an employee for this pending job.
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
              value={employeeId || null}
              onValueChange={(value) => setEmployeeId(value ?? "")}
              disabled={
                isLoading ||
                isError ||
                assignableEmployees.length === 0 ||
                assignMutation.isPending
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    isLoading
                      ? "Loading employees..."
                      : isError
                        ? "Could not load employees"
                        : assignableEmployees.length === 0
                          ? "No employees available"
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

          {isLoading && (
            <div className="space-y-2" role="status">
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              <div className="h-9 animate-pulse rounded-lg bg-muted" />
              <p className="sr-only">Loading employees...</p>
            </div>
          )}

          {isError && (
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

          {!isLoading && !isError && assignableEmployees.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No employees are available to assign.
            </p>
          )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={assignMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!employeeId || assignMutation.isPending}
            >
              {assignMutation.isPending ? "Assigning..." : "Assign job"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
