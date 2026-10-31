import { useState, type ReactNode } from "react";
import { isAxiosError } from "axios";
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronDown,
  Clock3,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  X,
  UserRoundPlus,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
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
import AssignJobDialog from "@/features/jobs/components/AssignJobDialog";
import EditJobForm from "@/features/jobs/components/EditJobForm";
import AdminMaterialUsageSection from "@/features/jobs/components/AdminMaterialUsageSection";
import EmployeeFieldWorkPanel from "@/features/jobs/components/EmployeeFieldWorkPanel";
import EmployeeMaterialUsageSection from "@/features/jobs/components/EmployeeMaterialUsageSection";
import JobPhotoGallery from "@/features/jobs/components/JobPhotoGallery";
import {
  useAcceptJob,
  useApproveJob,
  useCancelJob,
  useCloseJob,
  useHoldJob,
  useStartJob,
  useVerifyJob,
} from "@/features/jobs/hooks/useJobLifecycle";
import { useJobHistory } from "@/features/jobs/hooks/useJobHistory";
import { useJob } from "@/features/jobs/hooks/useJob";
import { formatAcSubType, formatJobWorkType } from "@/features/jobs/utils/jobWorkType.utils";
import {
  canLoadEmployeeMaterialUsage,
  getEmployeeFieldworkProgress,
  getEmployeeJobDetailsScreen,
} from "@/features/jobs/utils/employeeJobDetails.utils";
import { useATM } from "@/features/atms/hooks/useATM";
import { formatHistoryDetailLines } from "@/features/jobs/utils/formatJobHistoryDetails";
import {
  employeeDisplayLabel,
  employeeErrorMessage,
  employeeJobStatusLabel,
  employeeLanguageClasses,
  useEmployeeLanguage,
} from "@/features/employee-portal/i18n";
import type {
  Job,
  JobHistoryEntry,
  JobStatus,
  JobUser,
} from "@/features/jobs/types/job.types";

const NOT_AVAILABLE = "Not available";
const REASSIGNABLE_STATUSES: JobStatus[] = [
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "ON_HOLD",
  "REJECTED",
];
const CANCELLABLE_STATUSES: JobStatus[] = [
  "PENDING",
  "ASSIGNED",
  "ACCEPTED",
  "ON_HOLD",
  "REJECTED",
];

interface JobDetailsPageProps {
  readOnly?: boolean;
  backPath?: string;
}

function formatValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === ""
    ? NOT_AVAILABLE
    : String(value);
}

function formatDate(value: string | null | undefined, language: "ta" | "en") {
  if (!value) return NOT_AVAILABLE;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? NOT_AVAILABLE
    : date.toLocaleString(language === "ta" ? "ta-IN" : undefined);
}

function formatScheduledDate(value: string, language: "ta" | "en") {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? NOT_AVAILABLE
    : date.toLocaleDateString(language === "ta" ? "ta-IN" : "en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function formatLabel(value?: string | null) {
  if (!value) return NOT_AVAILABLE;
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatHistoryAction(
  action: string,
  entry: JobHistoryEntry,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  if (action === "status_changed") {
    if (entry.toStatus === "IN_PROGRESS" && entry.fromStatus === "ON_HOLD") {
      return t("Resumed");
    }
    if (entry.toStatus === "IN_PROGRESS") return t("Started");
    if (entry.toStatus === "ON_HOLD") return t("Put On Hold");
    if (entry.toStatus === "ACCEPTED") return t("Accepted");
    if (entry.toStatus === "COMPLETED") return t("Completed");
  }

  const labels: Record<string, Parameters<typeof t>[0]> = {
    created: "Job Created",
    assigned: "Assigned",
    photo_uploaded: "Photo Uploaded",
    gps_validated: "GPS Validated",
    reassigned: "Reassigned",
    verified: "Verified",
    approved: "Approved",
    rejected: "Rejected",
    closed: "Closed",
    cancelled: "Cancelled",
    note_added: "Note Added",
  };

  return labels[action] ? t(labels[action]) : formatLabel(action);
}

function formatGpsValue(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : NOT_AVAILABLE;
}

function getStatusVariant(status: JobStatus) {
  if (status === "REJECTED") return "destructive" as const;
  if (status === "CANCELLED") return "destructive" as const;
  if (status === "PENDING" || status === "ON_HOLD") return "secondary" as const;
  if (status === "CLOSED") return "outline" as const;
  return "default" as const;
}

function getPersonName(person?: JobUser | string | null) {
  if (!person) return NOT_AVAILABLE;
  if (typeof person === "string") return NOT_AVAILABLE;

  return (
    [person.firstName, person.lastName].filter(Boolean).join(" ") ||
    NOT_AVAILABLE
  );
}

function getEmployeeLabel(person?: JobUser | string | null) {
  if (!person || typeof person === "string") return NOT_AVAILABLE;
  const name = getPersonName(person);
  return person.employeeCode ? `${name} (${person.employeeCode})` : name;
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  const { t } = useEmployeeLanguage();

  return (
    <div className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="min-w-0 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere] sm:max-w-[65%] sm:text-right">
        {value === NOT_AVAILABLE ? t("Not available") : value}
      </dd>
    </div>
  );
}

function EmployeeDisclosure({
  enabled,
  id,
  title,
  children,
}: {
  enabled: boolean;
  id?: string;
  title: string;
  children: ReactNode;
}) {
  if (!enabled) return children;

  return (
    <details
      id={id}
      className="group min-w-0 rounded-xl border border-border bg-card px-3"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-semibold marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span>{title}</span>
        <ChevronDown
          className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="min-w-0 border-t border-border pb-3 pt-3">
        {children}
      </div>
    </details>
  );
}

function DetailsSkeleton({ readOnly }: { readOnly: boolean }) {
  const { t } = useEmployeeLanguage();

  if (readOnly) {
    return (
      <div
        className="mx-auto w-full max-w-6xl space-y-4 px-3 pb-32 pt-3 sm:px-5 lg:px-8"
        role="status"
      >
        <div className="h-64 animate-pulse rounded-2xl border bg-muted/40 sm:h-56" />
        <div className="h-24 animate-pulse rounded-xl border bg-muted/40" />
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="h-12 animate-pulse rounded-xl border bg-muted/40"
            />
          ))}
        </div>
        <p className="sr-only">{t("Loading job details...")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" role="status">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-60 animate-pulse rounded-lg border bg-muted/40"
          />
        ))}
      </div>
      <p className="sr-only">{t("Loading job details...")}</p>
    </div>
  );
}

