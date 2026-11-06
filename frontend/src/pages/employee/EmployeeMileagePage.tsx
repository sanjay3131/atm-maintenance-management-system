import { useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { Bike, Check, Gauge, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useCompleteVehicleSession,
  useCurrentVehicleSession,
  useEligibleVehicles,
  useMyVehicleHistory,
  useStartVehicleSession,
} from "@/features/vehicles/hooks/useVehicles";
import {
  employeeErrorMessage,
  useEmployeeLanguage,
} from "@/features/employee-portal/i18n";
import type { VehicleUsageSession } from "@/features/vehicles/types/vehicle.types";
import {
  getEmployeeDefaultVehicleId,
  getPrefilledStartingOdometer,
} from "@/features/vehicles/vehicle-ui.utils";

const controlClass =
  "h-12 w-full rounded-md border border-input bg-background px-3 text-base tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function errorText(
  error: unknown,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
  language: "en" | "ta",
) {
  if (isAxiosError<{ message?: string; code?: string }>(error)) {
    if (error.response?.status === 409) {
      return t(
        "Could not save mileage. Refresh and review the current bike state.",
      );
    }
    return employeeErrorMessage(
      error.response?.data?.message ?? "",
      "Could not save mileage. Refresh and review the current bike state.",
      language,
      t,
    );
  }
  return t(
    "Could not save mileage. Refresh and review the current bike state.",
  );
}

const vehicleFromSession = (session: VehicleUsageSession) =>
  typeof session.vehicleId === "string" ? null : session.vehicleId;

