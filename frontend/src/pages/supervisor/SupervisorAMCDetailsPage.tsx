import { useState } from "react";
import { isAxiosError } from "axios";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Download,
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
  useSupervisorAMCDetails,
  useSupervisorAMCPhotos,
} from "@/features/supervisor/hooks/useSupervisorAMCDetails";
import {
  formatSupervisorAMCLabel,
  isSupervisorAMCId,
  isSupervisorAMCResponseConfirmed,
  supervisorAMCATMName,
  supervisorAMCEmployeeName,
} from "@/features/supervisor/supervisorAmc.utils";
import { getSupervisorAMCReport } from "@/services/supervisor.service";
import type {
  SupervisorAMCDetailsResponse,
  SupervisorAMCPhotosResponse,
} from "@/services/supervisor.service";

const formatDate = (value?: string | null) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

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
  if (status === "COMPLETED") return "secondary" as const;
  if (status === "OVERDUE") return "destructive" as const;
  return "outline" as const;
};

const getErrorMessage = (error: unknown) =>
  isAxiosError<{ message?: string }>(error)
    ? error.response?.data?.message || "The request could not be completed."
    : error instanceof Error
      ? error.message
      : "The request could not be completed.";

function BackToAMCs() {
  return (
    <Link
      to="/supervisor/amc"
      className={buttonVariants({
        variant: "ghost",
        className: "-ml-2 min-h-11 text-slate-600",
      })}
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to AMC records
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

function AMCSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading AMC details">
      <SkeletonBlock className="h-44 rounded-xl" />
      <SkeletonBlock className="h-64 rounded-xl" />
      <SkeletonBlock className="h-48 rounded-xl" />
    </div>
  );
}