function getRawATMId(job?: Job) {
  if (!job) return "";
  if (typeof job.atmId === "string") return job.atmId;
  return job.atmId?._id ?? "";
}

function getMutationErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Could not update this job.";
  }
  return error instanceof Error ? error.message : "Could not update this job.";
}

export default function JobDetailsPage({
  readOnly = false,
  backPath = "/admin/jobs",
}: JobDetailsPageProps) {
  const navigate = useNavigate();
  const { language, t } = useEmployeeLanguage();
  const localize = (label: string) => employeeDisplayLabel(label, t);
  const mutationErrorMessage = (mutationError: unknown) =>
    employeeErrorMessage(
      getMutationErrorMessage(mutationError),
      "Could not update this job.",
      language,
      t,
    );
  const { jobId = "" } = useParams<{ jobId: string }>();
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isEditJobDialogOpen, setIsEditJobDialogOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [rejectionAction, setRejectionAction] = useState<
    "verify" | "approve" | null
  >(null);
  const [rejectionRemarks, setRejectionRemarks] = useState("");
  const acceptMutation = useAcceptJob();
  const startMutation = useStartJob();
  const holdMutation = useHoldJob();
  const cancelMutation = useCancelJob();
  const verifyMutation = useVerifyJob();
  const approveMutation = useApproveJob();
  const closeMutation = useCloseJob();
  const {
    data: job,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useJob(jobId);
  const historyQuery = useJobHistory(jobId);
  const { data: atmDetails, isLoading: isATMDetailsLoading } = useATM(
    getRawATMId(job),
    !readOnly,
  );
  if (isLoading) return <DetailsSkeleton readOnly={readOnly} />;

  if (isError || !job) {
    const isNotFound = isAxiosError(error) && error.response?.status === 404;
    const message = isAxiosError<{ message?: string }>(error)
      ? error.response?.data?.message
      : undefined;

    return (
      <div
        className={
          readOnly
            ? "mx-auto w-full max-w-6xl space-y-4 px-3 pb-8 pt-3 sm:px-5 lg:px-8"
            : "p-6"
        }
      >
        <Button variant="ghost" onClick={() => navigate(backPath)}>
          <ArrowLeft />
          {t("Back to Jobs")}
        </Button>
        <div className="max-w-2xl rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:p-6">
          <h1 className="font-semibold text-destructive">
            {t(isNotFound ? "Job not found" : "Job details unavailable")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {employeeErrorMessage(
              message ||
                (isNotFound
                  ? t("This job may have been removed.")
                  : t("The job could not be loaded. Please try again.")),
              isNotFound
                ? "This job may have been removed."
                : "The job could not be loaded. Please try again.",
              language,
              t,
            )}
          </p>
          {!isNotFound && (
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {isFetching ? t("Retrying...") : t("Retry")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const atm = typeof job.atmId === "object" ? job.atmId : null;
  const employee =
    typeof job.assignedEmployeeId === "object" ? job.assignedEmployeeId : null;
  const complaint =
    typeof job.complaintId === "object" ? job.complaintId : null;
  const customer = typeof job.customerId === "object" ? job.customerId : null;
  const customerName = customer?.customerName || NOT_AVAILABLE;
  const reassignmentHistory = job.reassignmentHistory ?? [];
  const lifecycleMutationPending =
    acceptMutation.isPending ||
    startMutation.isPending ||
    holdMutation.isPending ||
    cancelMutation.isPending;
  const reviewMutationPending =
    verifyMutation.isPending ||
    approveMutation.isPending ||
    closeMutation.isPending;

  const runLifecycleAction = (
    mutation: typeof acceptMutation,
    successMessage: string,
  ) => {
    if (lifecycleMutationPending) return;
    mutation.mutate(
      { jobId: job._id },
      {
        onSuccess: () => toast.success(successMessage),
        onError: (mutationError) =>
          toast.error(mutationErrorMessage(mutationError)),
      },
    );
  };

  const lifecycleDates = [
    ["Created", job.createdAt],
    ["Assigned", job.assignedAt],
    ["Accepted", job.acceptedAt],
    ["Started", job.startedAt],
    ["Completed", job.completedAt],
    ["Verified", job.verifiedAt],
    ["Approved", job.approvedAt],
    ["Rejected", job.rejectedAt],
    ["Closed", job.closedAt],
    ["Cancelled", job.cancelledAt],
  ] as const;
  const fieldworkProgress = getEmployeeFieldworkProgress(job);
  const employeeScreen = getEmployeeJobDetailsScreen(job.status);
  const isCompleted = employeeScreen === "completed";

  const handleRejectSuccess = () => {
    setIsRejectDialogOpen(false);
    setRejectionAction(null);
    setRejectionRemarks("");
    toast.success(t("Job rejected."));
  };

  const handleRejectError = (mutationError: Error) => {
    toast.error(mutationErrorMessage(mutationError));
  };

  const confirmReject = () => {
    if (!rejectionAction || reviewMutationPending) return;

    const remarks = rejectionRemarks.trim() || undefined;
    if (rejectionAction === "verify") {
      verifyMutation.mutate(
        { jobId: job._id, data: { action: "reject", remarks } },
        { onSuccess: handleRejectSuccess, onError: handleRejectError },
      );
      return;
    }

    approveMutation.mutate(
      { jobId: job._id, data: { action: "reject", remarks } },
      { onSuccess: handleRejectSuccess, onError: handleRejectError },
    );
  };

  const openRejectDialog = (action: "verify" | "approve") => {
    setRejectionAction(action);
    setRejectionRemarks("");
    setIsRejectDialogOpen(true);
  };

  const handleRejectDialogChange = (open: boolean) => {
    if (reviewMutationPending) return;
    setIsRejectDialogOpen(open);
    if (!open) {
      setRejectionAction(null);
      setRejectionRemarks("");
    }
  };

  const runVerify = () => {
    if (reviewMutationPending) return;
    verifyMutation.mutate(
      { jobId: job._id, data: { action: "verify" } },
      {
        onSuccess: () => toast.success("Job verified."),
        onError: (mutationError) =>
          toast.error(mutationErrorMessage(mutationError)),
      },
    );
  };

  const runApprove = () => {
    if (reviewMutationPending) return;
    approveMutation.mutate(
      { jobId: job._id, data: { action: "approve" } },
      {
        onSuccess: () => toast.success("Job approved."),
        onError: (mutationError) =>
          toast.error(mutationErrorMessage(mutationError)),
      },
    );
  };

  const runClose = () => {
    if (reviewMutationPending) return;
    closeMutation.mutate(
      { jobId: job._id },
      {
        onSuccess: () => toast.success("Job closed."),
        onError: (mutationError) =>
          toast.error(mutationErrorMessage(mutationError)),
      },
    );
  };

  const handleCancelDialogChange = (open: boolean) => {
    if (cancelMutation.isPending) return;
    setIsCancelDialogOpen(open);
    if (!open) setCancellationReason("");
  };

  const confirmCancel = () => {
    const reason = cancellationReason.trim();
    if (!reason || cancelMutation.isPending) return;

    cancelMutation.mutate(
      { jobId: job._id, data: { reason } },
      {
        onSuccess: () => {
          setIsCancelDialogOpen(false);
          setCancellationReason("");
          toast.success(t("Job cancelled."));
        },
        onError: (mutationError) =>
          toast.error(mutationErrorMessage(mutationError)),
      },
    );
  };

  const openFieldworkControls = () => {
    const controls = document.getElementById("employee-fieldwork-controls");
    if (!(controls instanceof HTMLDetailsElement)) return;
    controls.open = true;
    controls.scrollIntoView({ block: "start" });
  };

  return (
    <div
      className={
        readOnly
            ? `mx-auto w-full min-w-0 max-w-6xl pb-32 pt-3 ${employeeLanguageClasses(language, "space-y-4 px-3 sm:px-5 lg:px-8", "space-y-3 px-3 sm:px-5 lg:px-8")}`
          : "space-y-6 p-6"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            className={readOnly ? "-ml-3 min-h-11" : ""}
            onClick={() => navigate(backPath)}
          >
            <ArrowLeft />
            {t("Back to Jobs")}
          </Button>
          {!readOnly && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold">{t("Job Details")}</h1>
                <Badge variant={getStatusVariant(job.status)}>
                  {employeeJobStatusLabel(job.status, t)}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {job.jobNumber || job.jobId}
              </p>
            </>
          )}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {job.status !== "CLOSED" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditJobDialogOpen(true)}
              >
                <Pencil />
                {t("Edit Job")}
              </Button>
            )}
            {job.status === "PENDING" ||
            REASSIGNABLE_STATUSES.includes(job.status) ? (
              <Button type="button" onClick={() => setIsAssignDialogOpen(true)}>
                <UserRoundPlus />
                {t(job.status === "PENDING" ? "Assign Job" : "Reassign Job")}
              </Button>
            ) : null}
            {job.status === "IN_PROGRESS" && (
              <Button
                type="button"
                variant="outline"
                disabled={lifecycleMutationPending}
                onClick={() =>
                  runLifecycleAction(
                    holdMutation,
                    t("Job stopped and put on hold."),
                  )
                }
              >
                {holdMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Pause />
                )}
                {t("Stop (Put On Hold)")}
              </Button>
            )}
            {job.status === "COMPLETED" && (
              <>
                <Button
                  type="button"
                  disabled={reviewMutationPending}
                  onClick={runVerify}
                >
                  {verifyMutation.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  {t("Verify")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={reviewMutationPending}
                  onClick={() => openRejectDialog("verify")}
                >
                  <X />
                  {t("Reject")}
                </Button>
              </>
            )}
            {job.status === "VERIFIED" && (
              <>
                <Button
                  type="button"
                  disabled={reviewMutationPending}
                  onClick={runApprove}
                >
                  {approveMutation.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  {t("Approve")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={reviewMutationPending}
                  onClick={() => openRejectDialog("approve")}
                >
                  <X />
                  {t("Reject")}
                </Button>
              </>
            )}
            {job.status === "APPROVED" && (
              <Button
                type="button"
                disabled={reviewMutationPending}
                onClick={runClose}
              >
                {closeMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Check />
                )}
                {t("Close")}
              </Button>
            )}
            {CANCELLABLE_STATUSES.includes(job.status) && (
              <Button
                type="button"
                variant="destructive"
                disabled={lifecycleMutationPending}
                onClick={() => setIsCancelDialogOpen(true)}
              >
                <Ban />
                {t("Cancel Job")}
              </Button>
            )}
          </div>
        )}
      </div>

      {!readOnly && (
        <Dialog
          open={isEditJobDialogOpen}
          onOpenChange={setIsEditJobDialogOpen}
        >
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogTitle>{t("Edit Job")}</DialogTitle>
            <DialogDescription className="mt-1">
              Update job details and work type.
            </DialogDescription>
            {isEditJobDialogOpen && (
              <EditJobForm
                job={job}
                onCancel={() => setIsEditJobDialogOpen(false)}
                onUpdated={() => setIsEditJobDialogOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>
      )}

      {readOnly && (
        <Card className="min-w-0 overflow-hidden rounded-2xl border-border bg-card shadow-sm">
          <CardHeader className="space-y-4 p-4 pb-3 sm:p-6 sm:pb-4">
            <div className="grid min-w-0 gap-2 min-[420px]:grid-cols-[minmax(0,1fr)_auto] min-[420px]:items-start">
              <div className="min-w-0">
                <p className="break-words text-xs font-medium tracking-wide text-muted-foreground [overflow-wrap:anywhere]">
                  {t("Job ID")}: {formatValue(job.jobId)}
                  {job.jobNumber && job.jobNumber !== job.jobId && ` · ${job.jobNumber}`}
                </p>
                <CardTitle className="mt-1 break-words text-xl font-semibold leading-6 tracking-tight text-card-foreground [overflow-wrap:anywhere]">
                  {job.title}
                </CardTitle>
              </div>
              <Badge
                variant={getStatusVariant(job.status)}
                className="max-w-full whitespace-normal rounded-full px-2.5 py-1 text-center text-xs font-semibold leading-4 [overflow-wrap:anywhere] min-[420px]:justify-self-end"
              >
                {employeeJobStatusLabel(job.status, t)}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="max-w-full whitespace-normal rounded-full bg-muted px-2.5 py-1 text-center text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]">
                {localize(formatJobWorkType(job.workType))}
              </Badge>
              {job.workType === "ac" && (
                <Badge className="max-w-full whitespace-normal rounded-full bg-primary/10 px-2.5 py-1 text-center text-xs leading-4 text-primary [overflow-wrap:anywhere]">
                  {localize(formatAcSubType(job.acSubType))}
                </Badge>
              )}
              <Badge
                variant={
                  job.priority === "critical" || job.priority === "high"
                    ? "destructive"
                    : job.priority === "low"
                      ? "secondary"
                      : "outline"
                }
                className="max-w-full whitespace-normal rounded-full px-2.5 py-1 text-center text-[11px] leading-4 [overflow-wrap:anywhere]"
              >
                {localize(formatLabel(job.priority))}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-3 p-4 pt-0 sm:p-6 sm:pt-0 xl:grid-cols-2">
            <div className="min-w-0 rounded-xl bg-muted/50 p-3 sm:p-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground">
                {t("ATM")}
              </p>
              <p className="mt-1 min-w-0 break-words text-sm font-semibold leading-6 text-card-foreground [overflow-wrap:anywhere]">
                {formatValue(atm?.atmId)}
                {atm?.locationName && ` · ${atm.locationName}`}
              </p>
              {atm?.address && (
                <p className="mt-1 min-w-0 break-words text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                  {atm.address}
                </p>
              )}
            </div>
            {job.description && (
              <section className="min-w-0 rounded-xl border border-border p-3 sm:p-4">
                <h2 className="text-xs font-semibold tracking-wide text-muted-foreground">
                  {t("Description")}
                </h2>
                <p className="mt-2 min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-card-foreground [overflow-wrap:anywhere]">
                  {job.description}
                </p>
              </section>
            )}
          </CardContent>
        </Card>
      )}

      {readOnly && employeeScreen === "accepted" && job.acceptedAt && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-accent/50 px-3 py-2.5 text-sm text-accent-foreground">
          <Check className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {t("Accepted on")}: {formatDate(job.acceptedAt, language)}
          </span>
        </div>
      )}

      {readOnly && employeeScreen === "in-progress" && (
        <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-card-foreground">
                {t("Fieldwork progress")}
              </h2>
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                {fieldworkProgress.uploaded}/{fieldworkProgress.required}
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={t("Fieldwork progress")}
              aria-valuemin={0}
              aria-valuemax={fieldworkProgress.required}
              aria-valuenow={fieldworkProgress.uploaded}
            >
              <div
                className="h-full rounded-full bg-teal-600 transition-[width]"
                style={{ width: `${fieldworkProgress.percent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("{count} of {required} photos uploaded", {
                count: fieldworkProgress.uploaded,
                required: fieldworkProgress.required,
              })}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: t("Before photos"), count: fieldworkProgress.before },
                { label: t("After photos"), count: fieldworkProgress.after },
              ].map(({ label, count }) => (
                <div
                  key={label}
                  className="rounded-lg bg-muted/50 px-3 py-2"
                >
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">
                    {count}/3
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {readOnly && isCompleted && (
        <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
          <CardContent className="flex items-start gap-3 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
              <Check className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-card-foreground">
                {employeeJobStatusLabel(job.status, t)}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                {t("Completed at")}: {formatDate(job.completedAt, language)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {readOnly && employeeScreen !== "other" && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="mx-auto w-full max-w-2xl">
            {employeeScreen === "assigned" && (
              <Button
                type="button"
                className="min-h-12 w-full rounded-xl bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                disabled={lifecycleMutationPending}
                onClick={() =>
                  runLifecycleAction(acceptMutation, t("Job accepted."))
                }
              >
                {acceptMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Check />
                )}
                {t("Accept Job")}
              </Button>
            )}
            {employeeScreen === "accepted" && (
              <Button
                type="button"
                className="min-h-12 w-full rounded-xl bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                disabled={lifecycleMutationPending}
                onClick={() =>
                  runLifecycleAction(
                    startMutation,
                    job.status === "ON_HOLD"
                      ? t("Job resumed.")
                      : t("Job started."),
                  )
                }
              >
                {startMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Play />
                )}
                {t(job.status === "ON_HOLD" ? "Resume Job" : "Start Job")}
              </Button>
            )}
            {employeeScreen === "in-progress" && (
              <div className="grid min-w-0 grid-cols-2 gap-2">
                <Button
                  type="button"
                  className="h-auto min-h-12 w-full min-w-0 whitespace-normal rounded-xl bg-blue-600 px-2 py-2 text-center leading-5 text-white hover:bg-blue-700"
                  onClick={openFieldworkControls}
                >
                  {t("Continue fieldwork")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-12 w-full min-w-0 whitespace-normal rounded-xl border-border px-2 py-2 text-center leading-5"
                  disabled={lifecycleMutationPending}
                  onClick={() =>
                    runLifecycleAction(holdMutation, t("Job put on hold."))
                  }
                >
                  {holdMutation.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Pause />
                  )}
                  {t("Hold Job")}
                </Button>
              </div>
            )}
            {isCompleted && (
              <Button
                type="button"
                variant="outline"
                className="min-h-12 w-full rounded-xl"
                onClick={() => navigate(backPath)}
              >
                <ArrowLeft aria-hidden="true" />
                {t("Back to Jobs")}
              </Button>
            )}
          </div>
        </div>
      )}

      {readOnly && employeeScreen === "in-progress" && (
        <EmployeeDisclosure
          enabled
          id="employee-fieldwork-controls"
          title={t("Field Work")}
        >
          <EmployeeFieldWorkPanel job={job} />
        </EmployeeDisclosure>
      )}

      {readOnly && canLoadEmployeeMaterialUsage(job.status) && (
        job.status === "IN_PROGRESS" ? (
          <EmployeeDisclosure enabled title={t("Materials Used")}>
            <EmployeeMaterialUsageSection job={job} />
          </EmployeeDisclosure>
        ) : (
          <EmployeeMaterialUsageSection job={job} />
        )
      )}

      {readOnly && <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {!readOnly && (
          <Card>
            <CardHeader>
              <CardTitle>{t("Job Information")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <DetailRow label={t("Job ID")} value={formatValue(job.jobId)} />
                <DetailRow
                  label={t("Job number")}
                  value={formatValue(job.jobNumber)}
                />
                <DetailRow label={t("Title")} value={formatValue(job.title)} />
                <DetailRow label={t("Work type")} value={localize(formatJobWorkType(job.workType))} />
                {job.workType === "ac" && (
                  <DetailRow
                    label={t("AC sub-type")}
                    value={localize(formatAcSubType(job.acSubType))}
                  />
                )}
                <DetailRow label={t("Priority")} value={localize(formatLabel(job.priority))} />
                <DetailRow
                  label={t("Description")}
                  value={formatValue(job.description)}
                />
                <DetailRow label={t("Created")} value={formatDate(job.createdAt, language)} />
                <DetailRow label={t("Updated")} value={formatDate(job.updatedAt, language)} />
              </dl>
            </CardContent>
          </Card>
        )}

        {job.recurringMaintenance?.source === "RECURRING" && (
          <EmployeeDisclosure
            enabled={readOnly}
            title={t("Recurring Maintenance")}
          >
            <Card>
              <CardHeader>
                <CardTitle>{t("Recurring Maintenance")}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl>
                  <DetailRow
                    label={t("Type")}
                    value={localize(formatLabel(
                      job.recurringMaintenance.maintenanceType,
                    ))}
                  />
                  <DetailRow
                    label={t("Scheduled date")}
                    value={formatScheduledDate(
                      job.recurringMaintenance.scheduledDate,
                      language,
                    )}
                  />
                </dl>
              </CardContent>
            </Card>
          </EmployeeDisclosure>
        )}

        {!readOnly && (
          <Card>
            <CardHeader>
              <CardTitle>{t("ATM Information")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <DetailRow
                  label={t("ATM ID")}
                  value={formatValue(atmDetails?.atmId || atm?.atmId)}
                />
                <DetailRow
                  label={t("Location")}
                  value={formatValue(
                    atmDetails?.locationName || atm?.locationName,
                  )}
                />
                <DetailRow
                  label={t("Address")}
                  value={formatValue(atmDetails?.address || atm?.address)}
                />
                <DetailRow
                  label={t("Bank")}
                  value={formatValue(atmDetails?.bankId?.bankName || atm?.bank)}
                />
                <DetailRow
                  label={t("District")}
                  value={formatValue(atmDetails?.districtId?.districtName)}
                />
                <DetailRow
                  label={t("Region")}
                  value={formatValue(atmDetails?.regionId?.name)}
                />
                <DetailRow
                  label={t("ATM status")}
                  value={formatValue(atmDetails?.status)}
                />
                <DetailRow
                  label={t("Installation type")}
                  value={formatValue(atmDetails?.installationType)}
                />
                {isATMDetailsLoading && (
                  <DetailRow
                    label={t("Additional ATM information")}
                    value={t("Loading...")}
                  />
                )}
              </dl>
            </CardContent>
          </Card>
        )}

        <EmployeeDisclosure enabled={readOnly} title={t("Assignment")}>
          <Card>
            <CardHeader>
              <CardTitle>{t("Assignment")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <DetailRow label={t("Employee")} value={getPersonName(employee)} />
                <DetailRow
                  label={t("Employee code")}
                  value={formatValue(employee?.employeeCode)}
                />
                <DetailRow
                  label={t("Phone")}
                  value={formatValue(employee?.phoneNumber)}
                />
                <DetailRow
                  label={t("Assigned at")}
                  value={formatDate(job.assignedAt, language)}
                />
                <DetailRow
                  label={t("Assigned by")}
                  value={getPersonName(job.assignedBy)}
                />
              </dl>
            </CardContent>
          </Card>
        </EmployeeDisclosure>

        <EmployeeDisclosure enabled={readOnly} title={t("Customer")}>
          <Card>
            <CardHeader>
              <CardTitle>{t("Customer")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <DetailRow label={t("Name")} value={customerName} />
                <DetailRow
                  label={t("Email")}
                  value={formatValue(customer?.customerEmail)}
                />
                <DetailRow
                  label={t("Phone")}
                  value={formatValue(customer?.customerPhone)}
                />
                {!readOnly && (
                  <DetailRow
                    label={t("Customer reference")}
                    value={formatValue(
                      customer?._id ||
                        (typeof job.customerId === "string"
                          ? job.customerId
                          : undefined),
                    )}
                  />
                )}
              </dl>
            </CardContent>
          </Card>
        </EmployeeDisclosure>

        <EmployeeDisclosure enabled={readOnly} title={t("Complaint")}>
          <Card>
            <CardHeader>
              <CardTitle>{t("Complaint")}</CardTitle>
            </CardHeader>
            <CardContent>
              {complaint ? (
                <dl>
                  <DetailRow
                    label={t("Complaint number")}
                    value={formatValue(complaint.complaintNumber)}
                  />
                  <DetailRow label={t("Title")} value={formatValue(complaint.title)} />
                  <DetailRow
                    label={t("Description")}
                    value={formatValue(complaint.description)}
                  />
                  <DetailRow
                    label={t("Reported by")}
                    value={formatValue(complaint.reportedBy)}
                  />
                  <DetailRow
                    label={t("Reported via")}
                    value={localize(formatLabel(complaint.reportedVia))}
                  />
                  <DetailRow
                    label={t("Status")}
                    value={localize(formatLabel(complaint.status))}
                  />
                  <DetailRow
                    label={t("Reported at")}
                    value={formatDate(complaint.reportedAt, language)}
                  />
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("No complaint is linked to this job.")}
                </p>
              )}
            </CardContent>
          </Card>
        </EmployeeDisclosure>

        <EmployeeDisclosure enabled={readOnly} title={t("Lifecycle dates")}>
          <Card>
            <CardHeader>
              <CardTitle>{t("Lifecycle dates")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                {lifecycleDates.map(([label, value]) => (
                  <DetailRow
                    key={label}
                    label={t(label)}
                    value={formatDate(value, language)}
                  />
                ))}
              </dl>
            </CardContent>
          </Card>
        </EmployeeDisclosure>

        {!readOnly && (
          <Card>
            <CardHeader>
              <CardTitle>{t("Completion GPS")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <DetailRow
                  label={t("Latitude")}
                  value={formatGpsValue(job.employeeGpsAtCompletion?.latitude)}
                />
                <DetailRow
                  label={t("Longitude")}
                  value={formatGpsValue(job.employeeGpsAtCompletion?.longitude)}
                />
                <DetailRow
                  label={t("Accuracy")}
                  value={
                    job.employeeGpsAtCompletion?.accuracy !== undefined &&
                    Number.isFinite(job.employeeGpsAtCompletion.accuracy)
                      ? `${job.employeeGpsAtCompletion.accuracy} m`
                      : NOT_AVAILABLE
                  }
                />
                <DetailRow
                  label={t("Distance from ATM")}
                  value={
                    job.gpsDistance !== undefined &&
                    Number.isFinite(job.gpsDistance)
                      ? `${job.gpsDistance} m`
                      : NOT_AVAILABLE
                  }
                />
                <DetailRow
                  label={t("GPS validation")}
                  value={
                    job.gpsValidated === true ? (
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        {t("Validated")}
                      </Badge>
                    ) : job.gpsValidated === false ? (
                      <Badge variant="secondary">{t("Not validated")}</Badge>
                    ) : (
                      NOT_AVAILABLE
                    )
                  }
                />
                <DetailRow
                  label={t("Captured at")}
                  value={formatDate(job.employeeGpsAtCompletion?.timestamp, language)}
                />
              </dl>
            </CardContent>
          </Card>
        )}

        <EmployeeDisclosure enabled={readOnly} title={t("Audit")}>
          <Card>
            <CardHeader>
              <CardTitle>{t("Audit")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <DetailRow
                  label={t("Created by")}
                  value={getPersonName(job.createdBy)}
                />
                <DetailRow
                  label={t("Updated by")}
                  value={getPersonName(job.updatedBy)}
                />
              </dl>
            </CardContent>
          </Card>
        </EmployeeDisclosure>

        {(!readOnly ||
          (job.status !== "IN_PROGRESS" &&
            [...(job.beforePhotos ?? []), ...(job.afterPhotos ?? [])].some(
              (photo) => Boolean(photo?.url || photo?.thumbnailUrl),
            ))) && (
          <EmployeeDisclosure enabled={readOnly} title={t("Job Photos")}>
            <JobPhotoGallery
              beforePhotos={job.beforePhotos}
              afterPhotos={job.afterPhotos}
              compact={readOnly}
            />
          </EmployeeDisclosure>
        )}

        {(job.employeeRemarks ||
          job.adminRemarks ||
          job.rejectionReason ||
          job.cancellationReason ||
          job.isReassigned ||
          reassignmentHistory.length > 0) && (
          <EmployeeDisclosure
            enabled={readOnly}
            title={t("Notes and reassignment")}
          >
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t("Notes and reassignment")}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl>
                  {job.employeeRemarks && (
                    <DetailRow
                      label={t("Employee remarks")}
                      value={job.employeeRemarks}
                    />
                  )}
                  {job.adminRemarks && (
                    <DetailRow label={t("Admin remarks")} value={job.adminRemarks} />
                  )}
                  {job.rejectionReason && (
                    <DetailRow
                      label={t("Rejection reason")}
                      value={job.rejectionReason}
                    />
                  )}
                  {job.cancellationReason && (
                    <DetailRow
                      label={t("Cancellation reason")}
                      value={job.cancellationReason}
                    />
                  )}
                  {job.cancelledBy && (
                    <DetailRow
                      label={t("Cancelled by")}
                      value={getPersonName(job.cancelledBy)}
                    />
                  )}
                  {job.isReassigned && (
                    <DetailRow
                      label={t("Reassigned")}
                      value={job.reassignmentReason || t("Yes")}
                    />
                  )}
                  {job.previousJobId && (
                    <DetailRow
                      label={t("Previous job ID")}
                      value={job.previousJobId}
                    />
                  )}
                  {reassignmentHistory.map((entry, index) => (
                    <div
                      key={`${entry.reassignedAt || index}-${index}`}
                      className="border-b py-3 last:border-b-0"
                    >
                      <p className="text-sm font-medium">
                        {getEmployeeLabel(entry.fromEmployee)}
                        <span className="px-2 text-muted-foreground">{t("to")}</span>
                        {getEmployeeLabel(entry.toEmployee)}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatValue(entry.reason)} ·{" "}
                        {formatDate(entry.reassignedAt, language)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("Reassigned by")} {getPersonName(entry.reassignedBy)}
                      </p>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </EmployeeDisclosure>
        )}

        <EmployeeDisclosure enabled={readOnly} title={t("Job History")}>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("Job History")}</CardTitle>
            </CardHeader>
            <CardContent>
              {historyQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">
                  {t("Loading history...")}
                </p>
              ) : historyQuery.isError ? (
                <p role="status" className="text-sm text-destructive">
                  {t("Unable to load job history.")}
                </p>
              ) : historyQuery.data?.length ? (
                <ol>
                  {historyQuery.data.map((entry) => {
                    const actorName =
                      [
                        entry.performedBy?.firstName,
                        entry.performedBy?.lastName,
                      ]
                        .filter(Boolean)
                        .join(" ") || t("Unknown user");
                    const details = formatHistoryDetailLines(
                      entry.action,
                      entry.details,
                      t,
                      (label) => employeeDisplayLabel(label, t),
                      {
                        documentId: atmDetails?._id ?? atm?._id,
                        identifier: atmDetails?.atmId ?? atm?.atmId,
                      },
                    );

                    return (
                      <li
                        key={entry._id}
                        className="border-b py-3 last:border-b-0"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="text-sm font-medium">
                            {formatHistoryAction(entry.action, entry, t)}
                          </p>
                          <time className="text-xs text-muted-foreground">
                            {formatDate(entry.performedAt, language)}
                          </time>
                        </div>
                        {entry.fromStatus && entry.toStatus && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {localize(formatLabel(entry.fromStatus))} -&gt;{" "}
                            {localize(formatLabel(entry.toStatus))}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("Performed by: {name}", { name: actorName })}
                          {entry.performedBy?.userType && (
                            <>
                              {" "}
                              · {t("Role: {role}", { role: localize(formatLabel(entry.performedBy.userType)) })}
                            </>
                          )}
                        </p>
                        {details.map((detail, index) => (
                          <p
                            key={`${entry._id}-detail-${index}`}
                            className="mt-2 break-words text-xs text-muted-foreground"
                          >
                            {detail}
                          </p>
                        ))}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("No history available.")}
                </p>
              )}
            </CardContent>
          </Card>
        </EmployeeDisclosure>
      </div>}

      {!readOnly && (
        <>
          <AdminMaterialUsageSection job={job} />
          <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("Job Information")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label={t("Job ID")} value={formatValue(job.jobId)} />
              <DetailRow
                label={t("Job number")}
                value={formatValue(job.jobNumber)}
              />
              <DetailRow label={t("Title")} value={formatValue(job.title)} />
              <DetailRow label={t("Work type")} value={localize(formatJobWorkType(job.workType))} />
              {job.workType === "ac" && (
                <DetailRow
                  label={t("AC sub-type")}
                  value={localize(formatAcSubType(job.acSubType))}
                />
              )}
              <DetailRow label={t("Priority")} value={localize(formatLabel(job.priority))} />
              <DetailRow
                label={t("Description")}
                value={formatValue(job.description)}
              />
              <DetailRow label={t("Created")} value={formatDate(job.createdAt, language)} />
              <DetailRow label={t("Updated")} value={formatDate(job.updatedAt, language)} />
            </dl>
          </CardContent>
        </Card>

        {job.recurringMaintenance?.source === "RECURRING" && (
          <Card>
            <CardHeader>
              <CardTitle>{t("Recurring Maintenance")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <DetailRow
                  label={t("Type")}
                  value={localize(formatLabel(
                    job.recurringMaintenance.maintenanceType,
                  ))}
                />
                <DetailRow
                  label={t("Scheduled date")}
                  value={formatScheduledDate(
                    job.recurringMaintenance.scheduledDate,
                    language,
                  )}
                />
              </dl>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t("ATM Information")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow
                label={t("ATM ID")}
                value={formatValue(atmDetails?.atmId || atm?.atmId)}
              />
              <DetailRow
                label={t("Location")}
                value={formatValue(
                  atmDetails?.locationName || atm?.locationName,
                )}
              />
              <DetailRow
                label={t("Address")}
                value={formatValue(atmDetails?.address || atm?.address)}
              />
              <DetailRow
                label={t("Bank")}
                value={formatValue(atmDetails?.bankId?.bankName || atm?.bank)}
              />
              <DetailRow
                label={t("District")}
                value={formatValue(atmDetails?.districtId?.districtName)}
              />
              <DetailRow
                label={t("Region")}
                value={formatValue(atmDetails?.regionId?.name)}
              />
              <DetailRow
                label={t("ATM status")}
                value={formatValue(atmDetails?.status)}
              />
              <DetailRow
                label={t("Installation type")}
                value={formatValue(atmDetails?.installationType)}
              />
              {isATMDetailsLoading && (
                <DetailRow
                  label={t("Additional ATM information")}
                  value={t("Loading...")}
                />
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Assignment")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label={t("Employee")} value={getPersonName(employee)} />
              <DetailRow
                label={t("Employee code")}
                value={formatValue(employee?.employeeCode)}
              />
              <DetailRow
                label={t("Phone")}
                value={formatValue(employee?.phoneNumber)}
              />
              <DetailRow
                label={t("Assigned at")}
                value={formatDate(job.assignedAt, language)}
              />
              <DetailRow
                label={t("Assigned by")}
                value={getPersonName(job.assignedBy)}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Customer")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label={t("Name")} value={customerName} />
              <DetailRow
                label={t("Email")}
                value={formatValue(customer?.customerEmail)}
              />
              <DetailRow
                label={t("Phone")}
                value={formatValue(customer?.customerPhone)}
              />
              {!readOnly && (
                <DetailRow
                  label={t("Customer reference")}
                  value={formatValue(
                    customer?._id ||
                      (typeof job.customerId === "string"
                        ? job.customerId
                        : undefined),
                  )}
                />
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Complaint")}</CardTitle>
          </CardHeader>
          <CardContent>
            {complaint ? (
              <dl>
                <DetailRow
                  label={t("Complaint number")}
                  value={formatValue(complaint.complaintNumber)}
                />
                <DetailRow label={t("Title")} value={formatValue(complaint.title)} />
                <DetailRow
                  label={t("Description")}
                  value={formatValue(complaint.description)}
                />
                <DetailRow
                  label={t("Reported by")}
                  value={formatValue(complaint.reportedBy)}
                />
                <DetailRow
                  label={t("Reported via")}
                  value={localize(formatLabel(complaint.reportedVia))}
                />
                <DetailRow
                  label={t("Status")}
                  value={localize(formatLabel(complaint.status))}
                />
                <DetailRow
                  label={t("Reported at")}
                  value={formatDate(complaint.reportedAt, language)}
                />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("No complaint is linked to this job.")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Lifecycle dates")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              {lifecycleDates.map(([label, value]) => (
                <DetailRow
                  key={label}
                  label={t(label)}
                  value={formatDate(value, language)}
                />
              ))}
            </dl>
          </CardContent>
        </Card>

        {!readOnly && (
          <Card>
            <CardHeader>
              <CardTitle>{t("Completion GPS")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <DetailRow
                  label={t("Latitude")}
                  value={formatGpsValue(job.employeeGpsAtCompletion?.latitude)}
                />
                <DetailRow
                  label={t("Longitude")}
                  value={formatGpsValue(job.employeeGpsAtCompletion?.longitude)}
                />
                <DetailRow
                  label={t("Accuracy")}
                  value={
                    job.employeeGpsAtCompletion?.accuracy !== undefined &&
                    Number.isFinite(job.employeeGpsAtCompletion.accuracy)
                      ? `${job.employeeGpsAtCompletion.accuracy} m`
                      : NOT_AVAILABLE
                  }
                />
                <DetailRow
                  label={t("Distance from ATM")}
                  value={
                    job.gpsDistance !== undefined &&
                    Number.isFinite(job.gpsDistance)
                      ? `${job.gpsDistance} m`
                      : NOT_AVAILABLE
                  }
                />
                <DetailRow
                  label={t("GPS validation")}
                  value={
                    job.gpsValidated === true ? (
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        {t("Validated")}
                      </Badge>
                    ) : job.gpsValidated === false ? (
                      <Badge variant="secondary">{t("Not validated")}</Badge>
                    ) : (
                      NOT_AVAILABLE
                    )
                  }
                />
                <DetailRow
                  label={t("Captured at")}
                  value={formatDate(job.employeeGpsAtCompletion?.timestamp, language)}
                />
              </dl>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t("Audit")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow
                label={t("Created by")}
                value={getPersonName(job.createdBy)}
              />
              <DetailRow
                label={t("Updated by")}
                value={getPersonName(job.updatedBy)}
              />
            </dl>
          </CardContent>
        </Card>

        {(!readOnly || job.status !== "IN_PROGRESS") && (
          <JobPhotoGallery
            beforePhotos={job.beforePhotos}
            afterPhotos={job.afterPhotos}
          />
        )}

        {(job.employeeRemarks ||
          job.adminRemarks ||
          job.rejectionReason ||
          job.cancellationReason ||
          job.isReassigned ||
          reassignmentHistory.length > 0) && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("Notes and reassignment")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                {job.employeeRemarks && (
                  <DetailRow
                    label={t("Employee remarks")}
                    value={job.employeeRemarks}
                  />
                )}
                {job.adminRemarks && (
                  <DetailRow label={t("Admin remarks")} value={job.adminRemarks} />
                )}
                {job.rejectionReason && (
                  <DetailRow
                    label={t("Rejection reason")}
                    value={job.rejectionReason}
                  />
                )}
                {job.cancellationReason && (
                  <DetailRow
                    label={t("Cancellation reason")}
                    value={job.cancellationReason}
                  />
                )}
                {job.cancelledBy && (
                  <DetailRow
                    label={t("Cancelled by")}
                    value={getPersonName(job.cancelledBy)}
                  />
                )}
                {job.isReassigned && (
                  <DetailRow
                    label={t("Reassigned")}
                    value={job.reassignmentReason || t("Yes")}
                  />
                )}
                {job.previousJobId && (
                  <DetailRow
                    label={t("Previous job ID")}
                    value={job.previousJobId}
                  />
                )}
                {reassignmentHistory.map((entry, index) => (
                  <div
                    key={`${entry.reassignedAt || index}-${index}`}
                    className="border-b py-3 last:border-b-0"
                  >
                    <p className="text-sm font-medium">
                      {getEmployeeLabel(entry.fromEmployee)}
                      <span className="px-2 text-muted-foreground">{t("to")}</span>
                      {getEmployeeLabel(entry.toEmployee)}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatValue(entry.reason)} ·{" "}
                      {formatDate(entry.reassignedAt, language)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("Reassigned by")} {getPersonName(entry.reassignedBy)}
                    </p>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}

        {!readOnly && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("Job History")}</CardTitle>
            </CardHeader>
            <CardContent>
              {historyQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">
                  {t("Loading history...")}
                </p>
              ) : historyQuery.isError ? (
                <p role="status" className="text-sm text-destructive">
                  {t("Unable to load job history.")}
                </p>
              ) : historyQuery.data?.length ? (
                <ol>
                  {historyQuery.data.map((entry) => {
                    const actorName =
                      [
                        entry.performedBy?.firstName,
                        entry.performedBy?.lastName,
                      ]
                        .filter(Boolean)
                        .join(" ") || t("Unknown user");
                    const details = formatHistoryDetailLines(
                      entry.action,
                      entry.details,
                      t,
                      (label) => employeeDisplayLabel(label, t),
                      {
                        documentId: atmDetails?._id ?? atm?._id,
                        identifier: atmDetails?.atmId ?? atm?.atmId,
                      },
                    );

                    return (
                      <li
                        key={entry._id}
                        className="border-b py-3 last:border-b-0"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="text-sm font-medium">
                            {formatHistoryAction(entry.action, entry, t)}
                          </p>
                          <time className="text-xs text-muted-foreground">
                            {formatDate(entry.performedAt, language)}
                          </time>
                        </div>
                        {entry.fromStatus && entry.toStatus && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {localize(formatLabel(entry.fromStatus))} -&gt;{" "}
                            {localize(formatLabel(entry.toStatus))}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("Performed by: {name}", { name: actorName })}
                          {entry.performedBy?.userType && (
                            <>
                              {" "}
                              · {t("Role: {role}", { role: localize(formatLabel(entry.performedBy.userType)) })}
                            </>
                          )}
                        </p>
                        {details.map((detail, index) => (
                          <p
                            key={`${entry._id}-detail-${index}`}
                            className="mt-2 break-words text-xs text-muted-foreground"
                          >
                            {detail}
                          </p>
                        ))}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("No history available.")}
                </p>
              )}
            </CardContent>
          </Card>
        )}
          </div>
        </>
      )}

      {isAssignDialogOpen && (
        <AssignJobDialog
          job={job}
          onClose={() => setIsAssignDialogOpen(false)}
        />
      )}

      <Dialog open={isRejectDialogOpen} onOpenChange={handleRejectDialogChange}>
        <DialogContent>
          <div className="space-y-2">
            <DialogTitle>{t("Reject Job")}</DialogTitle>
            <DialogDescription>
              {t("This job will move to Rejected. You may optionally provide a reason.")}
            </DialogDescription>
          </div>
          <div className="mt-4">
            <label
              htmlFor="job-rejection-remarks"
              className="mb-2 block text-sm font-medium"
            >
              {t("Rejection reason")}
            </label>
            <textarea
              id="job-rejection-remarks"
              value={rejectionRemarks}
              onChange={(event) => setRejectionRemarks(event.target.value)}
              rows={4}
              disabled={reviewMutationPending}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleRejectDialogChange(false)}
              disabled={reviewMutationPending}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmReject}
              disabled={reviewMutationPending}
            >
              {reviewMutationPending && (
                <LoaderCircle className="animate-spin" />
              )}
              {t("Confirm Reject")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={isCancelDialogOpen} onOpenChange={handleCancelDialogChange}>
        <DialogContent>
          <div className="space-y-2">
            <DialogTitle>{t("Cancel Job")}</DialogTitle>
            <DialogDescription>
              {t("Cancel {job}? This job will remain in history with its material and cost records intact. Any linked complaint will retain this job in its history; an active complaint will reopen for replacement work.", {
                job: job.jobNumber || job.jobId,
              })}
            </DialogDescription>
          </div>
          <div className="mt-4">
            <label
              htmlFor="job-cancellation-reason"
              className="mb-2 block text-sm font-medium"
            >
              {t("Cancellation reason")}
            </label>
            <textarea
              id="job-cancellation-reason"
              value={cancellationReason}
              onChange={(event) => setCancellationReason(event.target.value)}
              rows={4}
              maxLength={1000}
              required
              disabled={cancelMutation.isPending}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleCancelDialogChange(false)}
              disabled={cancelMutation.isPending}
            >
              {t("Keep Job")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmCancel}
              disabled={cancelMutation.isPending || !cancellationReason.trim()}
            >
              {cancelMutation.isPending && (
                <LoaderCircle className="animate-spin" />
              )}
              {t("Confirm Cancellation")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
