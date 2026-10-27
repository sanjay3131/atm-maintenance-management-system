import { useState } from "react";
import { isAxiosError } from "axios";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SkeletonBlock } from "@/features/dashboard/components/DashboardSkeleton";
import {
  useSupervisorJobDetails,
  useSupervisorJobHistory,
  useSupervisorJobPhotos,
} from "@/features/supervisor/hooks/useSupervisorJobDetails";
import {
  chronologicalJobHistory,
  formatAcSubType,
  formatJobWorkType,
  formatSupervisorJobLabel,
  isSupervisorJobId,
  supervisorJobPhotoUrl,
} from "@/features/supervisor/supervisorJobs.utils";
import type {
  SupervisorEmployeeJob,
  SupervisorJobHistoryEntry,
  SupervisorJobPhoto,
} from "@/services/supervisor.service";

const formatDateTime = (value?: string | null) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

const statusVariant = (status?: string | null) => {
  if (["COMPLETED", "VERIFIED", "APPROVED", "CLOSED"].includes(status ?? "")) {
    return "secondary" as const;
  }
  if (["REJECTED", "CANCELLED"].includes(status ?? "")) {
    return "destructive" as const;
  }
  return "outline" as const;
};

const getErrorMessage = (error: unknown) =>
  isAxiosError<{ message?: string }>(error)
    ? error.response?.data?.message || "The request could not be completed."
    : error instanceof Error
      ? error.message
      : "The request could not be completed.";

function BackToJobs() {
  return (
    <Link
      to="/supervisor/jobs"
      className={buttonVariants({
        variant: "ghost",
        className: "-ml-2 min-h-11 text-slate-600",
      })}
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to jobs
    </Link>
  );
}

