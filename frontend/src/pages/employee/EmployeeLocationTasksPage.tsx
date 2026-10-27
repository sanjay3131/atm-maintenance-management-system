import { isAxiosError } from "axios";
import { MapPin, Navigation } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
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
  EMPLOYEE_LOCATION_TASK_STATUSES,
  getEmployeeLocationTaskTabCounts,
  getEmployeeLocationTaskTabTasks,
  tryAcquireATMLocationTaskSubmissionLock,
  type EmployeeLocationTaskTab,
} from "@/features/atms/atmLocationTask.utils";
import { getATMLocationTasks } from "@/features/atms/services/atm-location-tasks.service";
import type { ATMLocationTaskStatus } from "@/features/atms/types/atm-location-task.types";
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
const API_PAGE_SIZE = 100;
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

async function getAllEmployeeTasksForStatus(status: ATMLocationTaskStatus) {
  const firstPage = await getATMLocationTasks({
    status,
    page: 1,
    limit: API_PAGE_SIZE,
  });
  const remainingPages = await Promise.all(
    Array.from(
      { length: Math.max(0, firstPage.pagination.totalPages - 1) },
      (_, index) =>
        getATMLocationTasks({
          status,
          page: index + 2,
          limit: API_PAGE_SIZE,
        }),
    ),
  );
  return {
    tasks: [firstPage, ...remainingPages].flatMap(({ tasks }) => tasks),
    total: firstPage.pagination.total,
  };
}

function LocationTaskCard({
  task,
  isRefreshing,
  workflowExpanded,
  onContinue,
  onTaskStarted,
  onTaskResumed,
}: {
  task: ATMLocationTask;
  isRefreshing: boolean;
  workflowExpanded: boolean;
  onContinue: (taskId: string) => void;
  onTaskStarted: (taskId: string) => void;
  onTaskResumed: (taskId: string) => void;
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
      onTaskStarted(task._id);
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
      onTaskResumed(task._id);
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold">{t("Location proposal")}</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {t("Submit a proposal only after visiting this ATM.")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 whitespace-normal"
                aria-expanded={workflowExpanded}
                aria-controls={`location-proposal-workflow-${task._id}`}
                onClick={() => onContinue(task._id)}
              >
                {t("Continue task")}
              </Button>
            </div>
            {workflowExpanded && (
              <div
                id={`location-proposal-workflow-${task._id}`}
                className="space-y-4"
              >
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
              </div>
            )}
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

        {task.status === "COMPLETED" && task.completedAt && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Completed date")}: {formatDate(task.completedAt, language === "ta" ? "ta-IN" : "en-IN")}
          </p>
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
  const [selectedTab, setSelectedTab] =
    useState<EmployeeLocationTaskTab>("ASSIGNED");
  const [workflowTaskId, setWorkflowTaskId] = useState<string | null>(null);
  const statusQueries = useQueries({
    queries: EMPLOYEE_LOCATION_TASK_STATUSES.map((status) => ({
      queryKey: atmLocationTaskQueryKeys.list({
        status,
        page: 1,
        limit: API_PAGE_SIZE,
      }),
      queryFn: () => getAllEmployeeTasksForStatus(status),
    })),
  });
  const tasks = statusQueries.flatMap((query) => query.data?.tasks ?? []);
  const counts = getEmployeeLocationTaskTabCounts(tasks);
  const selectedTasks = getEmployeeLocationTaskTabTasks(tasks, selectedTab);
  const totalPages = Math.ceil(selectedTasks.length / PAGE_SIZE);
  const visibleTasks = selectedTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const isLoading = statusQueries.some((query) => query.isLoading);
  const isError = statusQueries.some((query) => query.isError);
  const isFetching = statusQueries.some((query) => query.isFetching);
  const totalTasks = Object.values(counts).reduce((total, count) => total + count, 0);
  const retry = () => {
    void Promise.all(statusQueries.map((query) => query.refetch()));
  };
  const selectTab = (tab: EmployeeLocationTaskTab) => {
    setSelectedTab(tab);
    setPage(1);
    setWorkflowTaskId(null);
  };
  const showStartedTask = (taskId: string) => {
    setSelectedTab("IN_PROGRESS");
    setPage(1);
    setWorkflowTaskId(taskId);
  };
  const tabs: Array<{
    status: EmployeeLocationTaskTab;
    label: "Assigned" | "In progress" | "Completed";
  }> = [
    { status: "ASSIGNED", label: "Assigned" },
    { status: "IN_PROGRESS", label: "In progress" },
    { status: "COMPLETED", label: "Completed" },
  ];

  return (
    <main className="min-w-0 space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("My Location Tasks")}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {t("Assigned ATM location collection and correction tasks will appear here.")}
        </p>
      </header>

      {isLoading ? (
        <p role="status" className="rounded-2xl border bg-white p-6 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
          {t("Loading location tasks...")}
        </p>
      ) : isError ? (
        <div role="alert" className="rounded-2xl border border-rose-300 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-950/30">
          <p className="font-medium text-rose-900 dark:text-rose-200">{t("Could not load location tasks.")}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 min-h-11"
            onClick={retry}
            disabled={isFetching}
          >
            {isFetching ? t("Loading...") : t("Retry")}
          </Button>
        </div>
      ) : (
        <>
          <section
            role="tablist"
            aria-label={t("Location task status tabs")}
            className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-950"
          >
            {tabs.map(({ status, label }) => (
              <button
                key={status}
                type="button"
                role="tab"
                id={`location-task-tab-${status}`}
                aria-selected={selectedTab === status}
                aria-controls="location-task-panel"
                onClick={() => selectTab(status)}
                className={`flex min-h-12 min-w-0 flex-wrap items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-sm font-semibold leading-5 transition-colors ${
                  selectedTab === status
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                <span className="min-w-0 break-words">{t(label)}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    selectedTab === status
                      ? "bg-white/20 text-white"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  }`}
                  aria-label={t("{count} task(s)", { count: counts[status] })}
                >
                  {counts[status]}
                </span>
              </button>
            ))}
          </section>

          <section
            role="tabpanel"
            id="location-task-panel"
            aria-labelledby={`location-task-tab-${selectedTab}`}
            className="min-w-0 space-y-4"
          >
            {totalTasks === 0 ? (
              <div className="rounded-2xl border border-dashed bg-white p-8 text-center dark:bg-slate-950">
                <p className="font-semibold">{t("No location tasks assigned to you.")}</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {t("Assigned ATM location collection and correction tasks will appear here.")}
                </p>
              </div>
            ) : selectedTasks.length === 0 ? (
              <div className="rounded-2xl border border-dashed bg-white p-8 text-center dark:bg-slate-950">
                <p className="font-semibold">{t("No tasks in this status.")}</p>
              </div>
            ) : (
              <div className="grid min-w-0 gap-4">
                {visibleTasks.map((task) => (
                  <LocationTaskCard
                    key={task._id}
                    task={task}
                    isRefreshing={isFetching}
                    workflowExpanded={workflowTaskId === task._id}
                    onContinue={setWorkflowTaskId}
                    onTaskStarted={showStartedTask}
                    onTaskResumed={showStartedTask}
                  />
                ))}
              </div>
            )}

            {selectedTasks.length > PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4 dark:bg-slate-950">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {selectedTasks.length} · {page} / {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={page <= 1 || isFetching}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    {t("Previous")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={page >= totalPages || isFetching}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {t("Next")}
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