function DetailsError({
  error,
  retry,
  isFetching,
}: {
  error: unknown;
  retry: () => void;
  isFetching: boolean;
}) {
  const unavailable =
    isAxiosError(error) && [403, 404].includes(error.response?.status ?? 0);
  return (
    <Card className="border-rose-200">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div role="alert">
          <h2 className="font-semibold text-rose-800">
            {unavailable ? "AMC record is unavailable" : "Could not load AMC"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {unavailable
              ? "This record may have been deleted or is no longer within your current employee assignment scope."
              : getErrorMessage(error)}
          </p>
        </div>
        {!unavailable && (
          <Button
            type="button"
            variant="outline"
            onClick={retry}
            disabled={isFetching}
            className="min-h-11 shrink-0"
          >
            Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function AMCPhotos({
  photos,
  loading,
  error,
  retry,
  isFetching,
}: {
  photos?: SupervisorAMCPhotosResponse["photos"];
  loading: boolean;
  error: unknown;
  retry: () => void;
  isFetching: boolean;
}) {
  const [unavailablePhotos, setUnavailablePhotos] = useState<Set<string>>(
    () => new Set(),
  );

  if (loading) {
    return (
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        role="status"
        aria-label="Loading AMC photos"
      >
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonBlock key={index} className="aspect-square rounded-xl" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <RetryCard
        title="AMC photos"
        error={error}
        retry={retry}
        isFetching={isFetching}
      />
    );
  }
  if (!photos?.length) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
        No AMC photos are available.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((photo, index) => {
        const src = photo.thumbnailUrl || photo.url;
        const failed = unavailablePhotos.has(photo._id || String(index));
        return (
          <figure
            key={photo._id || index}
            className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
          >
            {src && !failed ? (
              <img
                src={src}
                alt={`AMC maintenance evidence ${index + 1}`}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() =>
                  setUnavailablePhotos((previous) => {
                    const next = new Set(previous);
                    next.add(photo._id || String(index));
                    return next;
                  })
                }
                className="aspect-square w-full object-cover"
              />
            ) : (
              <div className="grid aspect-square place-items-center px-3 text-center text-sm text-slate-500">
                Image unavailable
              </div>
            )}
            <figcaption className="p-3 text-xs text-slate-500">
              {photo.uploadedAt
                ? formatDateTime(photo.uploadedAt)
                : "Upload date unavailable"}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function AMCTimeline({ amc }: { amc: SupervisorAMCDetailsResponse }) {
  const milestones = [
    ["Generated", amc.generatedAt || amc.createdAt],
    ["Visit", amc.visitDate],
    ["Completed", amc.completedAt],
  ].filter(([, value]) => Boolean(value));

  if (!milestones.length) {
    return (
      <p className="text-sm text-slate-500">
        No AMC milestone dates are available.
      </p>
    );
  }
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {milestones.map(([label, value]) => (
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

export default function SupervisorAMCDetailsPage() {
  const { amcId = "" } = useParams();
  const validId = isSupervisorAMCId(amcId);
  const amcQuery = useSupervisorAMCDetails(amcId, validId);
  const amcConfirmed =
    isSupervisorAMCResponseConfirmed({
      validId,
      isFetchedAfterMount: amcQuery.isFetchedAfterMount,
      isSuccess: amcQuery.isSuccess,
      isError: amcQuery.isError,
      isFetching: amcQuery.isFetching,
    }) && Boolean(amcQuery.data);
  const photosQuery = useSupervisorAMCPhotos(amcId, amcConfirmed);
  const amc = amcConfirmed ? amcQuery.data : undefined;
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");

  const downloadReport = async () => {
    if (!amc || reportLoading) return;
    setReportLoading(true);
    setReportError("");
    try {
      const blob = await getSupervisorAMCReport(amc._id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = (amc.amcId || "AMC-report").replace(
        /[^a-zA-Z0-9._-]/g,
        "_",
      );
      link.href = url;
      link.download = `${safeName}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setReportError(getErrorMessage(error));
    } finally {
      setReportLoading(false);
    }
  };

  if (!validId) {
    return (
      <div className="space-y-5">
        <BackToAMCs />
        <Card className="border-rose-200">
          <CardContent className="p-5" role="alert">
            <h2 className="font-semibold text-rose-800">
              Invalid AMC reference
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              The record reference in this link is not valid.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (amcQuery.isFetching || amcQuery.isLoading) {
    return (
      <div className="space-y-5">
        <BackToAMCs />
        <AMCSkeleton />
      </div>
    );
  }

  if (amcQuery.isError || !amc) {
    return (
      <div className="space-y-5">
        <BackToAMCs />
        <DetailsError
          error={amcQuery.error}
          retry={() => void amcQuery.refetch()}
          isFetching={amcQuery.isFetching}
        />
      </div>
    );
  }

  const atm =
    typeof amc.atmId === "object" && amc.atmId !== null ? amc.atmId : null;
  const photos =
    photosQuery.isFetchedAfterMount &&
    photosQuery.isSuccess &&
    !photosQuery.isError &&
    !photosQuery.isFetching
      ? photosQuery.data?.photos
      : undefined;

  return (
    <div className="space-y-6">
      <BackToAMCs />

      <Card className="overflow-hidden border-teal-100 shadow-sm">
        <div className="h-1.5 bg-gradient-to-r from-teal-600 to-blue-700" />
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">
                AMC monitoring
              </p>
              <h2 className="mt-1 break-words text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                {amc.amcId || "AMC details"}
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Maintenance period {amc.month}/{amc.year}
              </p>
            </div>
            <Badge variant={statusVariant(amc.status)}>
              {formatSupervisorAMCLabel(amc.status)}
            </Badge>
          </div>
          <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex min-w-0 gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">ATM</p>
                <p className="mt-1 break-words text-sm font-semibold text-slate-800">
                  {supervisorAMCATMName(amc.atmId)}
                </p>
                {atm?.address && (
                  <p className="mt-0.5 text-xs text-slate-500">{atm.address}</p>
                )}
              </div>
            </div>
            <div className="flex min-w-0 gap-2">
              <UserRound className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Employee</p>
                <p className="mt-1 break-words text-sm font-semibold text-slate-800">
                  {supervisorAMCEmployeeName(amc.employeeId)}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 gap-2">
              <CalendarDays className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
              <div>
                <p className="text-xs font-medium text-slate-500">Visit date</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {formatDate(amc.visitDate)}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />
              <div>
                <p className="text-xs font-medium text-slate-500">Due date</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {formatDate(amc.deadlineDate)}
                </p>
              </div>
            </div>
          </div>
          {reportError && (
            <p className="mt-4 text-sm text-rose-700" role="alert">
              Report download failed: {reportError}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => void downloadReport()}
            disabled={reportLoading}
            className="mt-5 min-h-11"
          >
            <Download className="size-4" aria-hidden="true" />
            {reportLoading ? "Preparing report..." : "Download AMC report"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <CardTitle className="text-base">Maintenance progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 px-4 pb-5 sm:px-5">
          <AMCTimeline amc={amc} />
          <div className="border-t border-slate-100 pt-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ClipboardCheck className="size-4 text-teal-700" aria-hidden="true" />
              Checklist{" "}
              {amc.checklistCompleted ? (
                <Badge variant="secondary">Complete</Badge>
              ) : (
                <Badge variant="outline">In progress</Badge>
              )}
            </p>
            {!amc.checklist?.length ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                No checklist responses are available.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                {amc.checklist.map((item, index) => (
                  <li
                    key={`${item.item || "item"}-${index}`}
                    className="grid gap-1 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
                  >
                    <p className="text-sm font-medium text-slate-800">
                      {item.item || `Checklist item ${index + 1}`}
                    </p>
                    <p className="text-sm text-slate-600">
                      {item.response || "No response"}
                    </p>
                    {item.remarks && (
                      <p className="text-xs leading-5 text-slate-500 sm:col-span-2">
                        {item.remarks}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {amc.employeeRemarks && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-medium text-slate-500">
                Employee remarks
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {amc.employeeRemarks}
              </p>
            </div>
          )}
          <div className="border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-medium text-slate-500">
              Photo evidence
            </p>
            <p className="text-sm text-slate-700">
              {amc.photoCount ?? 0}{" "}
              {(amc.photoCount ?? 0) === 1 ? "photo" : "photos"} recorded
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <CardTitle className="text-base">AMC photos</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-5 sm:px-5">
          <AMCPhotos
            photos={photos}
            loading={
              photosQuery.isLoading ||
              photosQuery.isFetching ||
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
    </div>
  );
}
