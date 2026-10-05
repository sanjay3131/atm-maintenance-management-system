import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { isAxiosError } from "axios";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useATMs } from "@/features/atms/hooks/useATMs";
import { useCreateRecurringPlan } from "../hooks/useCreateRecurringPlan";
import { useUpdateRecurringPlan } from "../hooks/useUpdateRecurringPlan";
import {
  recurringMaintenanceFormSchema,
  type RecurringMaintenanceFormValues,
} from "../types/recurring-maintenance.schema";
import type {
  CreateRecurringMaintenancePlanData,
  RecurringMaintenancePlan,
  RecurringMaintenanceType,
  UpdateRecurringMaintenancePlanData,
} from "../types/recurring-maintenance.types";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MAINTENANCE_TYPES: {
  value: RecurringMaintenanceType;
  label: string;
}[] = [
  { value: "DAILY_CLEANING", label: "Daily Cleaning" },
  { value: "WEEKLY_MOPPING", label: "Weekly Mopping" },
];

function getIndiaDateInputValue(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value: partValue }) => [type, partValue]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Unable to save the recurring plan.";
  }
  return error instanceof Error
    ? error.message
    : "Unable to save the recurring plan.";
}

function getPlanATMId(plan: RecurringMaintenancePlan) {
  return typeof plan.atmId === "string" ? plan.atmId : plan.atmId._id;
}

interface RecurringPlanDialogProps {
  open: boolean;
  plan?: RecurringMaintenancePlan | null;
  onOpenChange: (open: boolean) => void;
}