export default function EmployeeMileagePage() {
  const { language, t } = useEmployeeLanguage();
  const eligibleQuery = useEligibleVehicles();
  const currentQuery = useCurrentVehicleSession();
  const historyQuery = useMyVehicleHistory();
  const startMutation = useStartVehicleSession();
  const completeMutation = useCompleteVehicleSession();
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [startReading, setStartReading] = useState<{ vehicleId: string; value: string } | null>(null);
  const [endKm, setEndKm] = useState("");

  const current = currentQuery.data;
  const currentVehicle = current ? vehicleFromSession(current) : null;
  const eligibleVehicles = eligibleQuery.data ?? [];
  const defaultVehicleId = getEmployeeDefaultVehicleId(eligibleVehicles);
  const effectiveVehicleId = selectedVehicleId || defaultVehicleId;
  const selectedVehicle = eligibleVehicles.find((vehicle) => vehicle._id === effectiveVehicleId);
  const startKm = startReading?.vehicleId === effectiveVehicleId
    ? startReading.value
    : getPrefilledStartingOdometer(selectedVehicle);
  const distance =
    current && endKm !== "" ? Number(endKm) - current.startOdometerKm : null;

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const bike = selectedVehicle;
    const reading = Number(startKm);
    if (!bike || !Number.isSafeInteger(reading) || reading < 0) {
      toast.error(t("Enter a valid whole-kilometre reading."));
      return;
    }
    try {
      await startMutation.mutateAsync({
        vehicleId: bike._id,
        startingOdometerKm: reading,
        expectedVehicleRevision: bike.revision,
      });
      toast.success(t("Mileage session started."));
      setStartReading(null);
      await Promise.all([
        currentQuery.refetch(),
        eligibleQuery.refetch(),
        historyQuery.refetch(),
      ]);
    } catch (error) {
      toast.error(errorText(error, t, language));
      await Promise.all([currentQuery.refetch(), eligibleQuery.refetch()]);
    }
  };

  const complete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!current || !currentVehicle) return;
    const reading = Number(endKm);
    if (!Number.isSafeInteger(reading) || reading < current.startOdometerKm) {
      toast.error(t("Ending reading cannot be below the starting reading."));
      return;
    }
    if (typeof currentVehicle.revision !== "number") {
      toast.error(
        t("Could not save mileage. Refresh and review the current bike state."),
      );
      await currentQuery.refetch();
      return;
    }
    try {
      await completeMutation.mutateAsync({
        sessionId: current._id,
        endingOdometerKm: reading,
        expectedVehicleRevision: currentVehicle.revision,
      });
      toast.success(t("Mileage session completed."));
      setEndKm("");
      await Promise.all([
        currentQuery.refetch(),
        eligibleQuery.refetch(),
        historyQuery.refetch(),
      ]);
    } catch (error) {
      toast.error(errorText(error, t, language));
      // Re-read the current revision; never blindly repeat a stale completion.
      await currentQuery.refetch();
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-3 pb-8 sm:p-6">
      <header className="border-b pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Field work
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{t("Bike mileage")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("The employee identity is taken from your signed-in account.")}
        </p>
      </header>

      {currentQuery.isLoading ? (
        <Card>
          <CardContent
            className="p-6 text-sm text-muted-foreground"
            role="status"
          >
            {t("Loading available bikes...")}
          </CardContent>
        </Card>
      ) : currentQuery.isError ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <p className="text-sm text-destructive">
              {t("Could not load eligible bikes.")}
            </p>
            <Button
              variant="outline"
              onClick={() => void currentQuery.refetch()}
            >
              <RefreshCw /> {t("Retry")}
            </Button>
          </CardContent>
        </Card>
      ) : current ? (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bike className="size-5" /> {t("Your active mileage session")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Bike</p>
                <p className="mt-1 font-semibold">
                  {current.vehicleRegistrationSnapshot}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("Starting odometer (KM)")}
                </p>
                <p className="mt-1 font-semibold tabular-nums">
                  {current.startOdometerKm.toLocaleString("en-IN")}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("Started")}</p>
                <p className="mt-1 font-medium">
                  {new Date(current.startedAt).toLocaleTimeString(
                    language === "ta" ? "ta-IN" : "en-IN",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Kolkata",
                    },
                  )}
                </p>
              </div>
            </div>
            <form
              className="space-y-3"
              onSubmit={(event) => void complete(event)}
            >
              <label className="block space-y-1 text-sm font-medium">
                {t("Ending odometer (KM)")}
                <input
                  type="number"
                  min={current.startOdometerKm}
                  step="1"
                  inputMode="numeric"
                  required
                  className={controlClass}
                  value={endKm}
                  onChange={(event) => setEndKm(event.target.value)}
                  placeholder={String(current.startOdometerKm)}
                />
              </label>
              {distance !== null &&
                Number.isSafeInteger(distance) &&
                distance >= 0 && (
                  <p className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <span>{t("Distance travelled")}</span>
                    <strong className="tabular-nums">
                      {distance.toLocaleString("en-IN")} {t("KM")}
                    </strong>
                  </p>
                )}
              <Button
                className="h-11 w-full sm:w-auto"
                type="submit"
                disabled={completeMutation.isPending || !endKm}
              >
                <Check />{" "}
                {completeMutation.isPending ? t("Saving...") : t("Return bike")}
              </Button>
            </form>
            {currentVehicle && (
              <p className="text-xs text-muted-foreground">
                Bike revision {currentVehicle.revision}. If another update
                changes the odometer, refresh and check the current reading
                before submitting again.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bike className="size-5" /> {t("Start mileage session")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {eligibleQuery.isLoading ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t("Loading available bikes...")}
              </p>
            ) : eligibleQuery.isError ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-destructive">
                  {t("Could not load eligible bikes.")}
                </p>
                <Button
                  variant="outline"
                  onClick={() => void eligibleQuery.refetch()}
                >
                  <RefreshCw /> {t("Retry")}
                </Button>
              </div>
            ) : eligibleQuery.data?.length ? (
              <form
                className="space-y-3"
                onSubmit={(event) => void start(event)}
              >
                <label className="block space-y-1 text-sm font-medium">
                  {t("Choose a bike")}
                  <select
                    required
                    className={controlClass}
                    value={effectiveVehicleId}
                    onChange={(event) => {
                      setSelectedVehicleId(event.target.value);
                      setStartReading(null);
                    }}
                  >
                    <option value="">{t("Choose a bike")}</option>
                    {eligibleVehicles.map((vehicle) => (
                      <option key={vehicle._id} value={vehicle._id}>
                        {vehicle.registrationNumber} · {vehicle.make}{" "}
                        {vehicle.model} ·{" "}
                        {vehicle.currentOdometerKm.toLocaleString("en-IN")}{" "}
                        {t("KM")}{vehicle.primaryAssignedToMe ? " · Primary bike" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {effectiveVehicleId && selectedVehicle && (
                  <label className="block space-y-1 text-sm font-medium">
                    {t("Starting odometer (KM)")}
                    <input
                      type="number"
                      min={selectedVehicle.currentOdometerKm}
                      step="1"
                      inputMode="numeric"
                      required
                      className={controlClass}
                      value={startKm}
                      onChange={(event) => setStartReading({ vehicleId: effectiveVehicleId, value: event.target.value })}
                    />
                  </label>
                )}
                <Button
                  className="h-11 w-full sm:w-auto"
                  type="submit"
                  disabled={!effectiveVehicleId || startMutation.isPending}
                >
                  <Gauge />{" "}
                  {startMutation.isPending
                    ? t("Starting...")
                    : t("Start mileage session")}
                </Button>
              </form>
            ) : (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t("No active bikes are available right now.")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t("Recent mileage")}</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void Promise.all([
                historyQuery.refetch(),
                currentQuery.refetch(),
                eligibleQuery.refetch(),
              ])
            }
          >
            <RefreshCw /> {t("Refresh bike state")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {(historyQuery.data?.sessions ?? []).map(
            (session: VehicleUsageSession) => (
              <div
                key={session._id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b py-2 last:border-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {session.vehicleRegistrationSnapshot}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {session.businessDate} · {session.startOdometerKm} →{" "}
                    {session.endOdometerKm ?? "—"} KM
                  </p>
                </div>
                <p className="font-semibold tabular-nums">
                  {session.distanceKm ?? "—"} KM
                </p>
              </div>
            ),
          )}
          {historyQuery.data?.sessions?.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              {t("No mileage history")}
            </p>
          )}
          {historyQuery.isError && (
            <p className="text-sm text-destructive">
              {t("Could not load mileage history.")}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
