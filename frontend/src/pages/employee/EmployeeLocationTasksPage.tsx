import { isAxiosError } from "axios";
import { MapPin, Navigation } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useATMLocationTasks,
  useHoldATMLocationTask,
  useResumeATMLocationTask,
  useStartATMLocationTask,
  atmLocationTaskQueryKeys,
} from "@/features/atms/hooks/useATMLocationTasks";
import {
  useSubmitATMLocationRequest,
} from "@/features/atms/hooks/useATMLocationRequests";
import {
  canSubmitATMLocationTask,
  canHoldATMLocationTask,
  canResumeATMLocationTask,
  createATMLocationTaskRequestPayload,
  getEmployeeLocationTaskGroups,
  tryAcquireATMLocationTaskSubmissionLock,
} from "@/features/atms/atmLocationTask.utils";
import {
  isAcceptableATMLocationRequestAccuracy,
  parseLocationCoordinates,
} from "@/features/atms/atmLocationRequest.utils";
import type {
  ATMLocationTask,
  ATMLocationTaskRequest,
} from "@/features/atms/types/atm-location-task.types";
import {
  employeeErrorMessage,
  employeeJobStatusLabel,
  useEmployeeLanguage,
} from "@/features/employee-portal/i18n";

const PAGE_SIZE = 20;
const inputClass =
  "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

const getTaskRequest = (
  task: ATMLocationTask,
): ATMLocationTaskRequest | null =>
  typeof task.locationRequestId === "object"
    ? task.locationRequestId
    : null;

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function getTaskErrorMessage(
  error: unknown,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
  language: "ta" | "en",
  fallback:
    | "The request could not be completed."
    | "Location proposal submission failed."
    | "Location task action failed." =
    "Location proposal submission failed.",
) {
  if (isAxiosError<{ message?: string }>(error)) {
    if ([403, 409].includes(error.response?.status ?? 0)) {
      return t("The task is no longer available or assigned to you. Refresh the task list.");
    }
    return employeeErrorMessage(
      error.response?.data?.message || fallback,
      fallback,
      language,
      t,
    );
  }
  return error instanceof Error
    ? employeeErrorMessage(
        error.message,
        fallback,
        language,
        t,
      )
    : t(fallback);
}

