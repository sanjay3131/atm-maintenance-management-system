import { useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import {
  Bike,
  Plus,
  Search,
  Wrench,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useCreateVehicle,
  useVehicles,
} from "@/features/vehicles/hooks/useVehicles";
import type { VehicleListParams } from "@/services/vehicle.service";
import type { ServiceStatus } from "@/features/vehicles/types/vehicle.types";

const controlClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const serviceLabels: Record<ServiceStatus, string> = {
  UPCOMING: "Upcoming",
  DUE: "Due now",
  OVERDUE: "Overdue",
  POLICY_NOT_CONFIGURED: "Policy not configured",
};

const serviceTone: Record<ServiceStatus, string> = {
  UPCOMING: "bg-sky-50 text-sky-800",
  DUE: "bg-amber-50 text-amber-800",
  OVERDUE: "bg-rose-50 text-rose-800",
  POLICY_NOT_CONFIGURED: "bg-slate-100 text-slate-700",
};

function errorMessage(error: unknown) {
  if (isAxiosError<{ message?: string; code?: string }>(error)) {
    if (error.response?.data.code === "DUPLICATE_REGISTRATION")
      return "That registration is already in the fleet.";
    return (
      error.response?.data.message ||
      "The vehicle request could not be completed."
    );
  }
  return error instanceof Error
    ? error.message
    : "The vehicle request could not be completed.";
}

export default function VehiclesPage() {
  const [filters, setFilters] = useState<VehicleListParams>({
    page: 1,
    limit: 50,
  });
  const [showForm, setShowForm] = useState(false);
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [initialOdometerKm, setInitialOdometerKm] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [notes, setNotes] = useState("");
  const vehiclesQuery = useVehicles(filters);
  const createMutation = useCreateVehicle();
  const vehicles = vehiclesQuery.data?.vehicles ?? [];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const initial = Number(initialOdometerKm);
    if (!Number.isSafeInteger(initial) || initial < 0) {
      toast.error("Enter a non-negative whole-kilometre initial reading.");
      return;
    }
    try {
      await createMutation.mutateAsync({
        registrationNumber,
        make,
        model,
        initialOdometerKm: initial,
        ...(purchaseDate ? { purchaseDate } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast.success("Bike registered.");
      setShowForm(false);
      setRegistrationNumber("");
      setMake("");
      setModel("");
      setInitialOdometerKm("");
      setPurchaseDate("");
      setNotes("");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <main className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fleet
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Bikes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vehicles, primary assignments and live service status.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className={buttonVariants({ variant: "outline" })}
            to="/admin/vehicles/service-management"
          >
            <Wrench /> Service management
          </Link>
          <Link
            className={buttonVariants({ variant: "outline" })}
            to="/admin/vehicles/reports"
          >
            <FileSpreadsheet /> Mileage reports
          </Link>
          <Button onClick={() => setShowForm((value) => !value)}>
            <Plus /> Register bike
          </Button>
        </div>
      </header>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Register a bike</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
              onSubmit={submit}
            >
              <label className="space-y-1 text-sm font-medium">
                Registration number
                <input
                  required
                  maxLength={30}
                  className={controlClass}
                  value={registrationNumber}
                  onChange={(event) =>
                    setRegistrationNumber(event.target.value)
                  }
                  placeholder="TN 45 AB 1234"
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Make / brand
                <input
                  required
                  maxLength={100}
                  className={controlClass}
                  value={make}
                  onChange={(event) => setMake(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Model
                <input
                  required
                  maxLength={100}
                  className={controlClass}
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Initial odometer (KM)
                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  className={controlClass}
                  value={initialOdometerKm}
                  onChange={(event) => setInitialOdometerKm(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Purchase date (optional)
                <input
                  type="date"
                  className={controlClass}
                  value={purchaseDate}
                  onChange={(event) => setPurchaseDate(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium sm:col-span-2 xl:col-span-1">
                Notes
                <input
                  maxLength={2000}
                  className={controlClass}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
              <div className="flex gap-2 sm:col-span-2 xl:col-span-3">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Registering…" : "Save bike"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label className="relative block">
            <span className="sr-only">Search bikes</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className={`${controlClass} pl-9`}
              placeholder="Search registration, make or model"
              value={filters.search ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  search: event.target.value || undefined,
                }))
              }
            />
          </label>
          <select
            className={controlClass}
            aria-label="Filter by vehicle status"
            value={filters.status ?? "ALL"}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                page: 1,
                status:
                  event.target.value === "ALL"
                    ? undefined
                    : (event.target.value as VehicleListParams["status"]),
              }))
            }
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </CardContent>
      </Card>

      {vehiclesQuery.isLoading ? (
        <Card>
          <CardContent
            className="p-8 text-sm text-muted-foreground"
            role="status"
          >
            Loading bikes…
          </CardContent>
        </Card>
      ) : vehiclesQuery.isError ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <p className="text-sm text-destructive">
              {errorMessage(vehiclesQuery.error)}
            </p>
            <Button
              variant="outline"
              onClick={() => void vehiclesQuery.refetch()}
            >
              <RefreshCw /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : vehicles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Bike className="size-8 text-muted-foreground" />
            <p className="font-medium">No bikes match this view.</p>
            <p className="text-sm text-muted-foreground">
              Register a bike or adjust the search and status filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Fleet</CardTitle>
            <span className="text-sm text-muted-foreground">
              {vehiclesQuery.data?.pagination.total ?? vehicles.length} bikes
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-232 text-left text-sm">
                <thead className="border-y bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Registration</th>
                    <th className="px-4 py-3 font-medium">Bike</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Current KM
                    </th>
                    <th className="px-4 py-3 font-medium">Primary employee</th>
                    <th className="px-4 py-3 font-medium">Next service</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {vehicles.map((vehicle) => {
                    const assignee = vehicle.primaryAssignedEmployeeId;
                    return (
                      <tr key={vehicle._id}>
                        <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums">
                          {vehicle.registrationNumber}
                        </td>
                        <td className="px-4 py-3">
                          {vehicle.make} {vehicle.model}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {vehicle.currentOdometerKm.toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-3">
                          {assignee ? (
                            `${assignee.userId?.firstName ?? ""} ${assignee.userId?.lastName ?? ""}`.trim()
                          ) : (
                            <span className="text-muted-foreground">
                              Unassigned
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="tabular-nums">
                            {vehicle.nextServiceOdometerKm?.toLocaleString(
                              "en-IN",
                            ) ?? "—"}
                          </div>
                          <span
                            className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${serviceTone[vehicle.serviceStatus]}`}
                          >
                            {serviceLabels[vehicle.serviceStatus]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${vehicle.status === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}
                          >
                            {vehicle.status === "ACTIVE"
                              ? "Active"
                              : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            className={buttonVariants({
                              size: "sm",
                              variant: "outline",
                            })}
                            to={`/admin/vehicles/${vehicle._id}`}
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(vehiclesQuery.data?.pagination.totalPages ?? 1) > 1 && (
              <div className="flex justify-end gap-2 p-4">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(filters.page ?? 1) <= 1}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      page: (current.page ?? 1) - 1,
                    }))
                  }
                >
                  Previous
                </Button>
                <span className="self-center text-sm text-muted-foreground">
                  Page {filters.page} of{" "}
                  {vehiclesQuery.data?.pagination.totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    (filters.page ?? 1) >=
                    (vehiclesQuery.data?.pagination.totalPages ?? 1)
                  }
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      page: (current.page ?? 1) + 1,
                    }))
                  }
                >
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
