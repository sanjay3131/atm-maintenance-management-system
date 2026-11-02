import { isAxiosError } from "axios";
import { MapPin, Navigation } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useHoldATMLocationTask,
  useResumeATMLocationTask,
  useStartATMLocationTask,
  atmLocationTaskQueryKeys,
} from "@/features/atms/hooks/useATMLocationTasks";
import { useSubmitATMLocationRequest } from "@/features/atms/hooks/useATMLocationRequests";
import {
  canSubmitATMLocationTask,
  canHoldATMLocationTask,
  canResumeATMLocationTask,
  createATMLocationTaskRequestPayload,
  EMPLOYEE_LOCATION_TASK_STATUSES,
  getEmployeeLocationTaskGroups,
  getEmployeeLocationTaskTabCounts,
  getEmployeeLocationTaskTabTasks,
  sortEmployeeLocationTasksForEmployee,
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
  "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

const taskStatusClasses: Record<ATMLocationTaskStatus, string> = {
  ASSIGNED: "border-border bg-muted text-muted-foreground",
  IN_PROGRESS: "border-primary/30 bg-primary/10 text-primary",
  ON_HOLD:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  PENDING_REVIEW:
    "border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200",
  REJECTED: "border-destructive/30 bg-destructive/10 text-destructive",
  COMPLETED:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  CANCELLED: "border-border bg-muted text-muted-foreground",
};

const getTaskRequest = (
  task: ATMLocationTask,
): ATMLocationTaskRequest | null =>
  typeof task.locationRequestId === "object" ? task.locationRequestId : null;

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
    | "Location task action failed." = "Location proposal submission failed.",
) {
  if (isAxiosError<{ message?: string }>(error)) {
    if ([403, 409].includes(error.response?.status ?? 0)) {
      return t(
        "The task is no longer available or assigned to you. Refresh the task list.",
      );
    }
    return employeeErrorMessage(
      error.response?.data?.message || fallback,
      fallback,
      language,
      t,
    );
  }
  return error instanceof Error
    ? employeeErrorMessage(error.message, fallback, language, t)
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
  onContinue: (taskId: string | null) => void;
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
  const displayStatus =
    submitted || request?.status === "PENDING" ? "PENDING_REVIEW" : task.status;
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
    )
      return;
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
            t(
              "GPS accuracy is above the 50 metre limit. Capture again or enter coordinates manually.",
            ),
          );
        }
      },
      (locationError) => {
        setIsLocating(false);
        setError(
          locationError.code === 1
            ? t(
                "GPS permission was denied. Allow location access and try again.",
              )
            : locationError.code === 2
              ? t(
                  "Your current location is unavailable. Check device location settings and retry.",
                )
              : t(
                  "GPS capture timed out. Move to an area with a clear signal and retry.",
                ),
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

  const updateCoordinate = (setter: (value: string) => void, value: string) => {
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
          : message ===
              "Coordinates must be within valid latitude and longitude ranges."
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
      const atmId =
        typeof task.atmId === "string" ? task.atmId : task.atmId._id;
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
          t(
            "Proposal submitted, but task status could not be refreshed. Refresh the task list.",
          ),
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
    <Card
      id={`location-task-${task._id}`}
      className="min-w-0 overflow-hidden rounded-lg border-border bg-card shadow-none scroll-mt-20"
    >
      <CardHeader className="gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex min-w-0 items-center gap-2 text-base font-semibold leading-6 sm:text-lg">
              <MapPin
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="break-words [overflow-wrap:anywhere]">
                {atm?.atmId ?? t("ATM unavailable")}
              </span>
            </CardTitle>
            <p className="mt-1 text-sm font-medium text-foreground break-words">
              {atm?.locationName ?? t("ATM unavailable")}
            </p>
            {atm?.address && (
              <p className="mt-1 text-sm text-muted-foreground break-words [overflow-wrap:anywhere]">
                {atm.address}
              </p>
            )}
            {(atm?.districtId?.districtName || atm?.regionId?.name) && (
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {[atm.districtId?.districtName, atm.regionId?.name]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {atm?.bankId?.bankName && (
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {atm.bankId.bankName}
              </p>
            )}
          </div>
          <Badge
            variant="outline"
            className={`max-w-full whitespace-normal break-words text-center leading-5 ${taskStatusClasses[displayStatus]}`}
          >
            {employeeJobStatusLabel(displayStatus, t)}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium text-foreground">{taskTypeLabel}</span>
          <span className="text-muted-foreground">
            {t("Assigned date")}:{" "}
            {formatDate(assignmentDate, language === "ta" ? "ta-IN" : "en-IN")}
          </span>
        </div>
        {task.correctionReason && (
          <p className="break-words text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {t("Correction reason")}:
            </span>{" "}
            {task.correctionReason}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4 sm:px-5">
        {task.status === "ASSIGNED" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("Submit a proposal only after visiting this ATM.")}
            </p>
            <Button
              type="button"
              className="min-h-11 w-full sm:w-auto"
              onClick={() => void startTask()}
              disabled={startMutation.isPending || !task.active}
            >
              {startMutation.isPending
                ? t("Starting task...")
                : t("Start task")}
            </Button>
          </div>
        )}

        {task.status === "IN_PROGRESS" && !hasLinkedRequest && !submitted && (
          <section className="space-y-4 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold">{t("Location proposal")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("Submit a proposal only after visiting this ATM.")}
                </p>
              </div>
              {!workflowExpanded && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 whitespace-normal"
                  aria-expanded={false}
                  aria-controls={`location-proposal-workflow-${task._id}`}
                  onClick={() => onContinue(task._id)}
                >
                  {t("Continue task")}
                </Button>
              )}
            </div>
            {workflowExpanded && (
              <div
                id={`location-proposal-workflow-${task._id}`}
                className="space-y-4"
              >
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 whitespace-normal px-2"
                  aria-expanded={true}
                  aria-controls={`location-proposal-workflow-${task._id}`}
                  onClick={() => onContinue(null)}
                >
                  {t("Collapse workflow")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 max-w-full whitespace-normal sm:w-auto"
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
                    className="min-h-11 w-full justify-start whitespace-normal text-left sm:w-auto"
                    onClick={captureGPS}
                    disabled={
                      isLocating ||
                      submitMutation.isPending ||
                      holdMutation.isPending
                    }
                  >
                    <Navigation aria-hidden="true" />
                    {isLocating ? t("Capturing GPS...") : t("Use current GPS")}
                  </Button>
                  <Button
                    type="button"
                    variant={inputSource === "MANUAL" ? "secondary" : "outline"}
                    className="min-h-11 w-full justify-start whitespace-normal text-left sm:w-auto"
                    onClick={useManualCoordinates}
                    disabled={
                      isLocating ||
                      submitMutation.isPending ||
                      holdMutation.isPending
                    }
                  >
                    {t("Enter coordinates manually")}
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`task-latitude-${task._id}`}
                      className="mb-2 block text-sm font-medium"
                    >
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
                      onChange={(event) =>
                        updateCoordinate(setLatitude, event.target.value)
                      }
                      disabled={isLocating || submitMutation.isPending}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`task-longitude-${task._id}`}
                      className="mb-2 block text-sm font-medium"
                    >
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
                      onChange={(event) =>
                        updateCoordinate(setLongitude, event.target.value)
                      }
                      disabled={isLocating || submitMutation.isPending}
                    />
                  </div>
                </div>
                {inputSource === "GPS" && accuracy !== null && (
                  <p className="text-sm text-muted-foreground" role="status">
                    {t("GPS accuracy: {accuracy} m", {
                      accuracy: Math.round(accuracy),
                    })}
                  </p>
                )}
                {inputSource === "MANUAL" && (
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Manual coordinates will be submitted as manual, without GPS accuracy.",
                    )}
                  </p>
                )}
                {error && (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                  >
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
          <section className="space-y-3 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {t("Held date")}:{" "}
              {task.heldAt
                ? formatDate(task.heldAt, language === "ta" ? "ta-IN" : "en-IN")
                : "—"}
            </p>
            {task.resumedAt && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t("Resumed date")}:{" "}
                {formatDate(
                  task.resumedAt,
                  language === "ta" ? "ta-IN" : "en-IN",
                )}
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
              {resumeMutation.isPending
                ? t("Resuming task...")
                : t("Resume task")}
            </Button>
          </section>
        )}

        {task.status === "COMPLETED" && task.completedAt && (
          <p className="text-sm text-muted-foreground">
            {t("Completed date")}:{" "}
            {formatDate(
              task.completedAt,
              language === "ta" ? "ta-IN" : "en-IN",
            )}
          </p>
        )}

        {(task.status === "PENDING_REVIEW" ||
          request?.status === "PENDING" ||
          submitted) && (
          <p
            role="status"
            className="rounded-md border-s-2 border-amber-500 bg-amber-50/70 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {t(
              "This task is awaiting admin review. Do not submit another proposal.",
            )}
            {request?.submittedAt && (
              <span className="mt-1 block">
                {formatDate(
                  request.submittedAt,
                  language === "ta" ? "ta-IN" : "en-IN",
                )}
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
        {task.status === "IN_PROGRESS" &&
          hasLinkedRequest &&
          request?.status !== "PENDING" && (
            <p
              role="status"
              className="rounded-md border-s-2 border-amber-500 bg-amber-50/70 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-200"
            >
              {t(
                "This task is awaiting admin review. Do not submit another proposal.",
              )}
            </p>
          )}
        {task.status === "REJECTED" && (
          <p
            role="status"
            className="rounded-md border-s-2 border-destructive bg-destructive/5 p-3 text-sm text-destructive"
          >
            {t(
              "This task was rejected. Contact an admin to reopen or reassign it before submitting again.",
            )}
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
            <p className="text-sm text-muted-foreground">
              {employeeJobStatusLabel(task.status, t)}
            </p>
          )}
        {error && task.status !== "IN_PROGRESS" && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
  const inProgressStatusGroups = getEmployeeLocationTaskGroups(tasks).filter(
    ({ status }) =>
      status === "IN_PROGRESS" ||
      status === "ON_HOLD" ||
      status === "PENDING_REVIEW" ||
      status === "REJECTED",
  );
  const tabTasks = getEmployeeLocationTaskTabTasks(tasks, selectedTab);
  const selectedTasks =
    selectedTab === "IN_PROGRESS"
      ? sortEmployeeLocationTasksForEmployee(tabTasks)
      : tabTasks;
  const totalPages = Math.ceil(selectedTasks.length / PAGE_SIZE);
  const visibleTasks = selectedTasks.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const isLoading = statusQueries.some((query) => query.isLoading);
  const isError = statusQueries.some((query) => query.isError);
  const isFetching = statusQueries.some((query) => query.isFetching);
  const totalTasks = Object.values(counts).reduce(
    (total, count) => total + count,
    0,
  );
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
  useEffect(() => {
    if (selectedTab !== "IN_PROGRESS" || !workflowTaskId) return;
    document
      .getElementById(`location-task-${workflowTaskId}`)
      ?.scrollIntoView({ block: "start" });
  }, [selectedTab, workflowTaskId]);
  const tabs: Array<{
    status: EmployeeLocationTaskTab;
    label: "Assigned" | "In progress" | "Completed";
  }> = [
    { status: "ASSIGNED", label: "Assigned" },
    { status: "IN_PROGRESS", label: "In progress" },
    { status: "COMPLETED", label: "Completed" },
  ];
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % tabs.length;
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    selectTab(tabs[nextIndex].status);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <main className="min-w-0 space-y-6 pb-[env(safe-area-inset-bottom)]">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("My Location Tasks")}
        </h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {t(
            "Assigned ATM location collection and correction tasks will appear here.",
          )}
        </p>
      </header>

      {isLoading ? (
        <div
          role="status"
          className="space-y-4 rounded-lg border border-border bg-card p-4"
        >
          <p className="text-sm text-muted-foreground">
            {t("Loading location tasks...")}
          </p>
          <div aria-hidden="true" className="space-y-3">
            <div className="h-4 w-2/5 rounded bg-muted" />
            <div className="h-3 w-3/4 rounded bg-muted" />
          </div>
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-border bg-card p-4"
        >
          <p className="font-medium text-destructive">
            {t("Could not load location tasks.")}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
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
            aria-orientation="horizontal"
            aria-label={t("Location task status tabs")}
            className="grid grid-cols-3 border-b border-border"
          >
            {tabs.map(({ status, label }, index) => (
              <button
                key={status}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`location-task-tab-${status}`}
                aria-selected={selectedTab === status}
                aria-controls="location-task-panel"
                aria-label={`${t(label)}, ${t("{count} task(s)", {
                  count: counts[status],
                })}`}
                tabIndex={selectedTab === status ? 0 : -1}
                onClick={() => selectTab(status)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 border-b-2 border-transparent px-1 py-2 text-center text-sm font-medium leading-5 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring${
                  selectedTab === status
                    ? "border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="min-w-0 break-words text-xs sm:text-sm">
                  {t(label)}
                </span>
                <span className="text-xs font-normal tabular-nums text-muted-foreground">
                  {counts[status]}
                </span>
              </button>
            ))}
          </section>

          <section
            role="tabpanel"
            id="location-task-panel"
            aria-labelledby={`location-task-tab-${selectedTab}`}
            tabIndex={0}
            className="min-w-0 space-y-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {selectedTab === "IN_PROGRESS" && (
              <section
                aria-labelledby="location-task-breakdown-heading"
                className="space-y-2"
              >
                <h2
                  id="location-task-breakdown-heading"
                  className="text-sm font-semibold text-foreground"
                >
                  {t("Tasks by status")}
                </h2>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-border py-2 sm:grid-cols-4">
                  {inProgressStatusGroups.map(
                    ({ status, tasks: statusTasks }) => (
                      <div key={status} className="min-w-0">
                        <dt className="break-words text-sm leading-5 text-muted-foreground">
                          {employeeJobStatusLabel(status, t)}
                        </dt>
                        <dd className="mt-1 text-base font-semibold tabular-nums text-foreground">
                          {statusTasks.length}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              </section>
            )}

            {totalTasks === 0 ? (
              <div className="rounded-lg border border-border bg-card p-5">
                <p className="font-semibold text-foreground">
                  {t("No location tasks assigned to you.")}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t(
                    "Assigned ATM location collection and correction tasks will appear here.",
                  )}
                </p>
              </div>
            ) : selectedTasks.length === 0 ? (
              <div className="rounded-lg border border-border bg-card p-5">
                <p className="font-semibold text-foreground">
                  {t("No tasks in this status.")}
                </p>
              </div>
            ) : (
              <div className="grid min-w-0 gap-3">
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
              <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedTasks.length} · {page} / {totalPages}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full sm:w-auto"
                    disabled={page <= 1 || isFetching}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    {t("Previous")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full sm:w-auto"
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