function RetryCard({
  title,
  error,
  retry,
  isFetching,
}: {
  title: string;
  error: unknown;
  retry: () => void;
  isFetching: boolean;
}) {
  return (
    <Card className="border-rose-200">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="alert">
          <p className="font-semibold text-rose-800">{title} unavailable</p>
          <p className="mt-1 text-sm text-slate-600">
            {getErrorMessage(error)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={retry}
          disabled={isFetching}
          className="min-h-11 shrink-0"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          {isFetching ? "Retrying..." : "Retry"}
        </Button>
      </CardContent>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading job details">
      <SkeletonBlock className="h-40 rounded-xl" />
      <SkeletonBlock className="h-64 rounded-xl" />
      <SkeletonBlock className="h-56 rounded-xl" />
    </div>
  );
}

function JobTimestamps({ job }: { job: SupervisorEmployeeJob }) {
  const timestamps = [
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
  ].filter(([, value]) => Boolean(value));

  if (!timestamps.length) {
    return (
      <p className="text-sm text-slate-500">
        No job timestamps are available.
      </p>
    );
  }
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {timestamps.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs font-medium text-slate-500">{label}</dt>
          <dd className="mt-1 text-sm font-medium text-slate-800">
            {formatDateTime(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ImageEvidence({ photo }: { photo: SupervisorJobPhoto }) {
  const [failed, setFailed] = useState(false);
  const src = supervisorJobPhotoUrl(photo);
  const description = `${formatSupervisorJobLabel(photo.photoType)} job evidence`;

  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      {src && !failed ? (
        <img
          src={src}
          alt={description}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="aspect-square w-full object-cover"
        />
      ) : (
        <div className="grid aspect-square place-items-center px-3 text-center text-sm text-slate-500">
          Image unavailable
        </div>
      )}
      <figcaption className="space-y-1 p-3">
        <p className="text-sm font-medium text-slate-800">
          {formatSupervisorJobLabel(photo.photoType)}
        </p>
        <p className="text-xs text-slate-500">
          {photo.uploadedAt ? formatDateTime(photo.uploadedAt) : "Date unavailable"}
        </p>
      </figcaption>
    </figure>
  );
}

function JobPhotos({
  photos,
  loading,
  error,
  retry,
  isFetching,
}: {
  photos?: SupervisorJobPhoto[];
  loading: boolean;
  error: unknown;
  retry: () => void;
  isFetching: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" role="status" aria-label="Loading job photos">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonBlock key={index} className="aspect-square rounded-xl" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <RetryCard
        title="Job photos"
        error={error}
        retry={retry}
        isFetching={isFetching}
      />
    );
  }
  if (!photos?.length) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
        No job photos are available.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((photo) => (
        <ImageEvidence key={photo._id} photo={photo} />
      ))}
    </div>
  );
}

function HistoryTimeline({
  history,
}: {
  history: SupervisorJobHistoryEntry[];
}) {
  if (!history.length) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
        No status history has been recorded.
      </p>
    );
  }

  const orderedHistory = chronologicalJobHistory(history);
  return (
    <ol className="space-y-0">
      {orderedHistory.map((entry, index) => (
        <li
          key={`${entry.occurredAt}-${entry.action}-${index}`}
          className="relative flex gap-3 pb-5 last:pb-0"
        >
          {index < orderedHistory.length - 1 && (
            <span
              className="absolute left-[7px] top-4 h-full w-px bg-slate-200"
              aria-hidden="true"
            />
          )}
          <span className="relative mt-1 size-4 shrink-0 rounded-full border-2 border-teal-600 bg-white" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900">
                  {formatSupervisorJobLabel(entry.action)}
                </p>
                {entry.fromStatus || entry.toStatus ? (
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    {entry.fromStatus ? (
                      <Badge variant={statusVariant(entry.fromStatus)}>
                        {formatSupervisorJobLabel(entry.fromStatus)}
                      </Badge>
                    ) : (
                      <span>Initial state</span>
                    )}
                    <span aria-hidden="true">→</span>
                    {entry.toStatus ? (
                      <Badge variant={statusVariant(entry.toStatus)}>
                        {formatSupervisorJobLabel(entry.toStatus)}
                      </Badge>
                    ) : (
                      <span>Status not supplied</span>
                    )}
                  </p>
                ) : null}
              </div>
              <time
                dateTime={entry.occurredAt}
                className="shrink-0 text-xs text-slate-500"
              >
                {formatDateTime(entry.occurredAt)}
              </time>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function SupervisorJobDetailsPage() {
  const { jobId = "" } = useParams();
  const isValidJobId = isSupervisorJobId(jobId);
  const jobQuery = useSupervisorJobDetails(jobId, isValidJobId);
  const jobIsConfirmed =
    isValidJobId &&
    jobQuery.isFetchedAfterMount &&
    jobQuery.isSuccess &&
    !jobQuery.isError &&
    !jobQuery.isFetching &&
    Boolean(jobQuery.data);
  const historyQuery = useSupervisorJobHistory(jobId, jobIsConfirmed);
  const photosQuery = useSupervisorJobPhotos(jobId, jobIsConfirmed);
  const job = jobIsConfirmed ? jobQuery.data : undefined;

  if (!isValidJobId) {
    return (
      <div className="space-y-5">
        <BackToJobs />
        <Card className="border-rose-200">
          <CardContent className="p-5" role="alert">
            <h2 className="font-semibold text-rose-800">Invalid job reference</h2>
            <p className="mt-1 text-sm text-slate-600">
              The job reference in this link is not valid.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (jobQuery.isFetching || jobQuery.isLoading) {
    return (
      <div className="space-y-5">
        <BackToJobs />
        <DetailSkeleton />
      </div>
    );
  }

  if (jobQuery.isError || !job) {
    const unavailable =
      isAxiosError(jobQuery.error) &&
      [403, 404].includes(jobQuery.error.response?.status ?? 0);
    return (
      <div className="space-y-5">
        <BackToJobs />
        <Card className="border-rose-200">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div role="alert">
              <h2 className="font-semibold text-rose-800">
                {unavailable ? "Job is unavailable" : "Could not load job"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {unavailable
                  ? "This job may have been removed or is no longer associated with an employee currently assigned to you."
                  : getErrorMessage(jobQuery.error)}
              </p>
            </div>
            {!unavailable && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void jobQuery.refetch()}
                disabled={jobQuery.isFetching}
                className="min-h-11 shrink-0"
              >
                Retry
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const evidencePhotos =
    photosQuery.isFetchedAfterMount &&
    photosQuery.isSuccess &&
    !photosQuery.isError &&
    !photosQuery.isFetching
    ? photosQuery.data?.photos
    : undefined;

  return (
    <div className="space-y-6">
      <BackToJobs />

      <Card className="overflow-hidden border-blue-100 shadow-sm">
        <div className="h-1.5 bg-gradient-to-r from-blue-700 to-teal-500" />
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">
                Job monitoring
              </p>
              <h2 className="mt-1 break-words text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                {job.jobNumber || job.jobId || "Job details"}
              </h2>
              <p className="mt-2 text-base font-medium text-slate-700">
                {job.title || "Title unavailable"}
              </p>
            </div>
            <Badge variant={statusVariant(job.status)}>
              {formatSupervisorJobLabel(job.status)}
            </Badge>
          </div>
          {job.description && (
            <p className="mt-5 whitespace-pre-wrap border-t border-slate-100 pt-4 text-sm leading-6 text-slate-600">
              {job.description}
            </p>
          )}
          <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex min-w-0 gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">ATM</p>
                <p className="mt-1 break-words text-sm font-semibold text-slate-800">
                  {job.atm?.atmId || job.atm?.locationName || "ATM unavailable"}
                </p>
                {job.atm?.address && (
                  <p className="mt-0.5 text-xs text-slate-500">{job.atm.address}</p>
                )}
              </div>
            </div>
            <div className="flex min-w-0 gap-2">
              <UserRound className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">
                  Assigned employee
                </p>
                <p className="mt-1 break-words text-sm font-semibold text-slate-800">
                  {job.employee?.name || "Employee unavailable"}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
              <div>
                <p className="text-xs font-medium text-slate-500">Work type</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {job.workType ? formatJobWorkType(job.workType) : "Not available"}
                </p>
                {job.workType === "ac" && (
                  <>
                    <p className="mt-3 text-xs font-medium text-slate-500">
                      AC sub-type
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      {formatAcSubType(job.acSubType)}
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="flex min-w-0 gap-2">
              <Clock3 className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
              <div>
                <p className="text-xs font-medium text-slate-500">Priority</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {job.priority ? formatSupervisorJobLabel(job.priority) : "Not available"}
                </p>
              </div>
            </div>
          </div>
          {job.scheduledDate && (
            <p className="mt-4 flex items-center gap-2 text-sm text-slate-600">
              <CalendarDays className="size-4 text-teal-700" aria-hidden="true" />
              Scheduled: {formatDateTime(job.scheduledDate)}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <CardTitle className="text-base">Job timeline</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-5 sm:px-5">
          <JobTimestamps job={job} />
        </CardContent>
      </Card>

      {job.completionEvidence && (
        <Card>
          <CardHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
            <CardTitle className="text-base">Completion evidence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-5 sm:px-5">
            {job.completionEvidence.employeeRemarks && (
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">
                {job.completionEvidence.employeeRemarks}
              </p>
            )}
            {job.completionEvidence.gpsValidated !== undefined && (
              <p className="text-sm text-slate-600">
                Location validation:{" "}
                {job.completionEvidence.gpsValidated
                  ? "Validated"
                  : "Not validated"}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <CardTitle className="text-base">Job photos</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-5 sm:px-5">
          <JobPhotos
            photos={evidencePhotos}
            loading={
              photosQuery.isFetching ||
              photosQuery.isLoading ||
              !photosQuery.isFetchedAfterMount
            }
            error={
              photosQuery.isFetchedAfterMount && photosQuery.isError
                ? photosQuery.error
                : null
            }
            retry={() => void photosQuery.refetch()}
            isFetching={photosQuery.isFetching}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <CardTitle className="text-base">Status history</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-5 sm:px-5">
          {historyQuery.isLoading ||
          historyQuery.isFetching ||
          !historyQuery.isFetchedAfterMount ? (
            <div className="space-y-4" role="status" aria-label="Loading status history">
              <SkeletonBlock className="h-14 w-full" />
              <SkeletonBlock className="h-14 w-full" />
              <SkeletonBlock className="h-14 w-full" />
            </div>
          ) : historyQuery.isError || !historyQuery.isSuccess ? (
            <RetryCard
              title="Status history"
              error={historyQuery.error}
              retry={() => void historyQuery.refetch()}
              isFetching={historyQuery.isFetching}
            />
          ) : (
            <HistoryTimeline history={historyQuery.data?.history ?? []} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