export default function RecurringPlanDialog({
  open,
  plan,
  onOpenChange,
}: RecurringPlanDialogProps) {
  const isEditing = Boolean(plan);
  const [atmSearch, setAtmSearch] = useState("");
  const {
    data: atms = [],
    isLoading: atmsLoading,
    isError: atmsError,
    refetch: refetchATMs,
    isFetching: atmsFetching,
  } = useATMs();
  const createMutation = useCreateRecurringPlan();
  const updateMutation = useUpdateRecurringPlan();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<RecurringMaintenanceFormValues>({
    resolver: zodResolver(recurringMaintenanceFormSchema),
    defaultValues: {
      atmId: "",
      maintenanceType: "DAILY_CLEANING",
      startDate: getIndiaDateInputValue(),
      dayOfWeek: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      atmId: plan ? getPlanATMId(plan) : "",
      maintenanceType: plan?.maintenanceType ?? "DAILY_CLEANING",
      startDate: getIndiaDateInputValue(plan?.startDate) || getIndiaDateInputValue(),
      dayOfWeek:
        plan?.dayOfWeek === null || plan?.dayOfWeek === undefined
          ? ""
          : String(plan.dayOfWeek),
    });
    setAtmSearch("");
  }, [open, plan, reset]);

  const selectedType = watch("maintenanceType");
  const selectedAtmId = watch("atmId");
  const eligibleATMs = useMemo(
    () =>
      atms.filter(
        (atm) =>
          atm.status === "ACTIVE" || atm.status === "UNDER_MAINTENANCE",
      ),
    [atms],
  );
  const normalizedSearch = atmSearch.trim().toLowerCase();
  const maintenanceTypeRegistration = register("maintenanceType");
  const filteredATMs = eligibleATMs.filter((atm) =>
    [atm.atmId, atm.locationName, atm.districtId?.districtName]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(normalizedSearch)),
  );
  const selectedATM = eligibleATMs.find((atm) => atm._id === selectedAtmId);

  const onSubmit = async (values: RecurringMaintenanceFormValues) => {
    try {
      if (plan) {
        const data: UpdateRecurringMaintenancePlanData = {};
        if (values.startDate !== getIndiaDateInputValue(plan.startDate)) {
          data.startDate = values.startDate;
        }
        if (
          plan.maintenanceType === "WEEKLY_MOPPING" &&
          Number(values.dayOfWeek) !== plan.dayOfWeek
        ) {
          data.dayOfWeek = Number(values.dayOfWeek);
        }
        await updateMutation.mutateAsync({ planId: plan._id, data });
        toast.success("Recurring maintenance plan updated.");
      } else {
        const data: CreateRecurringMaintenancePlanData = {
          atmId: values.atmId,
          maintenanceType: values.maintenanceType,
          startDate: values.startDate,
          ...(values.maintenanceType === "WEEKLY_MOPPING"
            ? { dayOfWeek: Number(values.dayOfWeek) }
            : {}),
        };
        await createMutation.mutateAsync(data);
        toast.success("Recurring maintenance plan created.");
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <div className="space-y-2">
          <DialogTitle>
            {isEditing ? "Edit Recurring Plan" : "Create Recurring Plan"}
          </DialogTitle>
          <DialogDescription>
            Configure daily cleaning or weekly mopping for one ATM. Monthly
            deep cleaning remains in AMC.
          </DialogDescription>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
          {!isEditing && (
            <div>
              <label
                htmlFor="recurring-atm-search"
                className="mb-2 block text-sm font-medium"
              >
                ATM
              </label>
              <input
                id="recurring-atm-search"
                type="search"
                value={atmSearch}
                onChange={(event) => setAtmSearch(event.target.value)}
                placeholder="Search ATM ID, district, or location"
                className="mb-2 h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              {atmsLoading ? (
                <p className="text-sm text-muted-foreground">Loading ATMs...</p>
              ) : atmsError ? (
                <div className="rounded-md border border-destructive/30 p-3">
                  <p className="text-sm text-destructive">
                    Could not load ATMs.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={atmsFetching}
                    onClick={() => void refetchATMs()}
                  >
                    {atmsFetching ? "Retrying..." : "Retry"}
                  </Button>
                </div>
              ) : eligibleATMs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No eligible ATMs are available.
                </p>
              ) : (
                <select
                  id="recurring-atm"
                  {...register("atmId")}
                  aria-invalid={Boolean(errors.atmId)}
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">Select an eligible ATM</option>
                  {filteredATMs.map((atm) => (
                    <option key={atm._id} value={atm._id}>
                      {atm.atmId} — {atm.districtId?.districtName || "District"}{" "}
                      — {atm.locationName}
                    </option>
                  ))}
                </select>
              )}
              {errors.atmId && (
                <p className="mt-1 text-sm text-destructive">
                  {errors.atmId.message}
                </p>
              )}
              {normalizedSearch && filteredATMs.length === 0 && (
                <p className="mt-1 text-sm text-muted-foreground">
                  No eligible ATMs match this search.
                </p>
              )}
            </div>
          )}

          {isEditing ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p>
                <span className="font-medium">ATM:</span>{" "}
                {typeof plan?.atmId === "string"
                  ? plan.atmId
                  : `${plan?.atmId.atmId} — ${plan?.atmId.locationName}`}
              </p>
              <p className="mt-1">
                <span className="font-medium">Maintenance:</span>{" "}
                {plan?.maintenanceType === "DAILY_CLEANING"
                  ? "Daily Cleaning"
                  : "Weekly Mopping"}
              </p>
            </div>
          ) : (
            <div>
              <label
                htmlFor="recurring-maintenance-type"
                className="mb-2 block text-sm font-medium"
              >
                Maintenance Type
              </label>
              <select
                id="recurring-maintenance-type"
                {...maintenanceTypeRegistration}
                onChange={(event) => {
                  void maintenanceTypeRegistration.onChange(event);
                  if (event.target.value === "DAILY_CLEANING") {
                    setValue("dayOfWeek", "", { shouldValidate: true });
                  }
                }}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {MAINTENANCE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label
              htmlFor="recurring-start-date"
              className="mb-2 block text-sm font-medium"
            >
              Start Date
            </label>
            <input
              id="recurring-start-date"
              type="date"
              {...register("startDate")}
              aria-invalid={Boolean(errors.startDate)}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {errors.startDate && (
              <p className="mt-1 text-sm text-destructive">
                {errors.startDate.message}
              </p>
            )}
          </div>

          {selectedType === "WEEKLY_MOPPING" && (
            <div>
              <label
                htmlFor="recurring-day-of-week"
                className="mb-2 block text-sm font-medium"
              >
                Day of Week
              </label>
              <select
                id="recurring-day-of-week"
                value={watch("dayOfWeek")}
                onChange={(event) =>
                  setValue("dayOfWeek", event.target.value, {
                    shouldValidate: true,
                  })
                }
                aria-invalid={Boolean(errors.dayOfWeek)}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">Select a weekday</option>
                {WEEKDAYS.map((weekday, index) => (
                  <option key={weekday} value={String(index)}>
                    {weekday}
                  </option>
                ))}
              </select>
              {errors.dayOfWeek && (
                <p className="mt-1 text-sm text-destructive">
                  {errors.dayOfWeek.message}
                </p>
              )}
            </div>
          )}

          {selectedATM && (
            <p className="text-xs text-muted-foreground">
              Selected ATM: {selectedATM.atmId} —{" "}
              {selectedATM.locationName}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isPending ||
                (isEditing && !isDirty) ||
                (!isEditing &&
                  (atmsLoading || atmsError || eligibleATMs.length === 0))
              }
            >
              {isPending
                ? "Saving..."
                : isEditing
                  ? "Save Changes"
                  : "Create Plan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
