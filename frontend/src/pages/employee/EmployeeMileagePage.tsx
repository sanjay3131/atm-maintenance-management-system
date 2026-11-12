import { useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { Bike, Check, Gauge, RefreshCw, Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useCloseDailyMileage,
  useCompleteDailyMileageUsageSession,
  useCompleteVehicleSession,
  useCurrentVehicleSession,
  useDailyMileageHistory,
  useDailyMileageState,
  useHandoverDailyMileage,
  useJoinDailyMileage,
  useMyVehicleHistory,
  useStartDailyMileage,
  useStartDailyMileageUsageSession,
  useReopenDailyMileage,
} from "@/features/vehicles/hooks/useVehicles";
import {
  getStartingOdometerForVehicleSelection,
  parseStartingOdometer,
} from "@/features/vehicles/vehicle-ui.utils";
import {
  employeeErrorMessage,
  useEmployeeLanguage,
} from "@/features/employee-portal/i18n";
import type {
  VehicleUsageSession,
} from "@/features/vehicles/types/vehicle.types";

const controlClass =
  "h-12 w-full rounded-md border border-input bg-background px-3 text-base tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const businessDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const formatKm = (value: number | null | undefined) =>
  value == null ? "—" : value.toLocaleString("en-IN");

const legacyVehicle = (session: VehicleUsageSession) =>
  typeof session.vehicleId === "string" ? null : session.vehicleId;

function requestError(
  error: unknown,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
  language: "en" | "ta",
) {
  if (isAxiosError<{ message?: string }>(error)) {
    return employeeErrorMessage(
      error.response?.data?.message ?? "",
      "Could not save mileage. Refresh and review the current bike state.",
      language,
      t,
    );
  }
  return error instanceof Error
    ? error.message
    : t("Could not save mileage. Refresh and review the current bike state.");
}

export default function EmployeeMileagePage() {
  const { language, t } = useEmployeeLanguage();
  const stateQuery = useDailyMileageState();
  const historyQuery = useDailyMileageHistory();
  const legacySessionQuery = useCurrentVehicleSession();
  const legacyHistoryQuery = useMyVehicleHistory();
  const startMutation = useStartDailyMileage();
  const startUsageSessionMutation = useStartDailyMileageUsageSession();
  const completeUsageSessionMutation = useCompleteDailyMileageUsageSession();
  const joinMutation = useJoinDailyMileage();
  const handoverMutation = useHandoverDailyMileage();
  const closeMutation = useCloseDailyMileage();
  const reopenMutation = useReopenDailyMileage();
  const completeLegacyMutation = useCompleteVehicleSession();
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [startingOdometerKm, setStartingOdometerKm] = useState("");
  const [endingOdometerKm, setEndingOdometerKm] = useState("");
  const [sessionEndingOdometerKm, setSessionEndingOdometerKm] = useState("");
  const [sessionStartRequestId, setSessionStartRequestId] = useState<string | null>(null);
  const [sessionEndRequestId, setSessionEndRequestId] = useState<string | null>(null);
  const state = stateQuery.data;
  const current = state?.current ?? null;
  const activeSegment = current?.segments.find((segment) => segment.endedAt == null);
  const activeUsageSession = activeSegment?.usageSessions?.find(
    (usageSession) => usageSession.status === "IN_PROGRESS",
  );
  const legacyCurrent = legacySessionQuery.data ?? null;
  const selectedVehicle = state?.vehicles.find(
    (vehicle) => vehicle._id === selectedVehicleId,
  );
  const today = businessDate();
  const currentVehicleRevision =
    current?.vehicleRevision ?? current?.vehicle?.revision;
  const minimumEndingReading = Math.max(
    current?.latestOdometerKm ?? 0,
    current?.vehicle?.currentOdometerKm ?? 0,
  );
  const currentDateOpen = Boolean(current && current.businessDate === today);
  const dailyMutationPending =
    startMutation.isPending ||
    startUsageSessionMutation.isPending ||
    completeUsageSessionMutation.isPending ||
    joinMutation.isPending ||
    handoverMutation.isPending ||
    closeMutation.isPending ||
    reopenMutation.isPending;

  const refresh = async () => {
    await Promise.all([
      stateQuery.refetch(),
      historyQuery.refetch(),
      legacySessionQuery.refetch(),
      legacyHistoryQuery.refetch(),
    ]);
  };

  const startOrJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedVehicle) return;
    try {
      if (selectedVehicle.usageState === "HANDOVER") {
        if (!selectedVehicle.dailyMileageId || selectedVehicle.dailyMileageRevision == null) {
          toast.error(t("Refresh the bike list before joining this record."));
          return;
        }
        await joinMutation.mutateAsync({
          dailyMileageId: selectedVehicle.dailyMileageId,
          expectedVehicleRevision: selectedVehicle.revision,
          expectedDailyRevision: selectedVehicle.dailyMileageRevision,
        });
        toast.success(t("Your usage segment has started."));
      } else {
        const reading = parseStartingOdometer(
          startingOdometerKm,
          selectedVehicle.currentOdometerKm,
        );
        if (reading === null) {
          toast.error(t("Enter a whole-kilometre reading at or above the current odometer."));
          return;
        }
        await startMutation.mutateAsync({
          vehicleId: selectedVehicle._id,
          startingOdometerKm: reading,
          expectedVehicleRevision: selectedVehicle.revision,
        });
        toast.success(t("Daily mileage record started."));
      }
      setSelectedVehicleId("");
      setStartingOdometerKm("");
      await refresh();
    } catch (error) {
      toast.error(requestError(error, t, language));
      await stateQuery.refetch();
    }
  };

  const reopenRecord = async (
    record: NonNullable<typeof state>["reopenableRecords"][number],
  ) => {
    try {
      await reopenMutation.mutateAsync({
        dailyMileageId: record._id,
        expectedVehicleRevision: record.vehicleRevision,
        expectedDailyRevision: record.revision,
      });
      toast.success(t("Today's mileage record reopened."));
      await refresh();
    } catch (error) {
      toast.error(requestError(error, t, language));
      await stateQuery.refetch();
    }
  };

  const startUsageSession = async () => {
    if (!current || typeof currentVehicleRevision !== "number") return;
    const requestId = sessionStartRequestId ?? crypto.randomUUID();
    setSessionStartRequestId(requestId);
    try {
      await startUsageSessionMutation.mutateAsync({
        dailyMileageId: current._id,
        requestId,
        expectedVehicleRevision: currentVehicleRevision,
        expectedDailyRevision: current.revision,
      });
      setSessionStartRequestId(null);
      setSessionEndRequestId(null);
      toast.success(t("Usage session started."));
      await refresh();
    } catch (error) {
      toast.error(requestError(error, t, language));
      await stateQuery.refetch();
    }
  };

  const completeUsageSession = async () => {
    if (!current || typeof currentVehicleRevision !== "number") return;
    const reading = Number(sessionEndingOdometerKm);
    if (
      !Number.isSafeInteger(reading) ||
      reading < current.latestOdometerKm ||
      !activeUsageSession
    ) {
      toast.error(t("Ending reading cannot be below the latest verified odometer."));
      return;
    }
    const requestId = sessionEndRequestId ?? crypto.randomUUID();
    setSessionEndRequestId(requestId);
    try {
      await completeUsageSessionMutation.mutateAsync({
        dailyMileageId: current._id,
        requestId,
        endingOdometerKm: reading,
        expectedVehicleRevision: currentVehicleRevision,
        expectedDailyRevision: current.revision,
      });
      setSessionEndingOdometerKm("");
      setSessionStartRequestId(null);
      setSessionEndRequestId(null);
      toast.success(t("Usage session completed. You can start another session."));
      await refresh();
    } catch (error) {
      toast.error(requestError(error, t, language));
      await stateQuery.refetch();
    }
  };

  const finishSegment = async (action: "handover" | "close") => {
    if (!current || typeof currentVehicleRevision !== "number") return;
    const reading = Number(endingOdometerKm);
    if (!Number.isSafeInteger(reading) || reading < minimumEndingReading) {
      toast.error(t("Ending reading cannot be below the latest verified odometer."));
      return;
    }
    if (!currentDateOpen) {
      toast.error(t("This record crossed a business-date boundary and needs administrator review."));
      return;
    }
    try {
      const payload = {
        dailyMileageId: current._id,
        endingOdometerKm: reading,
        expectedVehicleRevision: currentVehicleRevision,
        expectedDailyRevision: current.revision,
      };
      if (action === "handover") {
        await handoverMutation.mutateAsync(payload);
        toast.success(t("Handover reading saved. The next employee can join at this reading."));
      } else {
        await closeMutation.mutateAsync(payload);
        toast.success(t("Daily mileage record closed."));
      }
      setEndingOdometerKm("");
      await refresh();
    } catch (error) {
      toast.error(requestError(error, t, language));
      await stateQuery.refetch();
    }
  };

  const completeLegacySession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!legacyCurrent) return;
    const reading = Number(endingOdometerKm);
    if (
      !Number.isSafeInteger(reading) ||
      reading < legacyCurrent.startOdometerKm
    ) {
      toast.error(t("Ending reading cannot be below the starting reading."));
      return;
    }
    const vehicle = legacyVehicle(legacyCurrent);
    if (typeof vehicle?.revision !== "number") {
      toast.error(t("Refresh the bike list before completing this historical session."));
      await legacySessionQuery.refetch();
      return;
    }
    try {
      await completeLegacyMutation.mutateAsync({
        sessionId: legacyCurrent._id,
        endingOdometerKm: reading,
        expectedVehicleRevision: vehicle.revision,
      });
      toast.success(t("Historical mileage session completed."));
      setEndingOdometerKm("");
      await refresh();
    } catch (error) {
      toast.error(requestError(error, t, language));
      await legacySessionQuery.refetch();
    }
  };

  if (stateQuery.isLoading || legacySessionQuery.isLoading) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-4 p-3 sm:p-6">
        <h1 className="text-2xl font-semibold">{t("Bike mileage")}</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground" role="status">
            {t("Loading daily mileage and active bikes...")}
          </CardContent>
        </Card>
      </main>
    );
  }

  if (stateQuery.isError) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-4 p-3 sm:p-6">
        <h1 className="text-2xl font-semibold">{t("Bike mileage")}</h1>
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <p className="text-sm text-destructive">
              {t("Could not load eligible bikes.")}
            </p>
            <Button variant="outline" onClick={() => void refresh()}>
              <RefreshCw /> {t("Retry")}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const vehicles = state?.vehicles ?? [];
  const availableVehicles = vehicles.filter(
    (vehicle) =>
      vehicle.usageState === "AVAILABLE" ||
      vehicle.usageState === "HANDOVER",
  );
  const rolloverPendingVehicles = vehicles.filter(
    (vehicle) => vehicle.usageState === "ROLLOVER_PENDING",
  );

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 p-3 pb-8 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("Daily bike mileage")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("One odometer record per bike each day. Your identity is taken from your signed-in account.")}
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()}>
          <RefreshCw /> {t("Refresh bike state")}
        </Button>
      </header>

      {rolloverPendingVehicles.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="font-medium">
              {t("A bike is awaiting midnight mileage recovery. Ask an administrator to recover it before anyone uses it again.")}
            </p>
            {rolloverPendingVehicles.map((vehicle) => (
              <p key={vehicle._id} className="text-sm text-muted-foreground">
                {vehicle.registrationNumber} · {t("Last verified odometer")}{" "}
                {formatKm(vehicle.latestOdometerKm)} KM
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {legacyCurrent && !current && (
        <Card className="border-amber-400">
          <CardHeader>
            <CardTitle>{t("Finish the open historical mileage session")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {legacyCurrent.vehicleRegistrationSnapshot} ·{" "}
              {t("Started at")} {formatKm(legacyCurrent.startOdometerKm)} KM
            </p>
            <form
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
              onSubmit={(event) => void completeLegacySession(event)}
            >
              <label className="space-y-1 text-sm font-medium">
                {t("Ending odometer (KM)")}
                <input
                  type="number"
                  min={legacyCurrent.startOdometerKm}
                  step="1"
                  inputMode="numeric"
                  required
                  className={controlClass}
                  value={endingOdometerKm}
                  onChange={(event) => setEndingOdometerKm(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                className="self-end"
                disabled={completeLegacyMutation.isPending}
              >
                <Check />
                {completeLegacyMutation.isPending
                  ? t("Saving...")
                  : t("Complete historical session")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {current ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bike className="size-5" /> {t("Today's open daily record")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 rounded-md bg-muted/40 p-4 sm:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">{t("Bike")}</p>
                <p className="mt-1 font-semibold">
                  {current.vehicleRegistrationSnapshot}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("Business date")}</p>
                <p className="mt-1 font-semibold tabular-nums">{current.businessDate}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("Starting odometer (KM)")}</p>
                <p className="mt-1 font-semibold tabular-nums">
                  {formatKm(current.startOdometerKm)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("Distance so far")}</p>
                <p className="mt-1 font-semibold tabular-nums">
                  {formatKm(current.latestOdometerKm - current.startOdometerKm)} KM
                </p>
              </div>
            </div>

            <section aria-labelledby="daily-segments-heading">
              <h2 id="daily-segments-heading" className="text-base font-semibold">
                {t("Employee usage segments")}
              </h2>
              <div className="mt-2 divide-y">
                {current.segments.map((segment, index) => (
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"
                    key={segment._id ?? `${segment.employeeId}-${index}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {segment.employeeNameSnapshot} · {segment.employeeCodeSnapshot}
                      </p>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {formatKm(segment.startOdometerKm)} →{" "}
                        {formatKm(segment.endOdometerKm)} KM
                      </p>
                      {(segment.usageSessions ?? []).map((usageSession) => (
                        <p
                          className="text-sm text-muted-foreground tabular-nums"
                          key={usageSession._id ?? usageSession.startRequestId}
                        >
                          {t("Session")}: {formatKm(usageSession.startOdometerKm)} →{" "}
                          {formatKm(usageSession.endOdometerKm)} KM ·{" "}
                          {usageSession.status === "IN_PROGRESS"
                            ? t("In progress")
                            : usageSession.status === "RECOVERY_REQUIRED"
                              ? t("Awaiting administrator recovery")
                              : formatKm(usageSession.distanceKm)}{" "}
                          {usageSession.status === "COMPLETED" ||
                          usageSession.status === "RECOVERED_COMPLETED"
                            ? "KM"
                            : ""}
                        </p>
                      ))}
                    </div>
                    <p className="font-semibold tabular-nums">
                      {formatKm(segment.distanceKm)} KM
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {currentDateOpen && activeSegment && (
              <section className="space-y-3 border-t pt-4">
                <h2 className="text-base font-semibold">{t("Usage sessions")}</h2>
                {activeUsageSession ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {t("Session started at")}{" "}
                      {formatKm(activeUsageSession.startOdometerKm)} KM
                    </p>
                    <label className="block space-y-1 text-sm font-medium">
                      {t("Session ending odometer (KM)")}
                      <input
                        type="number"
                        min={current.latestOdometerKm}
                        step="1"
                        inputMode="numeric"
                        required
                        className={controlClass}
                        value={sessionEndingOdometerKm}
                        onChange={(event) =>
                          setSessionEndingOdometerKm(event.target.value)
                        }
                      />
                    </label>
                    <Button
                      type="button"
                      disabled={dailyMutationPending || !sessionEndingOdometerKm}
                      onClick={() => void completeUsageSession()}
                    >
                      <Check /> {t("End usage session")}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    disabled={dailyMutationPending}
                    onClick={() => void startUsageSession()}
                  >
                    <Gauge /> {t("Start usage session")}
                  </Button>
                )}
              </section>
            )}

            {!currentDateOpen ? (
              <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-950">
                {t("This record crossed a business-date boundary. Handover and closing are paused until an administrator reviews it.")}
              </p>
            ) : (
              <section className="space-y-3 border-t pt-4">
                <h2 className="text-base font-semibold">{t("Record a handover or close")}</h2>
                <label className="block space-y-1 text-sm font-medium">
                  {t("Odometer reading (KM)")}
                  <input
                    type="number"
                    min={minimumEndingReading}
                    step="1"
                    inputMode="numeric"
                    required
                    className={controlClass}
                    value={endingOdometerKm}
                    onChange={(event) => setEndingOdometerKm(event.target.value)}
                  />
                </label>
                <p className="text-sm text-muted-foreground">
                  {t("The next employee starts at the same handover reading.")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={dailyMutationPending || !endingOdometerKm}
                    onClick={() => void finishSegment("handover")}
                  >
                    <Repeat2 /> {t("Hand over bike")}
                  </Button>
                  <Button
                    type="button"
                    disabled={dailyMutationPending || !endingOdometerKm}
                    onClick={() => void finishSegment("close")}
                  >
                    <Check /> {t("Close today's record")}
                  </Button>
                </div>
              </section>
            )}
          </CardContent>
        </Card>
      ) : !legacyCurrent ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-5" /> {t("Start or join a daily record")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {availableVehicles.length ? (
              <form className="space-y-4" onSubmit={(event) => void startOrJoin(event)}>
                <label className="block space-y-1 text-sm font-medium">
                  {t("Choose an active bike")}
                  <select
                    required
                    className={controlClass}
                    value={selectedVehicleId}
                    onChange={(event) => {
                    const vehicleId = event.target.value;
                    setSelectedVehicleId(vehicleId);
                    setStartingOdometerKm(
                      getStartingOdometerForVehicleSelection(
                        vehicleId,
                        state?.vehicles ?? [],
                      ),
                    );
                    }}
                  >
                    <option value="">{t("Choose a bike")}</option>
                    {vehicles.map((vehicle) => (
                      <option
                        key={vehicle._id}
                        value={vehicle._id}
                        disabled={
                          vehicle.usageState === "IN_USE" ||
                          vehicle.usageState === "CLOSED" ||
                          vehicle.usageState === "ROLLOVER_PENDING"
                        }
                      >
                        {vehicle.registrationNumber} ·{" "}
                        {vehicle.usageState === "HANDOVER"
                          ? `${t("Ready for handover")} · ${formatKm(vehicle.latestOdometerKm)} KM`
                          : vehicle.usageState === "CLOSED"
                            ? t("Today's record is closed")
                            : vehicle.usageState === "IN_USE"
                              ? t("Currently in use")
                              : vehicle.usageState === "ROLLOVER_PENDING"
                                ? t("Waiting for administrator recovery")
                              : `${formatKm(vehicle.currentOdometerKm)} KM`}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedVehicle?.usageState === "AVAILABLE" && (
                  <label className="block space-y-1 text-sm font-medium">
                    {t("Starting odometer (KM)")}
                    <input
                      type="number"
                      min={selectedVehicle.currentOdometerKm}
                      step="1"
                      inputMode="numeric"
                      required
                      className={controlClass}
                      value={startingOdometerKm}
                      onChange={(event) =>
                        setStartingOdometerKm(event.target.value)
                      }
                    />
                    <span className="block text-sm font-normal text-muted-foreground">
                      {t("Prefilled with the latest verified vehicle odometer.")}
                    </span>
                  </label>
                )}
                {selectedVehicle?.usageState === "HANDOVER" && (
                  <p className="rounded-md bg-muted/40 p-3 text-sm">
                    {t("The previous employee recorded a handover at")}{" "}
                    <strong className="tabular-nums">
                      {formatKm(selectedVehicle.latestOdometerKm)} KM
                    </strong>
                    . {t("Your segment will start at this same reading.")}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={
                    !selectedVehicle ||
                    !["AVAILABLE", "HANDOVER"].includes(
                      selectedVehicle.usageState,
                    ) ||
                    dailyMutationPending
                  }
                >
                  {dailyMutationPending
                    ? t("Saving...")
                    : selectedVehicle?.usageState === "HANDOVER"
                      ? t("Start using this bike")
                      : t("Start today's mileage record")}
                </Button>
              </form>
            ) : (
              <p className="rounded-md bg-muted/40 p-5 text-sm text-muted-foreground">
                {t("No active bikes are ready to start or join right now. Refresh after another employee hands over a bike.")}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {state?.reopenableRecords.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("Closed records for today")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {state.reopenableRecords.map((record) => (
              <div
                key={record._id}
                className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0"
              >
                <div>
                  <p className="font-medium">
                    {record.vehicleRegistrationSnapshot} · {record.businessDate}
                  </p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {t("Closed at")} {formatKm(record.endOdometerKm)} KM ·{" "}
                    {record.closedAt
                      ? new Intl.DateTimeFormat("en-IN", {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "Asia/Kolkata",
                        }).format(new Date(record.closedAt))
                      : "—"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={dailyMutationPending}
                  onClick={() => void reopenRecord(record)}
                >
                  {reopenMutation.isPending
                    ? t("Reopening...")
                    : t("Reopen today's record")}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t("Your daily mileage segments")}</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void Promise.all([historyQuery.refetch(), legacyHistoryQuery.refetch()])}
          >
            <RefreshCw /> {t("Refresh history")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {historyQuery.isError ? (
            <p className="py-3 text-sm text-destructive">
              {t("Could not load mileage history.")}
            </p>
          ) : historyQuery.isLoading ? (
            <p className="py-3 text-sm text-muted-foreground" role="status">
              {t("Loading mileage history...")}
            </p>
          ) : (
            (historyQuery.data?.records ?? []).map((record) => (
              <div key={record._id}>
                {record.segments.map((segment, index) => (
                  <div
                    key={`${record._id}-${segment._id ?? index}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b py-3 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {record.vehicleRegistrationSnapshot} ·{" "}
                        {segment.employeeNameSnapshot}
                      </p>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {record.businessDate} ·{" "}
                        {formatKm(segment.startOdometerKm)} →{" "}
                        {formatKm(segment.endOdometerKm)} KM ·{" "}
                        {t("Daily record")}
                      </p>
                    </div>
                    <p className="font-semibold tabular-nums">
                      {formatKm(segment.distanceKm)} KM
                    </p>
                  </div>
                ))}
                {record.auditHistory
                  ?.filter((event) =>
                    ["CLOSED", "REOPENED"].includes(event.action),
                  )
                  .map((event, index) => (
                    <p
                      key={`${record._id}-${event.action}-${event.occurredAt}-${index}`}
                      className="py-1 text-xs text-muted-foreground"
                    >
                      {t(
                        event.action === "CLOSED"
                          ? "Record closed"
                          : "Record reopened",
                      )}{" "}
                      ·{" "}
                      {event.employeeNameSnapshot ??
                        record.segments.find(
                          (segment) =>
                            segment.employeeId === event.employeeId,
                        )?.employeeNameSnapshot ??
                        t("Employee")}{" "}
                      ·{" "}
                      {new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "short",
                        timeStyle: "short",
                        timeZone: "Asia/Kolkata",
                      }).format(new Date(event.occurredAt))} ·{" "}
                      {formatKm(event.odometerKm)} KM
                    </p>
                  ))}
              </div>
            ))
          )}
          {!historyQuery.isLoading &&
            !historyQuery.isError &&
            historyQuery.data?.records.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">
                {t("No daily mileage segments yet.")}
              </p>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Historical mileage sessions (legacy)")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {legacyHistoryQuery.isError ? (
            <p className="py-3 text-sm text-destructive">
              {t("Could not load mileage history.")}
            </p>
          ) : (
            (legacyHistoryQuery.data?.sessions ?? []).map(
              (session: VehicleUsageSession) => (
                <div
                  key={session._id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b py-3 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {session.vehicleRegistrationSnapshot}
                    </p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {session.businessDate} · {formatKm(session.startOdometerKm)} →{" "}
                      {formatKm(session.endOdometerKm)} KM · {t("Legacy session")}
                    </p>
                  </div>
                  <p className="font-semibold tabular-nums">
                    {formatKm(session.distanceKm)} KM
                  </p>
                </div>
              ),
            )
          )}
          {!legacyHistoryQuery.isLoading &&
            !legacyHistoryQuery.isError &&
            (legacyHistoryQuery.data?.sessions ?? []).length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">
                {t("No historical mileage sessions.")}
              </p>
            )}
        </CardContent>
      </Card>
    </main>
  );
}
