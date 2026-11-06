import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { ArrowLeft, Bike, Check, Gauge, RefreshCw, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useAssignVehicle,
  useCorrectVehicleOdometer,
  useRecoverVehicleSession,
  useReviewVehicleServiceConflict,
  useUnassignVehicle,
  useUpdateVehicle,
  useUpdateVehicleStatus,
  useVehicle,
  useVehicleServices,
  useVehicleOdometerCorrections,
  useVehicles,
} from "@/features/vehicles/hooks/useVehicles";
import { useEmployeeOptions } from "@/features/employees/hooks/useEmployeeOptions";
import { transferVehicleAssignment } from "@/services/vehicle.service";
import {
  getOdometerCorrectionSuccessMessage,
  resolveVehicleEditDraft,
  type VehicleEditDraft,
} from "@/features/vehicles/vehicle-ui.utils";
import type { VehicleUsageSession } from "@/features/vehicles/types/vehicle.types";

const controlClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function errorMessage(error: unknown) {
  if (isAxiosError<{ message?: string; code?: string }>(error)) {
    if (error.response?.data.code === "REVISION_CONFLICT")
      return "This bike changed elsewhere. Refresh and review the current state before retrying.";
    return (
      error.response?.data.message ||
      "The vehicle request could not be completed."
    );
  }
  return error instanceof Error
    ? error.message
    : "The vehicle request could not be completed.";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeZone: "Asia/Kolkata",
      }).format(date);
}

