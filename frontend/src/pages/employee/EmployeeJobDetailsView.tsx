import { isAxiosError } from "axios";
import {
  ArrowLeft,
  Check,
  Clock3,
  LoaderCircle,
  MapPin,
  Pause,
  Play,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import EmployeeFieldWorkPanel from "@/features/jobs/components/EmployeeFieldWorkPanel";
import EmployeeMaterialUsageSection from "@/features/jobs/components/EmployeeMaterialUsageSection";
import JobPhotoGallery from "@/features/jobs/components/JobPhotoGallery";
import {
  useAcceptJob,
  useHoldJob,
  useStartJob,
} from "@/features/jobs/hooks/useJobLifecycle";
import { useJobHistory } from "@/features/jobs/hooks/useJobHistory";
import { useJob } from "@/features/jobs/hooks/useJob";
import {
  employeeDisplayLabel,
  employeeErrorMessage,
  employeeJobStatusLabel,
  employeeLanguageClasses,
  useEmployeeLanguage,
} from "@/features/employee-portal/i18n";
import {
  formatAcSubType,
  formatJobWorkType,
} from "@/features/jobs/utils/jobWorkType.utils";
import {
  EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE,
  getEmployeeFieldworkProgress,
  getEmployeeJobDetailsScreen,
  canLoadEmployeeMaterialUsage,
} from "@/features/jobs/utils/employeeJobDetails.utils";
import { formatHistoryDetailLines } from "@/features/jobs/utils/formatJobHistoryDetails";
import type {
  Job,
  JobHistoryEntry,
  JobStatus,
  JobUser,
} from "@/features/jobs/types/job.types";

type EmployeeScreen =
  | "assigned"
  | "accepted"
  | "on-hold"
  | "in-progress"
  | "completed"
  | "other";

const EMPTY_HISTORY: JobHistoryEntry[] = [];

function formatDate(value: string | null | undefined, language: "ta" | "en") {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(language === "ta" ? "ta-IN" : "en-IN");
}

function formatScheduledDate(value: string, language: "ta" | "en") {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(language === "ta" ? "ta-IN" : "en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function getPersonName(person?: JobUser | string | null) {
  if (!person || typeof person === "string") return "";
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const { t } = useEmployeeLanguage();
  return (
    <div className="flex min-w-0 flex-col gap-1 border-b border-border py-2 last:border-b-0 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere] sm:text-right">
        {value || t("Not available")}
      </dd>
    </div>
  );
}

function getStatusVariant(status: JobStatus) {
  if (status === "REJECTED" || status === "CANCELLED") {
    return "destructive" as const;
  }
  if (status === "PENDING" || status === "ON_HOLD") {
    return "secondary" as const;
  }
  if (status === "CLOSED") return "outline" as const;
  return "default" as const;
}

function getScreen(status: JobStatus): EmployeeScreen {
  if (status === "ON_HOLD") return "on-hold";
  return getEmployeeJobDetailsScreen(status);
}

function getATM(job: Job) {
  return typeof job.atmId === "object" && job.atmId ? job.atmId : null;
}

function getHoldReason(history: JobHistoryEntry[]) {
  const holdEntry = [...history]
    .filter(
      (entry) =>
        entry.action === "status_changed" && entry.toStatus === "ON_HOLD",
    )
    .sort(
      (left, right) =>
        new Date(right.performedAt).getTime() -
        new Date(left.performedAt).getTime(),
    )[0];
  if (!holdEntry?.details || typeof holdEntry.details !== "object") return "";
  const details = holdEntry.details as Record<string, unknown>;
  return typeof details.holdReason === "string"
    ? details.holdReason.trim()
    : "";
}

function getHistoryActionLabel(
  entry: JobHistoryEntry,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  if (entry.action === "status_changed") {
    if (entry.toStatus === "IN_PROGRESS" && entry.fromStatus === "ON_HOLD") {
      return t("Resumed");
    }
    if (entry.toStatus === "IN_PROGRESS") return t("Started");
    if (entry.toStatus === "ON_HOLD") return t("Put On Hold");
    if (entry.toStatus === "ACCEPTED") return t("Accepted");
    if (entry.toStatus === "COMPLETED") return t("Completed");
  }

  const labels: Record<string, string> = {
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
  const label = labels[entry.action] ?? entry.action;
  return employeeDisplayLabel(label, t);
}

function JobLoadingState() {
  const { t } = useEmployeeLanguage();
  return (
    <main
      className="mx-auto w-full max-w-4xl space-y-4 px-3 pb-32 pt-3 sm:px-5"
      role="status"
    >
      <div className="h-52 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" />
      <div className="h-24 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" />
      <p className="sr-only">{t("Loading job details...")}</p>
    </main>
  );
}

export default function EmployeeJobDetailsView() {
  const navigate = useNavigate();
  const { jobId = "" } = useParams<{ jobId: string }>();
  const { language, t } = useEmployeeLanguage();
  const [hasPendingSelections, setHasPendingSelections] = useState(false);
  const [isHoldDialogOpen, setIsHoldDialogOpen] = useState(false);
  const [holdReasonDraft, setHoldReasonDraft] = useState("");
  const acceptMutation = useAcceptJob();
  const startMutation = useStartJob();
  const holdMutation = useHoldJob();
  const jobQuery = useJob(jobId);
  const historyQuery = useJobHistory(jobId);
  useEffect(() => {
    if (!hasPendingSelections) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const confirmInternalNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (
        !link ||
        (link.target && link.target !== "_self") ||
        link.hasAttribute("download")
      ) {
        return;
      }
      const destination = new URL(link.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname &&
          destination.search === window.location.search)
      ) {
        return;
      }
      if (!window.confirm(t("You have selected photos that have not been uploaded. Leave this job and discard them?"))) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", confirmInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", confirmInternalNavigation, true);
    };
  }, [hasPendingSelections, t]);

  if (jobQuery.isLoading) return <JobLoadingState />;

  if (jobQuery.isError || !jobQuery.data) {
    const notFound =
      isAxiosError(jobQuery.error) && jobQuery.error.response?.status === 404;
    const apiMessage = isAxiosError<{ message?: string }>(jobQuery.error)
      ? jobQuery.error.response?.data?.message
      : undefined;
    const fallback = notFound
      ? "This job may have been removed."
      : "The job could not be loaded. Please try again.";
    return (
      <main className="mx-auto w-full max-w-4xl space-y-4 px-3 pb-8 pt-3 sm:px-5">
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={() => navigate("/employee/jobs")}
        >
          <ArrowLeft aria-hidden="true" />
          {t("Back to Jobs")}
        </Button>
        <section
          className="max-w-xl space-y-3 border-l-2 border-destructive pl-4"
          role="alert"
        >
          <h1 className="font-semibold">{t(notFound ? "Job not found" : "Job details unavailable")}</h1>
          <p className="break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
            {employeeErrorMessage(apiMessage || t(fallback), fallback, language, t)}
          </p>
          {!notFound && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void jobQuery.refetch()}
              disabled={jobQuery.isFetching}
            >
              {jobQuery.isFetching ? t("Retrying...") : t("Retry")}
            </Button>
          )}
        </section>
      </main>
    );
  }

  const job = jobQuery.data;
  const atm = getATM(job);
  const complaint =
    typeof job.complaintId === "object" && job.complaintId
      ? job.complaintId
      : null;
  const customer =
    typeof job.customerId === "object" && job.customerId
      ? job.customerId
      : null;
  const screen = getScreen(job.status);
  const progress = getEmployeeFieldworkProgress(job);
  const priorityLabel = `${job.priority[0].toUpperCase()}${job.priority.slice(1)}`;
  const history = historyQuery.data ?? EMPTY_HISTORY;
  const recordedHoldReason =
    screen === "on-hold" && historyQuery.isSuccess
      ? getHoldReason(history)
      : "";
  const mutationPending =
    acceptMutation.isPending || startMutation.isPending || holdMutation.isPending;

  const runLifecycleAction = (
    mutation: typeof acceptMutation,
    successMessage: Parameters<typeof t>[0],
  ) => {
    if (mutationPending) return;
    mutation.mutate(
      { jobId: job._id },
      {
        onSuccess: () => toast.success(t(successMessage)),
        onError: (error) =>
          toast.error(
            employeeErrorMessage(
              isAxiosError<{ message?: string }>(error)
                ? error.response?.data?.message || "Could not update this job."
                : error instanceof Error
                  ? error.message
                  : "Could not update this job.",
              "Could not update this job.",
              language,
              t,
            ),
          ),
      },
    );
  };

  const runHoldAction = () => {
    if (
      mutationPending ||
      progress.before < EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE
    ) {
      return;
    }
    holdMutation.mutate(
      { jobId: job._id, reason: holdReasonDraft.trim() || undefined },
      {
        onSuccess: () => {
          setIsHoldDialogOpen(false);
          setHoldReasonDraft("");
          toast.success(t("Job put on hold."));
        },
        onError: (error) =>
          toast.error(
            employeeErrorMessage(
              isAxiosError<{ message?: string }>(error)
                ? error.response?.data?.message || "Could not update this job."
                : error instanceof Error
                  ? error.message
                  : "Could not update this job.",
              "Could not update this job.",
              language,
              t,
            ),
          ),
      },
    );
  };

  const leaveForJobs = () => {
    if (
      hasPendingSelections &&
      !window.confirm(
        t("You have selected photos that have not been uploaded. Leave this job and discard them?"),
      )
    ) {
      return;
    }
    navigate("/employee/jobs");
  };

  const openFieldwork = () => {
    document.getElementById("employee-fieldwork")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };

  return (
    <main
      className={`mx-auto w-full min-w-0 max-w-4xl pb-32 pt-3 ${employeeLanguageClasses(language, "space-y-5 px-3 sm:px-5", "space-y-4 px-3 sm:px-5")}`}
    >
      <Button
        type="button"
        variant="ghost"
        className="-ml-3 min-h-11"
        onClick={leaveForJobs}
      >
        <ArrowLeft aria-hidden="true" />
        {t("Back to Jobs")}
      </Button>

      <header className="min-w-0 space-y-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="break-words text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]">
              {t("Job ID")}: {job.jobId}
            </p>
            {job.jobNumber && job.jobNumber !== job.jobId && (
              <p className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {t("Job number")}: {job.jobNumber}
              </p>
            )}
            <h1 className="mt-1 break-words text-2xl font-semibold leading-8 tracking-tight [overflow-wrap:anywhere]">
              {job.title}
            </h1>
          </div>
          <Badge
            variant={getStatusVariant(job.status)}
            className="max-w-full whitespace-normal text-center leading-5"
          >
            {employeeJobStatusLabel(job.status, t)}
          </Badge>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium">
            {employeeDisplayLabel(formatJobWorkType(job.workType), t)}
            {job.workType === "ac" && job.acSubType
              ? ` · ${employeeDisplayLabel(formatAcSubType(job.acSubType), t)}`
              : ""}
          </span>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span className="capitalize text-muted-foreground">
            {employeeDisplayLabel(priorityLabel, t)}
          </span>
        </div>
      </header>

      <section className="min-w-0 border-y border-border py-4">
        <h2 className="sr-only">{t("ATM Information")}</h2>
        <p className="flex items-start gap-2 text-sm font-semibold leading-6">
          <MapPin className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {atm?.atmId || t("Not available")}
            {atm?.locationName ? ` · ${atm.locationName}` : ""}
          </span>
        </p>
        {(atm?.address || atm?.bank) && (
          <p className="mt-1 break-words pl-6 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
            {[atm?.address, atm?.bank].filter(Boolean).join(" · ")}
          </p>
        )}
      </section>

      {screen === "in-progress" && (
        <section aria-labelledby="employee-evidence-progress" className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="employee-evidence-progress" className="text-sm font-semibold">
              {t("Fieldwork progress")}
            </h2>
            <span className="text-sm tabular-nums text-muted-foreground">
              {progress.uploaded}/{progress.required}
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={t("Fieldwork progress")}
            aria-valuemin={0}
            aria-valuemax={progress.required}
            aria-valuenow={progress.uploaded}
          >
            <div
              className="h-full bg-primary transition-[width] motion-reduce:transition-none"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("{count} of {required} photos uploaded", {
              count: progress.uploaded,
              required: progress.required,
            })}
          </p>
        </section>
      )}

      {screen === "accepted" && job.acceptedAt && (
        <p className="text-sm text-muted-foreground">
          {t("Accepted on")}: {formatDate(job.acceptedAt, language)}
        </p>
      )}

      {screen === "on-hold" && (
        <section className="space-y-3 border-l-2 border-amber-500 pl-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Pause className="size-4 shrink-0" aria-hidden="true" />
            {t("Hold Reason")}
          </p>
          {historyQuery.isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("Loading history...")}
            </p>
          ) : historyQuery.isError ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {t("Unable to load job history.")}
              </p>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => void historyQuery.refetch()}
                disabled={historyQuery.isFetching}
              >
                {historyQuery.isFetching ? t("Retrying...") : t("Retry")}
              </Button>
            </div>
          ) : (
            <div>
              <p className="mt-1 break-words text-sm leading-6 [overflow-wrap:anywhere]">
                {recordedHoldReason || t("No hold reason was recorded.")}
              </p>
            </div>
          )}
          <div className="space-y-1 text-sm text-muted-foreground">
            <p className="font-medium">{t("Remaining work")}</p>
            <p>
              {t("Before photos")}: {progress.before}/
              {EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE}
            </p>
            <p>
              {t("After photos")}: {progress.after}/
              {EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE}
            </p>
            <p>{t("Get your current location to complete this job.")}</p>
          </div>
        </section>
      )}

      {job.description && screen !== "in-progress" && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t("Description")}</h2>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
            {job.description}
          </p>
        </section>
      )}

      {(complaint || screen === "accepted") && screen !== "in-progress" && (
        <section className="space-y-2 border-t border-border pt-4">
          <h2 className="text-sm font-semibold">{t("Complaint")}</h2>
          {complaint?.complaintNumber && (
            <p className="text-xs text-muted-foreground">
              {complaint.complaintNumber}
            </p>
          )}
          {complaint?.title && <p className="text-sm font-medium">{complaint.title}</p>}
          {complaint?.description && (
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
              {complaint.description}
            </p>
          )}
          {!complaint && (
            <p className="text-sm text-muted-foreground">
              {t("No complaint is linked to this job.")}
            </p>
          )}
        </section>
      )}

      {screen === "in-progress" && (
        <div id="employee-fieldwork" className="scroll-mt-4">
          <EmployeeFieldWorkPanel
            job={job}
            onPendingSelectionChange={setHasPendingSelections}
            workDescription={
              job.description || complaint ? (
                <section className="space-y-4 border-t border-border pt-4">
                  {job.description && (
                    <div className="space-y-2">
                      <h2 className="text-sm font-semibold">{t("Description")}</h2>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                        {job.description}
                      </p>
                    </div>
                  )}
                  {complaint && (
                    <div className="space-y-2">
                      <h2 className="text-sm font-semibold">{t("Complaint")}</h2>
                      {complaint.title && (
                        <p className="text-sm font-medium">{complaint.title}</p>
                      )}
                      {complaint.description && (
                        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                          {complaint.description}
                        </p>
                      )}
                    </div>
                  )}
                </section>
              ) : null
            }
            materials={
              <EmployeeMaterialUsageSection
                job={job}
                showEmpty
                hideUsageHeading
              />
            }
          />
        </div>
      )}

      {screen === "on-hold" && (
        <>
          <JobPhotoGallery
            beforePhotos={job.beforePhotos}
            afterPhotos={job.afterPhotos}
            compact
            showCounts={false}
          />
          <EmployeeMaterialUsageSection job={job} showEmpty />
        </>
      )}

      {canLoadEmployeeMaterialUsage(job.status) &&
        screen !== "in-progress" &&
        screen !== "on-hold" &&
        screen !== "completed" && (
          <EmployeeMaterialUsageSection job={job} />
        )}

      {screen !== "in-progress" &&
        screen !== "on-hold" &&
        screen !== "completed" &&
        [...(job.beforePhotos ?? []), ...(job.afterPhotos ?? [])].some(
          (photo) => Boolean(photo?.url || photo?.thumbnailUrl),
        ) && (
          <JobPhotoGallery
            beforePhotos={job.beforePhotos}
            afterPhotos={job.afterPhotos}
            compact
          />
        )}

      {screen === "completed" && (
        <>
          <section className="space-y-2 border-y border-border py-4">
            {job.completedAt && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock3 className="size-4 shrink-0" aria-hidden="true" />
                {t("Completed at")}: {formatDate(job.completedAt, language)}
              </p>
            )}
            {job.gpsValidated === true && (
              <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                <Check className="size-4 shrink-0" aria-hidden="true" />
                {t("Validated")}
              </p>
            )}
          </section>
          <JobPhotoGallery
            beforePhotos={job.beforePhotos}
            afterPhotos={job.afterPhotos}
            compact
          />
          <EmployeeMaterialUsageSection job={job} showEmpty />
        </>
      )}

      {job.recurringMaintenance?.source === "RECURRING" && (
        <details className="border-t border-border py-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("Recurring Maintenance")}
          </summary>
          <dl className="pt-2">
            <DetailRow
              label={t("Type")}
              value={employeeDisplayLabel(
                job.recurringMaintenance.maintenanceType
                  .toLowerCase()
                  .split("_")
                  .map((part) => part[0].toUpperCase() + part.slice(1))
                  .join(" "),
                t,
              )}
            />
            <DetailRow
              label={t("Scheduled date")}
              value={
                formatScheduledDate(job.recurringMaintenance.scheduledDate, language) ||
                t("Not available")
              }
            />
          </dl>
        </details>
      )}

      <details className="border-t border-border py-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("Assignment")}
        </summary>
        <dl className="pt-2">
          <DetailRow
            label={t("Employee")}
            value={getPersonName(
              typeof job.assignedEmployeeId === "object"
                ? job.assignedEmployeeId
                : null,
            )}
          />
          <DetailRow
            label={t("Employee code")}
            value={
              typeof job.assignedEmployeeId === "object"
                ? job.assignedEmployeeId?.employeeCode
                : null
            }
          />
          <DetailRow
            label={t("Phone")}
            value={
              typeof job.assignedEmployeeId === "object"
                ? job.assignedEmployeeId?.phoneNumber
                : null
            }
          />
          <DetailRow
            label={t("Assigned at")}
            value={formatDate(job.assignedAt, language)}
          />
          <DetailRow
            label={t("Assigned by")}
            value={getPersonName(
              typeof job.assignedBy === "object" ? job.assignedBy : null,
            )}
          />
        </dl>
      </details>

      <details className="border-t border-border py-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("Customer")}
        </summary>
        <dl className="pt-2">
          <DetailRow label={t("Name")} value={customer?.customerName} />
          <DetailRow label={t("Email")} value={customer?.customerEmail} />
          <DetailRow label={t("Phone")} value={customer?.customerPhone} />
        </dl>
      </details>

      <details className="border-t border-border py-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("Lifecycle dates")}
        </summary>
        <dl className="pt-2">
          {(
            [
              ["Created", job.createdAt],
              ["Assigned", job.assignedAt],
              ["Accepted", job.acceptedAt],
              ["Started", job.startedAt],
              ["Completed", job.completedAt],
              ["Verified", job.verifiedAt],
              ["Approved", job.approvedAt],
              ["Closed", job.closedAt],
              ["Rejected", job.rejectedAt],
              ["Cancelled", job.cancelledAt],
            ] as const
          ).map(([label, date]) => (
            <DetailRow
              key={label}
              label={t(label)}
              value={formatDate(date, language)}
            />
          ))}
        </dl>
      </details>

      <details className="border-t border-border py-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("Audit")}
        </summary>
        <dl className="pt-2">
          <DetailRow
            label={t("Created by")}
            value={getPersonName(
              typeof job.createdBy === "object" ? job.createdBy : null,
            )}
          />
          <DetailRow
            label={t("Updated by")}
            value={getPersonName(
              typeof job.updatedBy === "object" ? job.updatedBy : null,
            )}
          />
          <DetailRow
            label={t("Updated")}
            value={formatDate(job.updatedAt, language)}
          />
        </dl>
      </details>

      {(job.employeeRemarks ||
        job.adminRemarks ||
        job.rejectionReason ||
        job.cancellationReason ||
        job.isReassigned ||
        (job.reassignmentHistory?.length ?? 0) > 0) && (
        <details className="border-t border-border py-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("Notes and reassignment")}
          </summary>
          <dl className="pt-2">
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
                value={getPersonName(
                  typeof job.cancelledBy === "object"
                    ? job.cancelledBy
                    : null,
                )}
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
          </dl>
          {job.reassignmentHistory?.map((entry, index) => (
            <div
              key={`${entry.reassignedAt || index}-${index}`}
              className="space-y-1 break-words border-t border-border py-3 text-sm [overflow-wrap:anywhere]"
            >
              <p>
                {getPersonName(
                  typeof entry.fromEmployee === "object"
                    ? entry.fromEmployee
                    : null,
                ) || t("Not available")}
                {" → "}
                {getPersonName(
                  typeof entry.toEmployee === "object"
                    ? entry.toEmployee
                    : null,
                ) || t("Not available")}
              </p>
              <p className="text-muted-foreground">
                {entry.reason || t("Not available")}
                {" · "}
                {formatDate(entry.reassignedAt, language) ||
                  t("Not available")}
              </p>
              {entry.reassignedBy && (
                <p className="text-xs text-muted-foreground">
                  {t("Reassigned by")}{" "}
                  {getPersonName(
                    typeof entry.reassignedBy === "object"
                      ? entry.reassignedBy
                      : null,
                  ) || t("Not available")}
                </p>
              )}
            </div>
          ))}
        </details>
      )}

      <details className="group border-t border-border py-3">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("Job History")}
            <span className="text-xs font-normal text-muted-foreground">
              {history.length}
            </span>
          </summary>
          <div className="pt-3">
            {historyQuery.isLoading ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t("Loading history...")}
              </p>
            ) : historyQuery.isError ? (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  {t("Unable to load job history.")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => void historyQuery.refetch()}
                  disabled={historyQuery.isFetching}
                >
                  {historyQuery.isFetching ? t("Retrying...") : t("Retry")}
                </Button>
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("No history available.")}
              </p>
            ) : (
              <ol className="divide-y divide-border">
                {history.map((entry) => {
                  const actor =
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
                    { identifier: atm?.atmId, documentId: atm?._id },
                  );
                  return (
                    <li key={entry._id} className="space-y-1 py-3">
                      <div className="flex flex-wrap justify-between gap-2">
                        <p className="text-sm font-medium">
                          {getHistoryActionLabel(entry, t)}
                        </p>
                        <time className="text-xs text-muted-foreground">
                          {formatDate(entry.performedAt, language)}
                        </time>
                      </div>
                      {entry.fromStatus && entry.toStatus && (
                        <p className="text-xs text-muted-foreground">
                          {employeeJobStatusLabel(entry.fromStatus, t)} →{" "}
                          {employeeJobStatusLabel(entry.toStatus, t)}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {t("Performed by: {name}", { name: actor })}
                      </p>
                      {entry.performedBy?.userType && (
                        <p className="text-xs text-muted-foreground">
                          {t("Role: {role}", {
                            role: employeeDisplayLabel(
                              `${entry.performedBy.userType[0].toUpperCase()}${entry.performedBy.userType.slice(1)}`,
                              t,
                            ),
                          })}
                        </p>
                      )}
                      {details.map((detail, index) => (
                        <p
                          key={`${entry._id}-${index}`}
                          className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]"
                        >
                          {detail}
                        </p>
                      ))}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
      </details>

      {screen !== "other" && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur">
          <div className="mx-auto w-full max-w-4xl">
            {(screen === "assigned" || screen === "accepted") && (
              <Button
                type="button"
                className={`min-h-12 w-full whitespace-normal ${employeeLanguageClasses(language, "", "h-auto leading-5")}`}
                disabled={mutationPending}
                onClick={() =>
                  screen === "assigned"
                    ? runLifecycleAction(acceptMutation, "Job accepted.")
                    : runLifecycleAction(startMutation, "Job started.")
                }
              >
                {(acceptMutation.isPending || startMutation.isPending) ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : screen === "assigned" ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Play aria-hidden="true" />
                )}
                {t(screen === "assigned" ? "Accept Job" : "Start Job")}
              </Button>
            )}
            {screen === "on-hold" && (
              <Button
                type="button"
                className={`min-h-12 w-full whitespace-normal ${employeeLanguageClasses(language, "", "h-auto leading-5")}`}
                disabled={mutationPending}
                onClick={() =>
                  runLifecycleAction(startMutation, "Job resumed.")
                }
              >
                {startMutation.isPending ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Play aria-hidden="true" />
                )}
                {t("Resume Job")}
              </Button>
            )}
            {screen === "in-progress" && (
              <div className="space-y-2">
                {progress.before < EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE && (
                  <p className="text-center text-xs text-muted-foreground">
                    {t("Upload all 3 Before photos to enable putting this job on hold.")}
                  </p>
                )}
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  <Button
                    type="button"
                    className="min-h-12 min-w-0 whitespace-normal px-2 leading-5"
                    onClick={openFieldwork}
                  >
                    {t("Continue fieldwork")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12 min-w-0 whitespace-normal px-2 leading-5"
                    disabled={
                      mutationPending ||
                      progress.before < EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE
                    }
                    onClick={() => setIsHoldDialogOpen(true)}
                  >
                    {holdMutation.isPending ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Pause aria-hidden="true" />
                    )}
                    {t("Put Job On Hold")}
                  </Button>
                </div>
              </div>
            )}
            {screen === "completed" && (
              <Button
                type="button"
                variant="outline"
                className="min-h-12 w-full"
                onClick={() => navigate("/employee/jobs")}
              >
                <ArrowLeft aria-hidden="true" />
                {t("Back to Jobs")}
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={isHoldDialogOpen}
        onOpenChange={(open) => {
          if (!holdMutation.isPending) setIsHoldDialogOpen(open);
        }}
      >
        <DialogContent className="max-h-[95dvh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto">
          <DialogTitle>{t("Put this job on hold?")}</DialogTitle>
          <DialogDescription className="mt-2">
            {t("Saved before photos, work details, and materials will be preserved. Resume the job when you are ready to continue.")}
          </DialogDescription>
          {hasPendingSelections && (
            <p
              className="mt-4 break-words text-sm text-destructive [overflow-wrap:anywhere]"
              role="alert"
            >
              {t("Selected photos have not been uploaded and will be discarded when this job is put on hold.")}
            </p>
          )}
          <div className="mt-4 space-y-2">
            <label
              htmlFor="employee-hold-reason"
              className="text-sm font-medium"
            >
              {t("Hold reason (optional)")}
            </label>
            <textarea
              id="employee-hold-reason"
              value={holdReasonDraft}
              onChange={(event) => setHoldReasonDraft(event.currentTarget.value)}
              maxLength={500}
              rows={3}
              className="w-full min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={holdMutation.isPending}
              onClick={() => setIsHoldDialogOpen(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              className="min-h-11 whitespace-normal"
              disabled={
                holdMutation.isPending ||
                progress.before < EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE
              }
              onClick={runHoldAction}
            >
              {holdMutation.isPending && (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              )}
              {t("Put Job On Hold")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
