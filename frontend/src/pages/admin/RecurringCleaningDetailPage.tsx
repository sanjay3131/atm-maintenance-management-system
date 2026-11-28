import { useState, type FormEvent, type ReactNode } from "react";
import { isAxiosError } from "axios";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import JobPhotoGallery from "@/features/jobs/components/JobPhotoGallery";
import { useRecurringCleaningHistory } from "@/features/recurring-maintenance/hooks/useRecurringCleaningHistory";
import type {
  CleaningHistoryPhoto,
  RecurringCleaningHistoryEntry,
} from "@/features/recurring-maintenance/types/recurring-maintenance.types";
import type { JobPhoto } from "@/features/jobs/types/job.types";

const PAGE_SIZE = 25;

const STATUS_LABELS: Record<string, string> = {
  GREEN: "On schedule",
  RED: "Overdue",
  GRACE_PERIOD: "Grace period",
  NO_HISTORY: "No history",
  CONFIGURATION_REQUIRED: "Configuration required",
  "PLAN INACTIVE": "PLAN INACTIVE",
};

const STATUS_STYLES: Record<string, string> = {
  GREEN:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  RED: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200",
  GRACE_PERIOD: "border-border bg-muted text-muted-foreground",
  NO_HISTORY:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  CONFIGURATION_REQUIRED:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  "PLAN INACTIVE": "border-border bg-muted text-muted-foreground",
};

function formatBusinessDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00+05:30`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDaysSince(value: number | null) {
  if (value === null) return "No valid cleaning history";
  if (value === 0) return "Today";
  if (value === 1) return "1 day ago";
  return `${value} days ago`;
}

function formatMaintenanceType(value: string) {
  return value === "DAILY_CLEANING" ? "Daily Cleaning" : "Weekly Mopping";
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? "Could not load cleaning history.";
  }
  return error instanceof Error ? error.message : "Could not load cleaning history.";
}

function DetailValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-b py-3 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{children || "—"}</dd>
    </div>
  );
}

function toGalleryPhoto(photo: CleaningHistoryPhoto): JobPhoto {
  return {
    _id: photo.id,
    photoType: photo.photoType,
    url: photo.url,
    thumbnailUrl: photo.thumbnailUrl,
    uploadedAt: photo.uploadedAt ?? undefined,
  };
}

function mergePhotos(
  jobPhotos: CleaningHistoryPhoto[],
  evidencePhotos: CleaningHistoryPhoto[],
  photoType: "before" | "after",
) {
  const photos = [...jobPhotos, ...evidencePhotos]
    .filter((photo) => photo.photoType === photoType)
    .map(toGalleryPhoto);
  return [...new Map(photos.map((photo) => [photo._id, photo])).values()];
}

function formatAuditValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function HistoryEntry({ entry }: { entry: RecurringCleaningHistoryEntry }) {
  const job = entry.scheduledJob;
  const record = entry.cleaningRecord;
  const beforePhotos = mergePhotos(
    job?.beforePhotos ?? [],
    record?.evidencePhotos ?? [],
    "before",
  );
  const afterPhotos = mergePhotos(
    job?.afterPhotos ?? [],
    record?.evidencePhotos ?? [],
    "after",
  );
  const hasPhotos = beforePhotos.length > 0 || afterPhotos.length > 0;

  return (
    <article className="space-y-4 border-b pb-5 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {job
              ? `Scheduled ${formatBusinessDate(job.scheduledDate)}`
              : "Scheduled job unavailable"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Actual cleaning date:{" "}
            {formatBusinessDate(record?.actualCleaningDate)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {job ? (
            <Badge variant="outline">{job.status.replaceAll("_", " ")}</Badge>
          ) : (
            <Badge variant="secondary">Job unavailable</Badge>
          )}
          {record ? (
            <Badge
              variant="outline"
              className={
                record.validityStatus === "VOID"
                  ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              }
            >
              {record.validityStatus}
            </Badge>
          ) : (
            <Badge variant="secondary">No cleaning record</Badge>
          )}
        </div>
      </div>

      {record && (
        <dl className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-4">
          <DetailValue label="Cleaner type">
            {record.cleanerType === "INTERNAL" ? "Internal" : "Outsourced"}
            {record.cleanerType === "OUTSOURCED" &&
              record.outsourcedCleanerName &&
              ` · ${record.outsourcedCleanerName}`}
          </DetailValue>
          <DetailValue label="Responsible / reporting employee">
            {record.reportingEmployee?.name ||
              record.reportingEmployee?.employeeCode ||
              "—"}
          </DetailValue>
          <DetailValue label="Reported by">
            {record.submittedBy
              ? [record.submittedBy.firstName, record.submittedBy.lastName]
                  .filter(Boolean)
                  .join(" ")
              : record.reportingMethod}
          </DetailValue>
          <DetailValue label="Submitted">
            {formatTimestamp(record.submittedAt)}
          </DetailValue>
          <div className="sm:col-span-2 xl:col-span-4">
            <DetailValue label="Remarks">{record.remarks || "—"}</DetailValue>
          </div>
        </dl>
      )}

      {hasPhotos ? (
        <JobPhotoGallery
          beforePhotos={beforePhotos}
          afterPhotos={afterPhotos}
          compact
          showCounts={false}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          No before or after photos available.
        </p>
      )}

      {record && (
        <div className="grid gap-3 lg:grid-cols-2">
          <details className="rounded-md border px-3">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Submission history ({record.submissionHistory.length})
            </summary>
            <div className="space-y-3 border-t py-3">
              {record.submissionHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No submission history was recorded.
                </p>
              ) : (
                record.submissionHistory.map((submission, index) => {
                  const beforePhotos = mergePhotos(
                    [],
                    submission.evidencePhotos,
                    "before",
                  );
                  const afterPhotos = mergePhotos(
                    [],
                    submission.evidencePhotos,
                    "after",
                  );
                  const hasUsableEvidencePhotos = [
                    ...beforePhotos,
                    ...afterPhotos,
                  ].some((photo) => photo.url || photo.thumbnailUrl);
                  const unavailablePhotoCount =
                    submission.evidencePhotos.filter(
                      (photo) => !photo.url && !photo.thumbnailUrl,
                    ).length;

                  return (
                    <div
                      key={`${submission.submittedAt ?? "submission"}-${index}`}
                      className="border-b pb-3 last:border-b-0 last:pb-0"
                    >
                      <p className="text-sm font-medium">
                        {formatTimestamp(submission.submittedAt)} ·{" "}
                        {submission.actualCleanerType}
                        {submission.outsourcedCleanerName
                          ? ` · ${submission.outsourcedCleanerName}`
                          : ""}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Cleaning date{" "}
                        {formatBusinessDate(submission.actualCleaningDate)}
                        {" · "}
                        {submission.reportingMethod}
                        {submission.submittedBy
                          ? ` · ${[
                              submission.submittedBy.firstName,
                              submission.submittedBy.lastName,
                            ]
                              .filter(Boolean)
                              .join(" ")}`
                          : ""}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Actual cleaner employee:{" "}
                        {submission.actualCleanerEmployee?.name ||
                          submission.actualCleanerEmployee?.employeeCode ||
                          "Not recorded"}
                      </p>
                      {submission.remarks && (
                        <p className="mt-1 whitespace-pre-wrap text-sm">
                          {submission.remarks}
                        </p>
                      )}
                      {hasUsableEvidencePhotos && (
                        <div className="mt-3">
                          <JobPhotoGallery
                            beforePhotos={beforePhotos}
                            afterPhotos={afterPhotos}
                            compact
                            showCounts={false}
                          />
                        </div>
                      )}
                      {unavailablePhotoCount > 0 && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          Photo unavailable
                          {unavailablePhotoCount > 1
                            ? ` (${unavailablePhotoCount})`
                            : ""}
                          .
                        </p>
                      )}
                      {submission.evidencePhotos.length === 0 && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          No submission evidence photos recorded.
                        </p>
                      )}
                    </div>
                  );
                })
              )}
              {record.historyTruncated.submissionHistory && (
                <p className="text-xs text-muted-foreground">
                  Only the latest 20 submissions are shown.
                </p>
              )}
            </div>
          </details>

          <details className="rounded-md border px-3">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Correction history ({record.correctionHistory.length})
            </summary>
            <div className="space-y-3 border-t py-3">
              {record.correctionHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No corrections were recorded.
                </p>
              ) : (
                record.correctionHistory.map((correction, index) => (
                  <div
                    key={`${correction.correctedAt ?? "correction"}-${index}`}
                    className="border-b pb-3 last:border-b-0 last:pb-0"
                  >
                    <p className="text-sm font-medium">
                      {formatTimestamp(correction.correctedAt)}
                      {correction.correctedBy
                        ? ` · ${[
                            correction.correctedBy.firstName,
                            correction.correctedBy.lastName,
                          ]
                            .filter(Boolean)
                            .join(" ")}`
                        : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">
                      {correction.reason}
                    </p>
                    {correction.changes.length > 0 && (
                      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {correction.changes.map((change, changeIndex) => (
                          <li key={`${change.field}-${changeIndex}`}>
                            {change.field}: {formatAuditValue(change.previousValue)}
                            {" → "}
                            {formatAuditValue(change.correctedValue)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              )}
              {record.historyTruncated.correctionHistory && (
                <p className="text-xs text-muted-foreground">
                  Only the latest 20 corrections are shown.
                </p>
              )}
            </div>
          </details>
        </div>
      )}
    </article>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading cleaning history">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="space-y-3 border-b pb-5">
          <div className="h-5 w-56 animate-pulse rounded bg-muted" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-12 animate-pulse rounded bg-muted" />
            <div className="h-12 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading cleaning history…</span>
    </div>
  );
}

export default function RecurringCleaningDetailPage() {
  const { planId = "" } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [draftFromDate, setDraftFromDate] = useState("");
  const [draftToDate, setDraftToDate] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const dateRangeInvalid = Boolean(
    draftFromDate && draftToDate && draftFromDate > draftToDate,
  );
  const historyQuery = useRecurringCleaningHistory(
    planId,
    {
      page,
      limit: PAGE_SIZE,
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
    },
    !dateRangeInvalid,
  );
  const response = historyQuery.data;
  const plan = response?.plan;
  const history = response?.history;
  const status = plan?.currentMonitoringStatus;

  const applyDateFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (dateRangeInvalid) return;
    setPage(1);
    setFromDate(draftFromDate);
    setToDate(draftToDate);
  };

  const clearDateFilter = () => {
    setDraftFromDate("");
    setDraftToDate("");
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate("/admin/recurring-maintenance")}
          >
            <ArrowLeft />
            Recurring Maintenance
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Recurring Cleaning Details</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Plan overview and scheduled cleaning history.
            </p>
          </div>
        </div>
      </div>

      {historyQuery.isLoading ? (
        <div className="space-y-4" role="status">
          <div className="h-44 animate-pulse rounded-lg border bg-muted/40" />
          <div className="h-24 animate-pulse rounded-lg border bg-muted/40" />
          <p className="sr-only">Loading recurring cleaning details…</p>
        </div>
      ) : historyQuery.isError && !response ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div role="alert">
              <p className="font-medium text-destructive">
                Could not load recurring cleaning details.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {getErrorMessage(historyQuery.error)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void historyQuery.refetch()}
              disabled={historyQuery.isFetching}
            >
              <RefreshCw
                className={historyQuery.isFetching ? "animate-spin" : ""}
              />
              {historyQuery.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      ) : plan ? (
        <>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">ATM overview</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {plan.atm?.atmId ?? "ATM unavailable"}
                  {plan.atm?.location ? ` · ${plan.atm.location}` : ""}
                </p>
              </div>
              {status && (
                <Badge
                  variant="outline"
                  className={`whitespace-nowrap ${STATUS_STYLES[status] ?? ""}`}
                >
                  {STATUS_LABELS[status] ?? status}
                </Badge>
              )}
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-4">
                <DetailValue label="ATM ID">
                  {plan.atm?.atmId ?? "ATM unavailable"}
                </DetailValue>
                <DetailValue label="Location">
                  {plan.atm?.location ?? "—"}
                </DetailValue>
                <DetailValue label="Bank">
                  {plan.atm?.bank.name ?? "—"}
                </DetailValue>
                <DetailValue label="Region">
                  {plan.atm?.region.name ?? "—"}
                </DetailValue>
                <DetailValue label="District">
                  {plan.atm?.district.name ?? "—"}
                </DetailValue>
                <DetailValue label="Assigned employee">
                  {plan.assignedEmployee
                    ? `${plan.assignedEmployee.name || plan.assignedEmployee.employeeCode}${
                        plan.assignedEmployee.name &&
                        plan.assignedEmployee.employeeCode
                          ? ` · ${plan.assignedEmployee.employeeCode}`
                          : ""
                      }`
                    : "—"}
                </DetailValue>
                <DetailValue label="Maintenance type">
                  {formatMaintenanceType(plan.maintenanceType)}
                </DetailValue>
                <DetailValue label="Plan state">
                  {plan.isActive ? "Active" : "Inactive"}
                </DetailValue>
                <DetailValue label="Last valid cleaning date">
                  {formatBusinessDate(plan.lastValidCleaningDate)}
                </DetailValue>
                <DetailValue label="Days since last valid cleaning">
                  {formatDaysSince(plan.daysSinceLastValidCleaning)}
                </DetailValue>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle className="text-base">Cleaning history</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Scheduled jobs and actual CleaningRecords are shown separately.
                </p>
              </div>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={applyDateFilter}
              >
                <label className="grid gap-1 text-sm font-medium">
                  From date
                  <input
                    type="date"
                    value={draftFromDate}
                    onChange={(event) => setDraftFromDate(event.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  To date
                  <input
                    type="date"
                    value={draftToDate}
                    onChange={(event) => setDraftToDate(event.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </label>
                <Button type="submit" variant="outline" disabled={dateRangeInvalid}>
                  Apply
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearDateFilter}
                  disabled={!draftFromDate && !draftToDate && !fromDate && !toDate}
                >
                  Clear
                </Button>
              </form>
            </CardHeader>
            <CardContent className="space-y-4">
              {dateRangeInvalid && (
                <p className="text-sm text-destructive" role="alert">
                  The from date must be on or before the to date.
                </p>
              )}
              {historyQuery.isFetching && response && (
                <p className="text-sm text-muted-foreground" role="status">
                  Updating history…
                </p>
              )}
              {historyQuery.isError && response && (
                <div className="flex flex-wrap items-center justify-between gap-3" role="alert">
                  <p className="text-sm text-destructive">
                    {getErrorMessage(historyQuery.error)}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void historyQuery.refetch()}
                    disabled={historyQuery.isFetching}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {historyQuery.isLoading ? (
                <HistorySkeleton />
              ) : dateRangeInvalid ? null : history?.entries.length ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {history.pagination.total}{" "}
                    {history.pagination.total === 1 ? "entry" : "entries"}
                  </p>
                  <div className="space-y-5">
                    {history.entries.map((entry, index) => (
                      <HistoryEntry
                        key={
                          entry.scheduledJob?.id ??
                          entry.cleaningRecord?.id ??
                          `history-${index}`
                        }
                        entry={entry}
                      />
                    ))}
                  </div>
                  {history.pagination.totalPages > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                      <p className="text-sm text-muted-foreground">
                        Page {history.pagination.page} of{" "}
                        {history.pagination.totalPages}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setPage((current) => Math.max(1, current - 1))
                          }
                          disabled={
                            !history.pagination.hasPreviousPage ||
                            historyQuery.isFetching
                          }
                        >
                          <ChevronLeft />
                          Previous
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPage((current) => current + 1)}
                          disabled={
                            !history.pagination.hasNextPage ||
                            historyQuery.isFetching
                          }
                        >
                          Next
                          <ChevronRight />
                        </Button>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Date filters use the scheduled date in Asia/Kolkata. If the
                    scheduled Job is unavailable, the CleaningRecord date is used.
                  </p>
                </>
              ) : (
                <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
                  No scheduled cleaning jobs or CleaningRecords match this date
                  range.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </main>
  );
}