export default function VehicleDetailsPage() {
  const { vehicleId = "" } = useParams();
  const vehicleQuery = useVehicle(vehicleId);
  const servicesQuery = useVehicleServices(vehicleId);
  const correctionsQuery = useVehicleOdometerCorrections(vehicleId);
  const activeVehiclesQuery = useVehicles({
    page: 1,
    limit: 100,
    status: "ACTIVE",
  });
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeePage, setEmployeePage] = useState(1);
  const employeeOptionsQuery = useEmployeeOptions(employeeSearch, employeePage, true, true);
  const updateMutation = useUpdateVehicle();
  const statusMutation = useUpdateVehicleStatus();
  const assignMutation = useAssignVehicle();
  const unassignMutation = useUnassignVehicle();
  const correctionMutation = useCorrectVehicleOdometer();
  const recoveryMutation = useRecoverVehicleSession();
  const serviceReviewMutation = useReviewVehicleServiceConflict();

  const vehicle = vehicleQuery.data;
  const [editDraft, setEditDraft] = useState<VehicleEditDraft | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [targetVehicleId, setTargetVehicleId] = useState("");
  const [reason, setReason] = useState("");
  const [correctedOdometerKm, setCorrectedOdometerKm] = useState("");
  const [correctionSessionId, setCorrectionSessionId] = useState("");
  const [correctionField, setCorrectionField] = useState<"START" | "END">("END");
  const [verifiedEndOdometerKm, setVerifiedEndOdometerKm] = useState("");
  const [recoveryReason, setRecoveryReason] = useState("");
  const [serviceReviewReasons, setServiceReviewReasons] = useState<Record<string, string>>({});

  const draft = vehicle ? resolveVehicleEditDraft(vehicle, editDraft) : null;

  const saveVehicle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await updateMutation.mutateAsync({
        vehicleId,
        payload: {
          registrationNumber: draft?.registrationNumber,
          make: draft?.make,
          model: draft?.model,
          notes: draft?.notes,
        },
      });
      toast.success("Bike details updated.");
      await vehicleQuery.refetch();
      setEditDraft(null);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const assign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!vehicle || !employeeId) return;
    try {
      await assignMutation.mutateAsync({
        vehicleId,
        employeeId,
        expectedVehicleRevision: vehicle.revision,
      });
      toast.success("Primary bike assignment saved.");
      setEmployeeId("");
      await vehicleQuery.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const unassign = async () => {
    if (!vehicle) return;
    try {
      await unassignMutation.mutateAsync({
        vehicleId,
        expectedVehicleRevision: vehicle.revision,
        reason: "Administrative unassignment",
      });
      toast.success("Primary assignment released.");
      await vehicleQuery.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const transfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!vehicle?.primaryAssignedEmployeeId || !targetVehicleId) return;
    const target = activeVehiclesQuery.data?.vehicles.find(
      (item) => item._id === targetVehicleId,
    );
    if (!target) {
      toast.error("Refresh the active bike list and choose a target bike.");
      return;
    }
    try {
      await transferVehicleAssignment({
        employeeId: vehicle.primaryAssignedEmployeeId._id,
        sourceVehicleId: vehicle._id,
        targetVehicleId: target._id,
        expectedSourceRevision: vehicle.revision,
        expectedTargetRevision: target.revision,
        reason: "Administrative transfer",
      });
      toast.success("Primary assignment transferred.");
      setTargetVehicleId("");
      await Promise.all([
        vehicleQuery.refetch(),
        activeVehiclesQuery.refetch(),
      ]);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const changeStatus = async () => {
    if (!vehicle) return;
    const status = vehicle.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await statusMutation.mutateAsync({
        vehicleId,
        status,
        expectedVehicleRevision: vehicle.revision,
      });
      toast.success(
        status === "ACTIVE" ? "Bike activated." : "Bike deactivated.",
      );
      await vehicleQuery.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const correctOdometer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!vehicle) return;
    const reading = Number(correctedOdometerKm);
    const targetSession = sessions.find((session) => session._id === correctionSessionId);
    const minimumReading = targetSession
      ? correctionField === "START" ? vehicle.initialOdometerKm : targetSession.startOdometerKm
      : vehicle.currentOdometerKm;
    const maximumReading = targetSession && correctionField === "START"
      ? targetSession.endOdometerKm ?? Number.MAX_SAFE_INTEGER
      : undefined;
    if (!Number.isSafeInteger(reading) || reading < minimumReading || (maximumReading !== undefined && reading > maximumReading) || !reason.trim()) {
      toast.error(
        targetSession
          ? "Corrected session reading must remain valid for the session and include a reason."
          : "Current odometer corrections cannot decrease the verified reading and require a reason.",
      );
      return;
    }
    try {
      const result = await correctionMutation.mutateAsync({
        vehicleId,
        correctedOdometerKm: reading,
        expectedVehicleRevision: vehicle.revision,
        reason: reason.trim(),
        ...(targetSession ? { usageSessionId: targetSession._id, correctedField: correctionField } : {}),
      });
      toast.success(
        getOdometerCorrectionSuccessMessage({
          historical: Boolean(targetSession),
          timelineReviewRequired: result.timelineReviewRequired,
        }),
      );
      setCorrectedOdometerKm("");
      setReason("");
      await Promise.all([vehicleQuery.refetch(), correctionsQuery.refetch()]);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const reviewService = async (
    event: FormEvent<HTMLFormElement>,
    serviceId: string,
  ) => {
    event.preventDefault();
    if (!vehicle) return;
    const reviewReason = serviceReviewReasons[serviceId]?.trim() ?? "";
    if (!reviewReason) {
      toast.error("Enter why this service record was reviewed.");
      return;
    }
    try {
      const result = await serviceReviewMutation.mutateAsync({
        vehicleId,
        serviceId,
        expectedVehicleRevision: vehicle.revision,
        reason: reviewReason,
      });
      toast.success(
        result.timelineReviewRequired
          ? "Service record review saved. Other timeline conflicts remain; reminders are paused."
          : "Service record reviewed. Reminder calculations resumed.",
      );
      setServiceReviewReasons((current) => ({ ...current, [serviceId]: "" }));
      await Promise.all([vehicleQuery.refetch(), servicesQuery.refetch()]);
    } catch (error) {
      toast.error(errorMessage(error));
      await vehicleQuery.refetch();
    }
  };

  const recover = async (
    session: VehicleUsageSession,
    action: "RECOVERED_COMPLETED" | "CANCELLED",
    expectedVehicleRevision: number,
  ) => {
    const reading = Number(verifiedEndOdometerKm);
    if (!Number.isSafeInteger(reading) || !recoveryReason.trim()) {
      toast.error(
        "Enter a whole-kilometre verified reading and a recovery reason.",
      );
      return;
    }
    if (action === "CANCELLED" && reading !== session.startOdometerKm) {
      toast.error(
        "Cancellation requires the verified reading to equal the session opening reading.",
      );
      return;
    }
    if (action === "RECOVERED_COMPLETED" && reading < session.startOdometerKm) {
      toast.error("Closing reading cannot be below the opening reading.");
      return;
    }
    try {
      await recoveryMutation.mutateAsync({
        sessionId: session._id,
        action,
        verifiedEndOdometerKm: reading,
        expectedVehicleRevision,
        reason: recoveryReason.trim(),
      });
      toast.success(
        action === "CANCELLED"
          ? "Mileage session cancelled."
          : "Mileage session recovered and completed.",
      );
      setVerifiedEndOdometerKm("");
      setRecoveryReason("");
      await Promise.all([vehicleQuery.refetch(), servicesQuery.refetch()]);
    } catch (error) {
      toast.error(errorMessage(error));
      await vehicleQuery.refetch();
    }
  };

  if (vehicleQuery.isLoading)
    return (
      <main className="p-6" role="status">
        Loading bike…
      </main>
    );
  if (vehicleQuery.isError || !vehicle)
    return (
      <main className="space-y-4 p-6">
        <p className="text-destructive">{errorMessage(vehicleQuery.error)}</p>
        <Button variant="outline" onClick={() => void vehicleQuery.refetch()}>
          <RefreshCw /> Retry
        </Button>
      </main>
    );

  const employeeOptions = employeeOptionsQuery.data?.employees ?? [];
  const assignments = vehicle.assignments ?? [];
  const sessions = vehicle.mileageHistory ?? [];
  const services = servicesQuery.data?.services ?? vehicle.services ?? [];
  const corrections = correctionsQuery.data?.corrections ?? [];
  const reminder = vehicle.reminders?.[0];

  return (
    <main className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            to="/admin/vehicles"
          >
            <ArrowLeft className="size-4" /> Fleet
          </Link>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Bike details
          </p>
          <h1 className="mt-1 text-2xl font-semibold tabular-nums">
            {vehicle.registrationNumber}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {vehicle.make} {vehicle.model} · Revision {vehicle.revision}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void vehicleQuery.refetch()}>
            <RefreshCw /> Refresh
          </Button>
          <Button
            variant={vehicle.status === "ACTIVE" ? "destructive" : "default"}
            disabled={statusMutation.isPending}
            onClick={() => void changeStatus()}
          >
            {vehicle.status === "ACTIVE"
              ? "Deactivate bike"
              : "Reactivate bike"}
          </Button>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bike className="size-5" /> Vehicle information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 border-b pb-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Current odometer</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">
                  {vehicle.currentOdometerKm.toLocaleString("en-IN")} KM
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Verified odometer</dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {vehicle.currentOdometerKm.toLocaleString("en-IN")} KM
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Next oil service</dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {vehicle.nextServiceOdometerKm?.toLocaleString("en-IN") ??
                    "Not configured"}{" "}
                  {vehicle.nextServiceOdometerKm ? "KM" : ""}
                </dd>
              </div>
            </dl>
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => void saveVehicle(event)}
            >
              <label className="space-y-1 text-sm font-medium">
                Registration
                <input
                  required
                  className={controlClass}
                  value={draft?.registrationNumber ?? ""}
                  onChange={(event) =>
                    setEditDraft({ ...draft!, registrationNumber: event.target.value })
                  }
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Make
                <input
                  required
                  className={controlClass}
                  value={draft?.make ?? ""}
                  onChange={(event) => setEditDraft({ ...draft!, make: event.target.value })}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Model
                <input
                  required
                  className={controlClass}
                  value={draft?.model ?? ""}
                  onChange={(event) => setEditDraft({ ...draft!, model: event.target.value })}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Notes
                <input
                  className={controlClass}
                  value={draft?.notes ?? ""}
                  onChange={(event) => setEditDraft({ ...draft!, notes: event.target.value })}
                />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending
                    ? "Saving…"
                    : "Save vehicle details"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="size-5" /> Oil service status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                Service status
              </span>
              <span
                className={`rounded-full px-3 py-1 text-sm font-semibold ${vehicle.serviceStatus === "OVERDUE" ? "bg-rose-50 text-rose-800" : vehicle.serviceStatus === "DUE" ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800"}`}
              >
                {vehicle.serviceStatus.replaceAll("_", " ")}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/40 p-3 text-sm">
              <div>
                <p className="text-muted-foreground">Next due</p>
                <p className="mt-1 font-semibold tabular-nums">
                  {vehicle.nextServiceOdometerKm?.toLocaleString("en-IN") ??
                    "—"}{" "}
                  KM
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Delivery</p>
                <p className="mt-1 font-semibold">
                  {reminder?.deliveryStatus?.replaceAll("_", " ") ??
                    "No active reminder"}
                </p>
              </div>
            </div>
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/vehicles/service-management"
            >
              Manage service policy
            </Link>
          </CardContent>
        </Card>
      </div>

      {vehicle.serviceBaselineReviewRequired && <Card className="border-amber-400 bg-amber-50/60">
        <CardContent className="p-4 text-sm text-amber-950">
          <p className="font-semibold">Service baseline review required</p>
          <p className="mt-1">A historical mileage or service record conflicts with the verified timeline. Reminder calculations are paused until the conflicting service history is reviewed.</p>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader>
          <CardTitle>Primary assignment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {vehicle.primaryAssignedEmployeeId ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="font-medium">
                  {vehicle.primaryAssignedEmployeeId.userId?.firstName}{" "}
                  {vehicle.primaryAssignedEmployeeId.userId?.lastName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {vehicle.primaryAssignedEmployeeId.employeeCode}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={unassignMutation.isPending}
                onClick={() => void unassign()}
              >
                Release assignment
              </Button>
            </div>
          ) : (
            <form
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
              onSubmit={(event) => void assign(event)}
            >
              <label className="space-y-1 text-sm font-medium">
                Assign primary employee
                <input
                  type="search"
                  className={`${controlClass} mb-2`}
                  placeholder="Search active employees"
                  value={employeeSearch}
                  onChange={(event) => {
                    setEmployeeSearch(event.target.value);
                    setEmployeePage(1);
                  }}
                />
                <select
                  required
                  className={controlClass}
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                >
                  <option value="">Choose an active employee</option>
                  {employeeOptions.map((employee) => (
                    <option key={employee._id} value={employee._id}>
                      {employee.firstName} {employee.lastName} ·{" "}
                      {employee.employeeCode}
                    </option>
                  ))}
                </select>
                {employeeOptionsQuery.data && employeeOptionsQuery.data.pagination.totalPages > 1 && (
                  <span className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <Button type="button" size="sm" variant="outline" disabled={employeePage <= 1} onClick={() => setEmployeePage((page) => page - 1)}>Previous</Button>
                    <span>Page {employeePage} of {employeeOptionsQuery.data.pagination.totalPages}</span>
                    <Button type="button" size="sm" variant="outline" disabled={employeePage >= employeeOptionsQuery.data.pagination.totalPages} onClick={() => setEmployeePage((page) => page + 1)}>Next</Button>
                  </span>
                )}
              </label>
              <Button
                className="self-end"
                type="submit"
                disabled={!employeeId || assignMutation.isPending}
              >
                Assign bike
              </Button>
            </form>
          )}
          {vehicle.primaryAssignedEmployeeId && vehicle.status === "ACTIVE" && (
            <form
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
              onSubmit={(event) => void transfer(event)}
            >
              <label className="space-y-1 text-sm font-medium">
                Transfer this employee to another available bike
                <select
                  required
                  className={controlClass}
                  value={targetVehicleId}
                  onChange={(event) => setTargetVehicleId(event.target.value)}
                >
                  <option value="">Choose an active target</option>
                  {(activeVehiclesQuery.data?.vehicles ?? [])
                    .filter(
                      (target) =>
                        target._id !== vehicle._id &&
                        !target.primaryAssignedEmployeeId,
                    )
                    .map((target) => (
                      <option key={target._id} value={target._id}>
                        {target.registrationNumber} · {target.make}{" "}
                        {target.model}
                      </option>
                    ))}
                </select>
              </label>
              <Button
                className="self-end"
                type="submit"
                disabled={!targetVehicleId}
              >
                Transfer assignment
              </Button>
            </form>
          )}
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-semibold">Assignment history</p>
            {assignments.length ? (
              assignments.map((assignment, index) => {
                const entry = assignment as {
                  _id?: string;
                  employeeId?: {
                    employeeCode?: string;
                    userId?: { firstName?: string; lastName?: string };
                  };
                  assignedAt?: string;
                  unassignedAt?: string | null;
                };
                return (
                  <div
                    className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm last:border-0"
                    key={entry._id ?? index}
                  >
                    <span>
                      {entry.employeeId?.userId?.firstName}{" "}
                      {entry.employeeId?.userId?.lastName} ·{" "}
                      {entry.employeeId?.employeeCode}
                    </span>
                    <span className="text-muted-foreground">
                      {entry.assignedAt
                        ? new Date(entry.assignedAt).toLocaleDateString("en-IN")
                        : "—"}{" "}
                      –{" "}
                      {entry.unassignedAt
                        ? new Date(entry.unassignedAt).toLocaleDateString(
                            "en-IN",
                          )
                        : "Current"}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">
                No primary assignment history.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="size-5" /> Audited odometer correction
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-[minmax(12rem,1fr)_9rem_12rem_minmax(0,1fr)_auto]"
            onSubmit={(event) => void correctOdometer(event)}
          >
            <label className="space-y-1 text-sm font-medium">
              Reading to correct
              <select className={controlClass} value={correctionSessionId} onChange={(event) => setCorrectionSessionId(event.target.value)}>
                <option value="">Current vehicle odometer</option>
                {sessions.filter((session) => session.status === "COMPLETED").map((session) => <option key={session._id} value={session._id}>{session.employeeNameSnapshot} · {session.businessDate} · {session.startOdometerKm}–{session.endOdometerKm} KM</option>)}
              </select>
            </label>
            {correctionSessionId && <label className="space-y-1 text-sm font-medium">
              Field
              <select className={controlClass} value={correctionField} onChange={(event) => setCorrectionField(event.target.value as "START" | "END")}>
                <option value="START">Starting KM</option>
                <option value="END">Ending KM</option>
              </select>
            </label>}
            <label className="space-y-1 text-sm font-medium">
              Corrected KM
              <input
                type="number"
                min={correctionSessionId ? correctionField === "START" ? vehicle.initialOdometerKm : sessions.find((session) => session._id === correctionSessionId)?.startOdometerKm : vehicle.currentOdometerKm}
                max={correctionSessionId && correctionField === "START" ? sessions.find((session) => session._id === correctionSessionId)?.endOdometerKm ?? undefined : undefined}
                step="1"
                inputMode="numeric"
                required
                className={controlClass}
                value={correctedOdometerKm}
                onChange={(event) => setCorrectedOdometerKm(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Reason
              <input
                required
                minLength={1}
                maxLength={1000}
                className={controlClass}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <Button
              className="self-end"
              type="submit"
              disabled={correctionMutation.isPending}
            >
              Record correction
            </Button>
          </form>
        </CardContent>
      </Card>

      {sessions.some((session) => session.status === "IN_PROGRESS") && (
        <Card>
          <CardHeader>
            <CardTitle>Recover interrupted mileage session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sessions
              .filter((session) => session.status === "IN_PROGRESS")
              .map((session) => (
                <form
                  key={session._id}
                  className="grid gap-3 border-b pb-4 last:border-0 sm:grid-cols-2"
                  onSubmit={(event) => event.preventDefault()}
                >
                  <div className="sm:col-span-2">
                    <p className="font-medium">
                      {session.employeeNameSnapshot} · opened at{" "}
                      {session.startOdometerKm} KM
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Started {formatDate(session.startedAt)}
                    </p>
                  </div>
                  <label className="space-y-1 text-sm font-medium">
                    Physically verified ending KM
                    <input
                      type="number"
                      min={session.startOdometerKm}
                      step="1"
                      className={controlClass}
                      value={verifiedEndOdometerKm}
                      onChange={(event) =>
                        setVerifiedEndOdometerKm(event.target.value)
                      }
                    />
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    Mandatory recovery reason
                    <input
                      className={controlClass}
                      value={recoveryReason}
                      onChange={(event) =>
                        setRecoveryReason(event.target.value)
                      }
                    />
                  </label>
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <Button
                      type="button"
                      disabled={recoveryMutation.isPending}
                      onClick={() =>
                        void recover(
                          session,
                          "RECOVERED_COMPLETED",
                          vehicle.revision,
                        )
                      }
                    >
                      Recover as completed
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={recoveryMutation.isPending}
                      onClick={() =>
                        void recover(session, "CANCELLED", vehicle.revision)
                      }
                    >
                      Cancel (no movement)
                    </Button>
                  </div>
                </form>
              ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Oil service history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {services.map((service) => (
              <div
                key={service._id}
                className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm last:border-0"
              >
                <span className="font-medium tabular-nums">
                  {service.serviceOdometerKm.toLocaleString("en-IN")} KM
                </span>
                <span>{formatDate(service.serviceDate)}</span>
                <span className="text-muted-foreground">
                  {service.notes || "Oil change"}
                </span>
                {service.timelineReviewRequired && <span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-950">Review required: {service.timelineReviewReason}</span>}
                {service.timelineReviewRequired && (
                  <form
                    className="grid w-full gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                    onSubmit={(event) => void reviewService(event, service._id)}
                  >
                    <label className="space-y-1 text-xs font-medium">
                      Review reason
                      <input
                        required
                        maxLength={1000}
                        className={controlClass}
                        value={serviceReviewReasons[service._id] ?? ""}
                        onChange={(event) =>
                          setServiceReviewReasons((current) => ({
                            ...current,
                            [service._id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <Button
                      className="self-end"
                      type="submit"
                      variant="outline"
                      disabled={
                        serviceReviewMutation.isPending ||
                        !serviceReviewReasons[service._id]?.trim()
                      }
                    >
                      <Check /> Confirm reviewed record
                    </Button>
                  </form>
                )}
                {service.timelineReviewHistory?.map((entry, index) => {
                  const reviewer =
                    typeof entry.reviewedBy === "object"
                      ? [entry.reviewedBy.firstName, entry.reviewedBy.lastName]
                          .filter(Boolean)
                          .join(" ")
                      : entry.reviewedBy;
                  return (
                    <span
                      key={`${service._id}-review-${index}`}
                      className="w-full text-xs text-muted-foreground"
                    >
                      Reviewed {formatDate(entry.reviewedAt)}
                      {reviewer ? ` by ${reviewer}` : ""}: {entry.reason}
                    </span>
                  );
                })}
              </div>
            ))}
            {!services.length && (
              <p className="text-sm text-muted-foreground">
                No oil service records yet.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent mileage history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session._id}
                className="grid grid-cols-[1fr_auto] gap-2 border-b pb-2 text-sm last:border-0"
              >
                <div>
                  <p className="font-medium">{session.employeeNameSnapshot}</p>
                  <p className="text-muted-foreground">
                    {session.businessDate} · {session.startOdometerKm} →{" "}
                    {session.endOdometerKm ?? "Open"} KM
                  </p>
                  {session.timelineReviewRequired && <p className="mt-1 text-xs font-semibold text-amber-800">Review required: {session.timelineReviewReason}</p>}
                </div>
                <p className="self-center font-semibold tabular-nums">
                  {session.distanceKm ?? "—"} KM
                </p>
              </div>
            ))}
            {!sessions.length && (
              <p className="text-sm text-muted-foreground">
                No mileage sessions yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Odometer correction history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {corrections.map((entry) => (
            <div
              key={String(entry._id)}
              className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm last:border-0"
            >
              <span className="font-medium tabular-nums">
                {String(entry.previousOdometerKm)} →{" "}
                {String(entry.correctedOdometerKm)} KM
              </span>
              <span>{String(entry.reason)}</span>
              <span className="text-muted-foreground">
                {formatDate(String(entry.correctedAt))}
              </span>
            </div>
          ))}
          {!corrections.length && (
            <p className="text-sm text-muted-foreground">
              No odometer corrections recorded.
            </p>
          )}
        </CardContent>
      </Card>
      <div className="sr-only" aria-live="polite">
        {servicesQuery.isFetching ? "Refreshing service history" : ""}
      </div>
    </main>
  );
}
