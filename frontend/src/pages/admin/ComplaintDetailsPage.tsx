import { isAxiosError } from "axios";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ComplaintPriorityBadge,
  ComplaintStatusBadge,
} from "@/features/complaints/components/ComplaintBadges";
import { useComplaint } from "@/features/complaints/hooks/useComplaint";
import { useJob } from "@/features/jobs/hooks/useJob";
import type { JobUser } from "@/features/jobs/types/job.types";
import type {
  ComplaintUser,
} from "@/features/complaints/types/complaint.types";

const NOT_AVAILABLE = "—";
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

function formatValue(value?: string | null) {
  return value?.trim() || NOT_AVAILABLE;
}

function formatDate(value?: string | null) {
  if (!value) return NOT_AVAILABLE;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? NOT_AVAILABLE : date.toLocaleString();
}

function formatLabel(value?: string | null) {
  if (!value) return NOT_AVAILABLE;
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getPopulated<T extends object>(value: T | string | null | undefined) {
  return typeof value === "object" && value !== null ? value : null;
}

function getUserLabel(value: ComplaintUser | string | null | undefined) {
  const user = getPopulated(value);
  if (!user) return NOT_AVAILABLE;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.email || NOT_AVAILABLE;
}

function getId(value: { _id?: string } | string | null | undefined) {
  return typeof value === "string" ? value : value?._id;
}

function getEmployeeLabel(value?: JobUser | string | null) {
  if (!value || typeof value === "string") return NOT_AVAILABLE;
  return (
    [value.firstName, value.lastName].filter(Boolean).join(" ") ||
    NOT_AVAILABLE
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="wrap-break-word text-sm font-medium sm:max-w-[65%] sm:text-right">
        {value}
      </dd>
    </div>
  );
}

function DetailsSkeleton() {
  return (
    <div className="space-y-6 p-4 sm:p-6" role="status">
      <div className="h-5 w-48 animate-pulse rounded bg-muted" />
      <div className="h-28 animate-pulse rounded-lg border bg-muted/40" />
      <div className="grid gap-6 lg:grid-cols-2">
        {["complaint", "customer", "atm", "job", "resolution", "closure"].map(
          (section) => (
            <div
              key={section}
              className="h-56 animate-pulse rounded-lg border bg-muted/40"
            />
          ),
        )}
      </div>
      <p className="sr-only">Loading complaint details...</p>
    </div>
  );
}

function getErrorMessage(status?: number) {
  if (status === 401 || status === 403) {
    return "You are not authorized to view this complaint.";
  }
  if (status === 404) {
    return "This complaint could not be found or may have been removed.";
  }
  return "The complaint could not be loaded. Please try again.";
}

export default function ComplaintDetailsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const isValidId = OBJECT_ID_PATTERN.test(id);
  const {
    data: complaint,
    isLoading,
    isError,
    isFetching,
    refetch,
    error,
  } = useComplaint(id);
  const linkedJobId = getId(complaint?.jobId);
  const {
    data: linkedJob,
    isLoading: isLoadingLinkedJob,
    isError: isLinkedJobError,
    isFetching: isFetchingLinkedJob,
    refetch: refetchLinkedJob,
  } = useJob(linkedJobId ?? "");

  if (isValidId && isLoading) return <DetailsSkeleton />;

  if (!isValidId || isError || !complaint) {
    const status = isAxiosError(error) ? error.response?.status : undefined;
    const notFound = isValidId && status === 404;
    const unauthorized = status === 401 || status === 403;

    return (
      <div className="p-4 sm:p-6">
        <Link
          to="/admin/complaints"
          className={buttonVariants({ variant: "ghost" })}
        >
          <ArrowLeft />
          Back to Complaints
        </Link>
        <div className="mt-6 max-w-2xl rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h1 className="font-semibold text-destructive">
            {!isValidId
              ? "Invalid complaint ID"
              : notFound
                ? "Complaint not found"
                : unauthorized
                  ? "Access denied"
                  : "Complaint details unavailable"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {!isValidId
              ? "The complaint ID is missing or invalid."
              : getErrorMessage(status)}
          </p>
          {isValidId && (
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {isFetching ? "Retrying..." : "Retry"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const atm = getPopulated(complaint.atmId);
  const customer = getPopulated(complaint.customerId);
  const resolvedBy = getPopulated(complaint.resolvedBy);
  const closedBy = getPopulated(complaint.closedBy);
  const hasJobReference =
    complaint.jobId !== null && complaint.jobId !== undefined;
  const complaintAtmId = getId(complaint.atmId);
  const jobLifecycleMismatch =
    (complaint.status === "CLOSED" && linkedJob?.status !== "CLOSED") ||
    (complaint.status === "IN_PROGRESS" &&
      linkedJob?.status !== "IN_PROGRESS") ||
    (complaint.status === "RESOLVED" &&
      !["COMPLETED", "VERIFIED", "APPROVED", "CLOSED"].includes(
        linkedJob?.status ?? "",
      ));
  const jobRelationshipMismatch =
    linkedJob !== undefined &&
    (linkedJob._id !== linkedJobId ||
      getId(linkedJob.complaintId) !== complaint._id ||
      getId(linkedJob.atmId) !== complaintAtmId ||
      jobLifecycleMismatch);
  const jobRelationshipInvalid =
    hasJobReference &&
    (!linkedJobId ||
      isLinkedJobError ||
      (!isLoadingLinkedJob && !linkedJob) ||
      jobRelationshipMismatch);
  const requiresJob = ["ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"].includes(
    complaint.status ?? "",
  );
  const jobLinkHistory = complaint.jobLinkHistory ?? [];
  const canCreateLinkedJob =
    complaint.status === "OPEN" && !hasJobReference && Boolean(complaintAtmId);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <Link to="/admin" className="hover:text-foreground">
          Admin
        </Link>
        <span aria-hidden="true">/</span>
        <Link to="/admin/complaints" className="hover:text-foreground">
          Complaints
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">
          {formatValue(complaint.complaintNumber)}
        </span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {complaint.status && (
              <ComplaintStatusBadge status={complaint.status} />
            )}
            {complaint.priority && (
              <ComplaintPriorityBadge priority={complaint.priority} />
            )}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              {formatValue(complaint.complaintNumber)}
            </p>
            <h1 className="mt-1 text-2xl font-bold">
              {formatValue(complaint.title)}
            </h1>
          </div>
        </div>
        <Link
          to="/admin/complaints"
          className={buttonVariants({ variant: "outline" })}
        >
          <ArrowLeft />
          Back to Complaints
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Lifecycle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {complaint.status === "OPEN" && canCreateLinkedJob && (
            <>
              <p className="text-sm text-muted-foreground">
                This complaint is ready for operational work. Create a Job and
                link this complaint using the existing Job workflow.
              </p>
              <Link
                to="/admin/jobs"
                state={{
                  createJobContext: {
                    atmId: complaintAtmId,
                    complaintId: complaint._id,
                    title: complaint.title ?? "",
                    description: complaint.description ?? "",
                  },
                }}
                className={buttonVariants({ variant: "default" })}
              >
                Create / link Job
                <ArrowRight />
              </Link>
            </>
          )}

          {complaint.status === "OPEN" &&
            !hasJobReference &&
            !complaintAtmId && (
              <p className="text-sm text-destructive" role="alert">
                This complaint has no available ATM link. A Job cannot be
                prefilled for it.
              </p>
            )}

          {requiresJob && !hasJobReference && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span>
                Job not linked. Lifecycle actions are unavailable until the
                required Job relationship is restored.
              </span>
            </div>
          )}

          {jobRelationshipInvalid && (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                The linked Job could not be verified. Its relationship may be
                missing, inactive, or inconsistent. Lifecycle actions are
                unavailable.
              </span>
              {linkedJobId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => void refetchLinkedJob()}
                  disabled={isFetchingLinkedJob}
                >
                  {isFetchingLinkedJob ? "Retrying..." : "Retry"}
                </Button>
              )}
            </div>
          )}

          {hasJobReference && isLoadingLinkedJob && (
            <p className="text-sm text-muted-foreground" role="status">
              Verifying linked Job...
            </p>
          )}

          {complaint.status === "RESOLVED" && !jobRelationshipInvalid && (
            <p className="text-sm text-muted-foreground">
              Resolution is recorded. Final Complaint closure follows the
              linked Job’s Admin closure.
            </p>
          )}

          {(complaint.status === "ASSIGNED" ||
            complaint.status === "IN_PROGRESS") &&
            linkedJob &&
            !jobRelationshipInvalid && (
              <p className="text-sm text-muted-foreground">
                Operational progress is managed by the linked Job.
              </p>
            )}

          {complaint.status === "CLOSED" && (
            <p className="text-sm text-muted-foreground">
              This Complaint is in its final, read-only state.
            </p>
          )}

          {complaint.status === "CANCELLED" && (
            <p className="text-sm text-muted-foreground">
              This Complaint is cancelled and read-only.
            </p>
          )}

          {complaint.status === "OPEN" && hasJobReference && (
            <p className="text-sm text-muted-foreground">
              A Job reference exists, but OPEN Complaints normally enter the
              operational workflow when the Job is linked.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Complaint Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow
                label="Complaint number"
                value={formatValue(complaint.complaintNumber)}
              />
              <DetailRow label="Title" value={formatValue(complaint.title)} />
              <DetailRow
                label="Description"
                value={formatValue(complaint.description)}
              />
              <DetailRow
                label="Status"
                value={formatLabel(complaint.status)}
              />
              <DetailRow
                label="Priority"
                value={formatLabel(complaint.priority)}
              />
              <DetailRow
                label="Created at"
                value={formatDate(complaint.createdAt)}
              />
              <DetailRow
                label="Updated at"
                value={formatDate(complaint.updatedAt)}
              />
            </dl>
          </CardContent>
        </Card>

        {jobLinkHistory.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Previous Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="divide-y">
                {jobLinkHistory.map((entry, index) => {
                  const previousJob = getPopulated(entry.jobId);
                  const previousJobId = getId(entry.jobId);
                  const jobLabel =
                    previousJob?.jobNumber ||
                    previousJob?.jobId ||
                    previousJobId;

                  return (
                    <li
                      key={entry._id || `${previousJobId}-${index}`}
                      className="py-3 first:pt-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {previousJob && previousJobId ? (
                            <Link
                              to={`/admin/jobs/${previousJobId}`}
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              {formatValue(jobLabel)}
                            </Link>
                          ) : (
                            formatValue(jobLabel)
                          )}
                        </p>
                        {previousJob?.status && (
                          <span className="text-xs text-muted-foreground">
                            {formatLabel(previousJob.status)}
                          </span>
                        )}
                      </div>
                      {previousJob?.title && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {previousJob.title}
                        </p>
                      )}
                      <p className="mt-1 text-sm text-muted-foreground">
                        {entry.endReason} · {formatDate(entry.endedAt)}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Reporter Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow
                label="Reported by"
                value={formatValue(complaint.reportedBy)}
              />
              <DetailRow
                label="Reported via"
                value={formatLabel(complaint.reportedVia)}
              />
              <DetailRow
                label="Reported at"
                value={formatDate(complaint.reportedAt)}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow
                label="Customer name"
                value={formatValue(customer?.customerName)}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ATM</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label="ATM ID" value={formatValue(atm?.atmId)} />
              <DetailRow
                label="Location"
                value={formatValue(atm?.locationName)}
              />
              <DetailRow label="Address" value={formatValue(atm?.address)} />
              <DetailRow
                label="Installation type"
                value={formatLabel(atm?.installationType)}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Linked Job</CardTitle>
          </CardHeader>
          <CardContent>
            {linkedJob ? (
              <dl>
                <DetailRow
                  label="Job ID"
                  value={
                    <Link
                      to={`/admin/jobs/${linkedJob._id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {formatValue(linkedJob.jobNumber || linkedJob.jobId)}
                    </Link>
                  }
                />
                <DetailRow label="Title" value={formatValue(linkedJob.title)} />
                <DetailRow
                  label="Status"
                  value={formatLabel(linkedJob.status)}
                />
                <DetailRow
                  label="Assigned employee"
                  value={getEmployeeLabel(linkedJob.assignedEmployeeId)}
                />
              </dl>
            ) : hasJobReference && jobRelationshipInvalid ? (
              <p className="py-3 text-sm text-destructive">
                Linked Job unavailable or relationship invalid.
              </p>
            ) : hasJobReference && isLoadingLinkedJob ? (
              <p className="py-3 text-sm text-muted-foreground">
                Loading linked Job...
              </p>
            ) : requiresJob ? (
              <p className="py-3 text-sm text-amber-700">Job not linked</p>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">
                No job linked
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resolution</CardTitle>
          </CardHeader>
          <CardContent>
            {complaint.resolvedAt ||
            resolvedBy ||
            complaint.resolutionNotes ? (
              <dl>
                <DetailRow
                  label="Resolved at"
                  value={formatDate(complaint.resolvedAt)}
                />
                <DetailRow
                  label="Resolved by"
                  value={getUserLabel(complaint.resolvedBy)}
                />
                <DetailRow
                  label="Resolution notes"
                  value={formatValue(complaint.resolutionNotes)}
                />
              </dl>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">
                No resolution information available.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Closure</CardTitle>
          </CardHeader>
          <CardContent>
            {complaint.closedAt || closedBy || complaint.closureReason ? (
              <dl>
                <DetailRow
                  label="Closed at"
                  value={formatDate(complaint.closedAt)}
                />
                <DetailRow
                  label="Closed by"
                  value={getUserLabel(complaint.closedBy)}
                />
                <DetailRow
                  label="Closure reason"
                  value={formatValue(complaint.closureReason)}
                />
              </dl>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">
                No closure information available.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
