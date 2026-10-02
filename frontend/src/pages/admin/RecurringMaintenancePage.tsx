import { useState } from "react";
import { isAxiosError } from "axios";
import { CalendarClock, Pencil, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUpdateRecurringPlan } from "@/features/recurring-maintenance/hooks/useUpdateRecurringPlan";
import { useRecurringPlans } from "@/features/recurring-maintenance/hooks/useRecurringPlans";
import RecurringPlanDialog from "@/features/recurring-maintenance/components/RecurringPlanDialog";
import type { RecurringMaintenancePlan } from "@/features/recurring-maintenance/types/recurring-maintenance.types";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatPlanDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getMaintenanceLabel(plan: RecurringMaintenancePlan) {
  return plan.maintenanceType === "DAILY_CLEANING"
    ? "Daily Cleaning"
    : "Weekly Mopping";
}

function getScheduleLabel(plan: RecurringMaintenancePlan) {
  if (plan.maintenanceType === "DAILY_CLEANING") return "Daily";
  return plan.dayOfWeek === null || plan.dayOfWeek === undefined
    ? "Weekday not set"
    : `Every ${WEEKDAYS[plan.dayOfWeek]}`;
}

function getATM(plan: RecurringMaintenancePlan) {
  return typeof plan.atmId === "string" ? null : plan.atmId;
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return (
      error.response?.data?.message ||
      "Could not update the recurring maintenance plan."
    );
  }
  return error instanceof Error
    ? error.message
    : "Could not update the recurring maintenance plan.";
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border" role="status">
      <div className="h-11 border-b bg-muted/50" />
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-2 gap-4 border-b px-4 py-4 last:border-0 md:grid-cols-7"
        >
          {Array.from({ length: 7 }, (_, cellIndex) => (
            <div
              key={cellIndex}
              className="h-4 animate-pulse rounded bg-muted"
            />
          ))}
        </div>
      ))}
      <p className="sr-only">Loading recurring maintenance plans...</p>
    </div>
  );
}

export default function RecurringMaintenancePage() {
  const {
    data: plans = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useRecurringPlans();
  const updatePlan = useUpdateRecurringPlan();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] =
    useState<RecurringMaintenancePlan | null>(null);
  const [planToToggle, setPlanToToggle] =
    useState<RecurringMaintenancePlan | null>(null);

  const openCreateDialog = () => {
    setEditingPlan(null);
    setDialogOpen(true);
  };

  const openEditDialog = (plan: RecurringMaintenancePlan) => {
    setEditingPlan(plan);
    setDialogOpen(true);
  };

  const confirmToggle = async () => {
    if (!planToToggle) return;
    const nextActiveState = !planToToggle.isActive;

    try {
      await updatePlan.mutateAsync({
        planId: planToToggle._id,
        data: { isActive: nextActiveState },
      });
      toast.success(
        nextActiveState
          ? "Recurring plan activated."
          : "Recurring plan deactivated.",
      );
      setPlanToToggle(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <div className="h-8 w-72 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
        </div>
        <TableSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Recurring Maintenance</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage automatic daily cleaning and weekly mopping schedules.
            Monthly deep cleaning is managed through AMC.
          </p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <Plus />
          Create Recurring Plan
        </Button>
      </div>

      {isError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div>
              <p className="font-medium text-destructive">
                Failed to load recurring maintenance plans.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Check your connection and try again.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={isFetching ? "animate-spin" : ""} />
              {isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center px-6 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CalendarClock className="size-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">
              No recurring maintenance plans yet.
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Create a plan to automatically schedule daily cleaning or weekly
              mopping for an ATM.
            </p>
            <Button className="mt-5" type="button" onClick={openCreateDialog}>
              <Plus />
              Create Recurring Plan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Maintenance Plans</CardTitle>
            <span className="text-sm text-muted-foreground">
              {plans.length} {plans.length === 1 ? "plan" : "plans"}
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-sm">
                <thead className="border-y bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">ATM</th>
                    <th className="px-4 py-3 text-left font-medium">
                      Location
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Maintenance
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Schedule
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Start Date
                    </th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => {
                    const atm = getATM(plan);
                    return (
                      <tr key={plan._id} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">
                          {atm?.atmId || "ATM details unavailable"}
                        </td>
                        <td className="px-4 py-3">
                          {atm?.locationName || "Not available"}
                        </td>
                        <td className="px-4 py-3">
                          {getMaintenanceLabel(plan)}
                        </td>
                        <td className="px-4 py-3">{getScheduleLabel(plan)}</td>
                        <td className="px-4 py-3">
                          {formatPlanDate(plan.startDate)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={plan.isActive ? "default" : "secondary"}
                          >
                            {plan.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(plan)}
                            >
                              <Pencil />
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={updatePlan.isPending}
                              onClick={() => setPlanToToggle(plan)}
                            >
                              {plan.isActive ? "Deactivate" : "Activate"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <RecurringPlanDialog
        open={dialogOpen}
        plan={editingPlan}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingPlan(null);
        }}
      />

      <Dialog
        open={Boolean(planToToggle)}
        onOpenChange={(open) => {
          if (!updatePlan.isPending && !open) setPlanToToggle(null);
        }}
      >
        <DialogContent>
          <div className="space-y-2">
            <DialogTitle>
              {planToToggle?.isActive
                ? "Deactivate recurring plan?"
                : "Activate recurring plan?"}
            </DialogTitle>
            <DialogDescription>
              {planToToggle?.isActive
                ? "This stops future recurring Job generation for this plan. Existing Jobs and history are not deleted."
                : "Future occurrences will be generated according to this plan."}
            </DialogDescription>
          </div>
          {planToToggle && (
            <p className="mt-4 text-sm">
              {getATM(planToToggle)?.atmId || "ATM"} —{" "}
              {getMaintenanceLabel(planToToggle)}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPlanToToggle(null)}
              disabled={updatePlan.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={planToToggle?.isActive ? "destructive" : "default"}
              onClick={() => void confirmToggle()}
              disabled={updatePlan.isPending}
            >
              {updatePlan.isPending
                ? "Saving..."
                : planToToggle?.isActive
                  ? "Deactivate Plan"
                  : "Activate Plan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
