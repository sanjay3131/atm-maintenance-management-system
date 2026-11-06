import { useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { CalendarClock, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useCreateVehicleService,
  useVehicle,
  useVehicleReminders,
  useVehicleServicePolicy,
  useVehicles,
  useUpdateVehicleServicePolicy,
} from "@/features/vehicles/hooks/useVehicles";
import type { ServiceStatus } from "@/features/vehicles/types/vehicle.types";
import { findReminderForVehicle } from "@/features/vehicles/vehicle-ui.utils";

const controlClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const todayBusinessDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const serviceLabel: Record<ServiceStatus, string> = {
  UPCOMING: "Upcoming",
  DUE: "Due now",
  OVERDUE: "Overdue",
  POLICY_NOT_CONFIGURED: "Policy not configured",
};

function errorMessage(error: unknown) {
  if (isAxiosError<{ message?: string; code?: string }>(error)) {
    if (error.response?.data.code === "POLICY_VERSION_CONFLICT")
      return "The interval changed elsewhere. Refresh and retry.";
    if (error.response?.data.code === "REVISION_CONFLICT")
      return "The bike changed elsewhere. Refresh its details before saving.";
    return (
      error.response?.data.message ||
      "The service request could not be completed."
    );
  }
  return error instanceof Error
    ? error.message
    : "The service request could not be completed.";
}

export default function VehicleServiceManagementPage() {
  const vehiclesQuery = useVehicles({ page: 1, limit: 100 });
  const policyQuery = useVehicleServicePolicy();
  const remindersQuery = useVehicleReminders();
  const updatePolicy = useUpdateVehicleServicePolicy();
  const createService = useCreateVehicleService();
  const [intervalKm, setIntervalKm] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [serviceDate, setServiceDate] = useState(todayBusinessDate());
  const [serviceOdometerKm, setServiceOdometerKm] = useState("");
  const [notes, setNotes] = useState("");
  const selectedVehicleQuery = useVehicle(vehicleId || null);
  const policy = policyQuery.data?.activePolicy;
  const reminders = remindersQuery.data ?? [];

  const savePolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const interval = Number(intervalKm || policy?.intervalKm);
    if (!Number.isSafeInteger(interval) || interval <= 0) {
      toast.error("Enter a positive whole-kilometre service interval.");
      return;
    }
    try {
      await updatePolicy.mutateAsync({
        intervalKm: interval,
        expectedVersion: policy?.version ?? 0,
      });
      toast.success("Oil service interval saved.");
      setIntervalKm("");
      await policyQuery.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const saveService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const vehicle = selectedVehicleQuery.data;
    const reading = Number(serviceOdometerKm);
    if (!vehicle) {
      toast.error("Choose a bike and refresh its current odometer.");
      return;
    }
    if (
      !Number.isSafeInteger(reading) ||
      reading < vehicle.initialOdometerKm ||
      reading > vehicle.currentOdometerKm
    ) {
      toast.error(
        "Service reading must be a whole KM between the initial and current verified odometer.",
      );
      return;
    }
    try {
      await createService.mutateAsync({
        vehicleId,
        serviceDate,
        serviceOdometerKm: reading,
        expectedVehicleRevision: vehicle.revision,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast.success(
        "Oil service recorded; the previous reminder cycle was resolved.",
      );
      setServiceOdometerKm("");
      setNotes("");
      await Promise.all([
        selectedVehicleQuery.refetch(),
        vehiclesQuery.refetch(),
        remindersQuery.refetch(),
      ]);
    } catch (error) {
      toast.error(errorMessage(error));
      if (isAxiosError(error) && error.response?.status === 409)
        await selectedVehicleQuery.refetch();
    }
  };

  return (
    <main className="space-y-5 p-4 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Maintenance
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Oil service management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the fleet interval and preserve each verified service event.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Global oil-service interval</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {policyQuery.isLoading ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading policy…
              </p>
            ) : policyQuery.data?.configured && policy ? (
              <div className="rounded-md bg-muted/40 p-3 text-sm">
                <p>
                  Current interval:{" "}
                  <strong>
                    {policy.intervalKm.toLocaleString("en-IN")} KM
                  </strong>
                </p>
                <p className="mt-1 text-muted-foreground">
                  Policy version {policy.version} · Effective{" "}
                  {new Date(policy.effectiveFrom).toLocaleDateString("en-IN")}
                </p>
              </div>
            ) : (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                POLICY_NOT_CONFIGURED — reminders are paused until an interval
                is saved.
              </p>
            )}
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => void savePolicy(event)}
            >
              <label className="min-w-52 flex-1 space-y-1 text-sm font-medium">
                Interval (KM)
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  required
                  className={controlClass}
                  value={intervalKm || policy?.intervalKm || ""}
                  onChange={(event) => setIntervalKm(event.target.value)}
                />
              </label>
              <Button type="submit" disabled={updatePolicy.isPending}>
                {updatePolicy.isPending
                  ? "Saving…"
                  : policy
                    ? "Update interval"
                    : "Configure interval"}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              A new version is recorded for every change. Existing service
              history remains unchanged.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="size-5" /> Record completed oil service
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => void saveService(event)}
            >
              <label className="space-y-1 text-sm font-medium sm:col-span-2">
                Bike
                <select
                  required
                  className={controlClass}
                  value={vehicleId}
                  onChange={(event) => {
                    setVehicleId(event.target.value);
                    setServiceOdometerKm("");
                  }}
                >
                  <option value="">Select a bike</option>
                  {(vehiclesQuery.data?.vehicles ?? []).map((vehicle) => (
                    <option key={vehicle._id} value={vehicle._id}>
                      {vehicle.registrationNumber} · {vehicle.make}{" "}
                      {vehicle.model}
                    </option>
                  ))}
                </select>
              </label>
              {selectedVehicleQuery.data && (
                <p className="sm:col-span-2 text-xs text-muted-foreground">
                  Verified odometer:{" "}
                  {selectedVehicleQuery.data.currentOdometerKm.toLocaleString(
                    "en-IN",
                  )}{" "}
                  KM · Revision {selectedVehicleQuery.data.revision}
                </p>
              )}
              <label className="space-y-1 text-sm font-medium">
                Actual service date
                <input
                  required
                  type="date"
                  max={todayBusinessDate()}
                  className={controlClass}
                  value={serviceDate}
                  onChange={(event) => setServiceDate(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Service odometer (KM)
                <input
                  required
                  type="number"
                  min={selectedVehicleQuery.data?.initialOdometerKm ?? 0}
                  max={selectedVehicleQuery.data?.currentOdometerKm}
                  step="1"
                  inputMode="numeric"
                  className={controlClass}
                  value={serviceOdometerKm}
                  onChange={(event) => setServiceOdometerKm(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium sm:col-span-2">
                Notes
                <textarea
                  rows={2}
                  maxLength={2000}
                  className={`${controlClass} h-auto py-2`}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
              <div className="sm:col-span-2">
                <Button
                  type="submit"
                  disabled={!vehicleId || createService.isPending}
                >
                  {createService.isPending
                    ? "Recording…"
                    : "Record oil service"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-5" /> Fleet service status
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void Promise.all([
                vehiclesQuery.refetch(),
                remindersQuery.refetch(),
              ])
            }
          >
            <RefreshCw /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-184 text-left text-sm">
              <thead className="border-y bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Bike</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Current KM
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    Next due KM
                  </th>
                  <th className="px-4 py-3 font-medium">Service status</th>
                  <th className="px-4 py-3 font-medium">Timeline review</th>
                  <th className="px-4 py-3 font-medium">Reminder delivery</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(vehiclesQuery.data?.vehicles ?? []).map((vehicle) => {
                  const reminder = findReminderForVehicle(reminders, vehicle._id);
                  return (
                    <tr key={vehicle._id}>
                      <td className="px-4 py-3 font-medium">
                        {vehicle.registrationNumber} · {vehicle.make}{" "}
                        {vehicle.model}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {vehicle.currentOdometerKm.toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {vehicle.nextServiceOdometerKm?.toLocaleString(
                          "en-IN",
                        ) ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {serviceLabel[vehicle.serviceStatus]}
                      </td>
                      <td className="px-4 py-3">
                        {vehicle.serviceBaselineReviewRequired ? <span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-950">Review required</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {reminder
                          ? reminder.deliveryStatus.replaceAll("_", " ")
                          : "No active reminder"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {vehiclesQuery.data?.vehicles.length === 0 && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No registered bikes.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