function LocationTaskCard({
  task,
  isRefreshing,
}: {
  task: ATMLocationTask;
  isRefreshing: boolean;
}) {
  const { t, language } = useEmployeeLanguage();
  const queryClient = useQueryClient();
  const startMutation = useStartATMLocationTask();
  const holdMutation = useHoldATMLocationTask();
  const resumeMutation = useResumeATMLocationTask();
  const submitMutation = useSubmitATMLocationRequest();
  const submittingRef = useRef(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [inputSource, setInputSource] = useState<"GPS" | "MANUAL">("MANUAL");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const atm = typeof task.atmId === "string" ? null : task.atmId;
  const request = getTaskRequest(task);
  const canSubmit =
    canSubmitATMLocationTask(task) &&
    !submitted &&
    !isRefreshing &&
    !holdMutation.isPending &&
    !resumeMutation.isPending;
  const hasLinkedRequest = task.locationRequestId != null;
  const canHold =
    canHoldATMLocationTask(task) &&
    !hasLinkedRequest &&
    !submitted &&
    !isLocating &&
    !submitMutation.isPending;
  const taskTypeLabel =
    task.taskType === "INITIAL_COLLECTION"
      ? t("Initial location collection")
      : t("Location correction");
  const assignmentDate =
    task.assignmentHistory.at(-1)?.assignedAt ?? task.createdAt;

  const startTask = async () => {
    setError("");
    try {
      const startedTask = await startMutation.mutateAsync(task._id);
      if (canSubmitATMLocationTask(startedTask)) setSubmitted(false);
      toast.success(t("Task started."));
    } catch (startError) {
      const message = getTaskErrorMessage(
        startError,
        t,
        language,
        "The request could not be completed.",
      );
      setError(message);
      toast.error(message);
    }
  };

  const holdTask = async () => {
    if (!canHold || holdMutation.isPending || isRefreshing) return;
    setError("");
    try {
      await holdMutation.mutateAsync(task._id);
      toast.success(t("Task put on hold."));
    } catch (holdError) {
      const refreshResults = await Promise.allSettled([
        queryClient.invalidateQueries({
          queryKey: atmLocationTaskQueryKeys.all,
        }),
      ]);
      const message = getTaskErrorMessage(
        holdError,
        t,
        language,
        "Location task action failed.",
      );
      const visibleMessage = refreshResults.some(
        (result) => result.status === "rejected",
      )
        ? `${message} ${t("Task status could not be refreshed. Refresh the task list.")}`
        : message;
      setError(visibleMessage);
      toast.error(visibleMessage);
    }
  };

  const resumeTask = async () => {
    if (
      !canResumeATMLocationTask(task) ||
      resumeMutation.isPending ||
      isRefreshing
    ) return;
    setError("");
    try {
      await resumeMutation.mutateAsync(task._id);
      toast.success(t("Task resumed."));
    } catch (resumeError) {
      const refreshResults = await Promise.allSettled([
        queryClient.invalidateQueries({
          queryKey: atmLocationTaskQueryKeys.all,
        }),
      ]);
      const message = getTaskErrorMessage(
        resumeError,
        t,
        language,
        "Location task action failed.",
      );
      const visibleMessage = refreshResults.some(
        (result) => result.status === "rejected",
      )
        ? `${message} ${t("Task status could not be refreshed. Refresh the task list.")}`
        : message;
      setError(visibleMessage);
      toast.error(visibleMessage);
    }
  };

  const captureGPS = () => {
    setError("");
    if (!navigator.geolocation) {
      setError(t("This browser does not support GPS location capture."));
      return;
    }

    setLatitude("");
    setLongitude("");
    setAccuracy(null);
    setInputSource("GPS");
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(String(position.coords.latitude));
        setLongitude(String(position.coords.longitude));
        setAccuracy(position.coords.accuracy);
        setIsLocating(false);
        if (!isAcceptableATMLocationRequestAccuracy(position.coords.accuracy)) {
          setError(
            t("GPS accuracy is above the 50 metre limit. Capture again or enter coordinates manually."),
          );
        }
      },
      (locationError) => {
        setIsLocating(false);
        setError(
          locationError.code === 1
            ? t("GPS permission was denied. Allow location access and try again.")
            : locationError.code === 2
              ? t("Your current location is unavailable. Check device location settings and retry.")
              : t("GPS capture timed out. Move to an area with a clear signal and retry."),
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };

  const useManualCoordinates = () => {
    setInputSource("MANUAL");
    setAccuracy(null);
    setError("");
  };

  const updateCoordinate = (
    setter: (value: string) => void,
    value: string,
  ) => {
    setter(value);
    setInputSource("MANUAL");
    setAccuracy(null);
  };

  const submitProposal = async () => {
    if (submittingRef.current || submitMutation.isPending || !canSubmit) return;
    setError("");
    const parsed = parseLocationCoordinates(latitude, longitude);
    if (!parsed.valid) {
      setError(t(parsed.error as Parameters<typeof t>[0]));
      return;
    }

    let payload;
    try {
      payload = createATMLocationTaskRequestPayload({
        task,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        inputSource,
        accuracy,
      });
    } catch (payloadError) {
      const message = payloadError instanceof Error ? payloadError.message : "";
      setError(
        message === "GPS accuracy must be a finite value from 0 to 50 metres."
          ? t("GPS accuracy must be a finite value from 0 to 50 metres.")
          : message === "Coordinates must be within valid latitude and longitude ranges."
            ? t("Coordinates must be valid finite numbers.")
            : t("Location proposal submission failed."),
      );
      return;
    }

    if (!tryAcquireATMLocationTaskSubmissionLock(submittingRef)) return;
    try {
      await submitMutation.mutateAsync(payload);
      setSubmitted(true);
      setError("");
      toast.success(t("Location proposal submitted for admin review."));
      const atmId = typeof task.atmId === "string" ? task.atmId : task.atmId._id;
      const refreshResults = await Promise.allSettled([
        queryClient.invalidateQueries({
          queryKey: atmLocationTaskQueryKeys.all,
        }),
        queryClient.invalidateQueries({
          queryKey: ["my-atm-location-requests", atmId],
        }),
      ]);
      if (refreshResults.some((result) => result.status === "rejected")) {
        setError(
          t("Proposal submitted, but task status could not be refreshed. Refresh the task list."),
        );
      }
    } catch (submitError) {
      const message = getTaskErrorMessage(submitError, t, language);
      setError(message);
      toast.error(message);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl border-slate-200 shadow-sm dark:border-slate-800">
      <CardHeader className="gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <MapPin className="size-5 shrink-0 text-blue-600" aria-hidden="true" />
              <span className="break-all">{atm?.atmId ?? t("ATM unavailable")}</span>
            </CardTitle>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {atm?.locationName ?? t("ATM unavailable")}
            </p>
            {atm?.address && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{atm.address}</p>
            )}
            {(atm?.districtId?.districtName || atm?.regionId?.name) && (
              <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                {[atm.districtId?.districtName, atm.regionId?.name]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {atm?.bankId?.bankName && (
              <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                {atm.bankId.bankName}
              </p>
            )}
          </div>
          <Badge className="max-w-full whitespace-normal break-words text-center" variant={task.status === "REJECTED" ? "destructive" : "outline"}>
            {employeeJobStatusLabel(task.status, t)}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">{taskTypeLabel}</Badge>
          <span className="self-center text-slate-500 dark:text-slate-400">
            {t("Assigned date")}: {formatDate(assignmentDate, language === "ta" ? "ta-IN" : "en-IN")}
          </span>
        </div>
        {task.correctionReason && (
          <p className="break-words text-sm text-slate-700 dark:text-slate-300">
            <span className="font-medium">{t("Correction reason")}:</span>{" "}
            {task.correctionReason}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-5 sm:px-5">
        {task.status === "ASSIGNED" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("Submit a proposal only after visiting this ATM.")}
            </p>
            <Button
              type="button"
              className="min-h-11 w-full sm:w-auto"
              onClick={() => void startTask()}
              disabled={startMutation.isPending || !task.active}
            >
              {startMutation.isPending ? t("Starting task...") : t("Start task")}
            </Button>
          </div>
        )}

        {task.status === "IN_PROGRESS" && !hasLinkedRequest && (
          <section className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div>
              <h3 className="font-semibold">{t("Location proposal")}</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {t("Submit a proposal only after visiting this ATM.")}
              </p>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 max-w-full whitespace-normal"
                onClick={() => void holdTask()}
                disabled={
                  !canHold ||
                  holdMutation.isPending ||
                  resumeMutation.isPending ||
                  isRefreshing
                }
              >
                {holdMutation.isPending
                  ? t("Putting task on hold...")
                  : t("Do Later / Hold")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={captureGPS}
                disabled={isLocating || submitMutation.isPending || holdMutation.isPending}
              >
                <Navigation aria-hidden="true" />
                {isLocating ? t("Capturing GPS...") : t("Use current GPS")}
              </Button>
              <Button
                type="button"
                variant={inputSource === "MANUAL" ? "secondary" : "outline"}
                className="min-h-11"
                onClick={useManualCoordinates}
                disabled={isLocating || submitMutation.isPending || holdMutation.isPending}
              >
                {t("Enter coordinates manually")}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`task-latitude-${task._id}`} className="mb-1.5 block text-sm font-medium">
                  {t("Latitude")}
                </label>
                <input
                  id={`task-latitude-${task._id}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="-90"
                  max="90"
                  autoComplete="off"
                  className={inputClass}
                  value={latitude}
                  onChange={(event) => updateCoordinate(setLatitude, event.target.value)}
                  disabled={isLocating || submitMutation.isPending}
                />
              </div>
              <div>
                <label htmlFor={`task-longitude-${task._id}`} className="mb-1.5 block text-sm font-medium">
                  {t("Longitude")}
                </label>
                <input
                  id={`task-longitude-${task._id}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="-180"
                  max="180"
                  autoComplete="off"
                  className={inputClass}
                  value={longitude}
                  onChange={(event) => updateCoordinate(setLongitude, event.target.value)}
                  disabled={isLocating || submitMutation.isPending}
                />
              </div>
            </div>
            {inputSource === "GPS" && accuracy !== null && (
              <p className="text-sm text-slate-600 dark:text-slate-300" role="status">
                {t("GPS accuracy: {accuracy} m", { accuracy: Math.round(accuracy) })}
              </p>
            )}
            {inputSource === "MANUAL" && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t("Manual coordinates will be submitted as manual, without GPS accuracy.")}
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                {error}
              </p>
            )}
            <Button
              type="button"
              className="min-h-11 w-full sm:w-auto"
              onClick={() => void submitProposal()}
              disabled={
                isLocating ||
                submitMutation.isPending ||
                !canSubmit ||
                !latitude ||
                !longitude ||
                (inputSource === "GPS" &&
                  !isAcceptableATMLocationRequestAccuracy(accuracy))
              }
            >
              {submitMutation.isPending
                ? t("Submitting proposal...")
                : t("Submit for admin review")}
            </Button>
          </section>
        )}

        {task.status === "ON_HOLD" && (
          <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("Held date")}: {task.heldAt ? formatDate(task.heldAt, language === "ta" ? "ta-IN" : "en-IN") : "—"}
            </p>
            {task.resumedAt && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t("Resumed date")}: {formatDate(task.resumedAt, language === "ta" ? "ta-IN" : "en-IN")}
              </p>
            )}
            <Button
              type="button"
              className="min-h-11 w-full whitespace-normal sm:w-auto"
              onClick={() => void resumeTask()}
              disabled={
                !canResumeATMLocationTask(task) ||
                resumeMutation.isPending ||
                isRefreshing
              }
            >
              {resumeMutation.isPending ? t("Resuming task...") : t("Resume task")}
            </Button>
          </section>
        )}

        {(task.status === "PENDING_REVIEW" ||
          request?.status === "PENDING" ||
          submitted) && (
          <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {t("This task is awaiting admin review. Do not submit another proposal.")}
            {request?.submittedAt && (
              <span className="mt-1 block">
                {formatDate(request.submittedAt, language === "ta" ? "ta-IN" : "en-IN")}
              </span>
            )}
            {request && (
              <span className="mt-1 block">
                {t("Submission source: {source}", {
                  source: t(request.inputSource === "GPS" ? "GPS" : "Manual"),
                })}
                {request.accuracy != null && (
                  <span className="block">
                    {t("GPS accuracy: {accuracy} m", {
                      accuracy: Math.round(request.accuracy),
                    })}
                  </span>
                )}
              </span>
            )}
          </p>
        )}
        {task.status === "IN_PROGRESS" && hasLinkedRequest && request?.status !== "PENDING" && (
          <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {t("This task is awaiting admin review. Do not submit another proposal.")}
          </p>
        )}
        {task.status === "REJECTED" && (
          <p role="status" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
            {t("This task was rejected. Contact an admin to reopen or reassign it before submitting again.")}
            {request?.rejectionReason && (
              <span className="mt-1 block">{request.rejectionReason}</span>
            )}
          </p>
        )}
        {task.status !== "ASSIGNED" &&
          task.status !== "IN_PROGRESS" &&
          task.status !== "PENDING_REVIEW" &&
            task.status !== "REJECTED" &&
            task.status !== "ON_HOLD" && (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {employeeJobStatusLabel(task.status, t)}
            </p>
          )}
        {error && task.status !== "IN_PROGRESS" && (
          <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function EmployeeLocationTasksPage() {
  const { t } = useEmployeeLanguage();
  const [page, setPage] = useState(1);
  const tasksQuery = useATMLocationTasks({ page, limit: PAGE_SIZE });
  const tasks = tasksQuery.data?.tasks ?? [];
  const totalPages = tasksQuery.data?.pagination.totalPages ?? 0;

  return (
    <main className="min-w-0 space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("My Location Tasks")}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {t("Assigned ATM location collection and correction tasks will appear here.")}
        </p>
      </header>

      {tasksQuery.isLoading ? (
        <p role="status" className="rounded-2xl border bg-white p-6 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
          {t("Loading location tasks...")}
        </p>
      ) : tasksQuery.isError ? (
        <div role="alert" className="rounded-2xl border border-rose-300 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-950/30">
          <p className="font-medium text-rose-900 dark:text-rose-200">{t("Could not load location tasks.")}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 min-h-11"
            onClick={() => void tasksQuery.refetch()}
            disabled={tasksQuery.isFetching}
          >
            {tasksQuery.isFetching ? t("Loading...") : t("Retry")}
          </Button>
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white p-8 text-center dark:bg-slate-950">
          <p className="font-semibold">{t("No location tasks assigned to you.")}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {t("Assigned ATM location collection and correction tasks will appear here.")}
          </p>
        </div>
      ) : (
        <>
          <section aria-label={t("Tasks by status")} className="space-y-5">
            <h2 className="text-lg font-semibold">{t("Tasks by status")}</h2>
            {getEmployeeLocationTaskGroups(tasks).map((group) => (
              <section
                key={group.status}
                aria-labelledby={`location-task-group-${group.status}`}
                className="min-w-0 space-y-3"
              >
                <h3
                  id={`location-task-group-${group.status}`}
                  className="flex flex-wrap items-center gap-2 text-base font-semibold"
                >
                  {employeeJobStatusLabel(group.status, t)}
                  <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                    {t("{count} task(s)", { count: group.tasks.length })}
                  </span>
                </h3>
                <div className="grid min-w-0 gap-4">
                  {group.tasks.map((task) => (
                    <LocationTaskCard
                      key={task._id}
                      task={task}
                      isRefreshing={tasksQuery.isFetching}
                    />
                  ))}
                </div>
              </section>
            ))}
          </section>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4 dark:bg-slate-950">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {tasksQuery.data?.pagination.total ?? 0} · {page} / {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={page <= 1 || tasksQuery.isFetching}
                onClick={() => setPage((current) => current - 1)}
              >
                {t("Previous")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={!totalPages || page >= totalPages || tasksQuery.isFetching}
                onClick={() => setPage((current) => current + 1)}
              >
                {t("Next")}
              </Button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
