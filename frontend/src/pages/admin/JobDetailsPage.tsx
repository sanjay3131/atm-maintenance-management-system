import { useState, type ReactNode } from "react";
import { isAxiosError } from "axios";
import {
  ArrowLeft,
  Check,
  LoaderCircle,
  Pause,
  Play,
  UserRoundPlus,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AssignJobDialog from "@/features/jobs/components/AssignJobDialog";
import EmployeeFieldWorkPanel from "@/features/jobs/components/EmployeeFieldWorkPanel";
import {
  useAcceptJob,
  useHoldJob,
  useStartJob,
} from "@/features/jobs/hooks/useJobLifecycle";
import { useJob } from "@/features/jobs/hooks/useJob";
import { useATM } from "@/features/atms/hooks/useATM";
import type {
  Job,
  JobPhoto,
  JobStatus,
  JobUser,
} from "@/features/jobs/types/job.types";

const NOT_AVAILABLE = "Not available";

interface JobDetailsPageProps {
  readOnly?: boolean;
  backPath?: string;
}

const assignmentTransition: Partial<Record<JobStatus, JobStatus>> = {
  PENDING: "ASSIGNED",
};

function formatValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === ""
    ? NOT_AVAILABLE
    : String(value);
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

function getStatusVariant(status: JobStatus) {
  if (status === "REJECTED") return "destructive" as const;
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
  return (
    <div className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium sm:max-w-[65%] sm:text-right">
        {value}
      </dd>
    </div>
  );
}

function PhotoSection({
  title,
  photos,
}: {
  title: string;
  photos?: Array<JobPhoto | null>;
}) {
  const availablePhotos = (photos ?? []).filter((photo): photo is JobPhoto =>
    Boolean(photo?.thumbnailUrl || photo?.url),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {availablePhotos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No photos available.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {availablePhotos.map((photo) => (
              <figure
                key={photo._id}
                className="overflow-hidden rounded-md border"
              >
                <img
                  src={photo.thumbnailUrl || photo.url || undefined}
                  alt={`${title} photo`}
                  className="aspect-square w-full object-cover"
                />
                <figcaption className="p-2 text-xs text-muted-foreground">
                  {formatDate(photo.uploadedAt)}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DetailsSkeleton() {
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
      <p className="sr-only">Loading job details...</p>
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
  const { jobId = "" } = useParams<{ jobId: string }>();
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const acceptMutation = useAcceptJob();
  const startMutation = useStartJob();
  const holdMutation = useHoldJob();
  const {
    data: job,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useJob(jobId);
  const { data: atmDetails, isLoading: isATMDetailsLoading } = useATM(
    getRawATMId(job),
    !readOnly,
  );

  if (isLoading) return <DetailsSkeleton />;

  if (isError || !job) {
    const isNotFound = isAxiosError(error) && error.response?.status === 404;
    const message = isAxiosError<{ message?: string }>(error)
      ? error.response?.data?.message
      : undefined;

    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate(backPath)}>
          <ArrowLeft />
          Back to Jobs
        </Button>
        <div className="mt-6 max-w-2xl rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h1 className="font-semibold text-destructive">
            {isNotFound ? "Job not found" : "Job details unavailable"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {message ||
              (isNotFound
                ? "This job may have been removed."
                : "The job could not be loaded. Please try again.")}
          </p>
          {!isNotFound && (
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

  const atm = typeof job.atmId === "object" ? job.atmId : null;
  const employee =
    typeof job.assignedEmployeeId === "object" ? job.assignedEmployeeId : null;
  const complaint =
    typeof job.complaintId === "object" ? job.complaintId : null;
  const customer = typeof job.customerId === "object" ? job.customerId : null;
  const customerName = customer?.customerName || NOT_AVAILABLE;
  const availableAssignmentStatus = assignmentTransition[job.status];
  const reassignmentHistory = job.reassignmentHistory ?? [];
  const lifecycleMutationPending =
    acceptMutation.isPending ||
    startMutation.isPending ||
    holdMutation.isPending;

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
          toast.error(getMutationErrorMessage(mutationError)),
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
  ] as const;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            className="-ml-3 mb-3"
            onClick={() => navigate(backPath)}
          >
            <ArrowLeft />
            Back to Jobs
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">Job Details</h1>
            <Badge variant={getStatusVariant(job.status)}>
              {formatLabel(job.status)}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {job.jobNumber || job.jobId}
          </p>
        </div>
        {!readOnly && availableAssignmentStatus && (
          <Button type="button" onClick={() => setIsAssignDialogOpen(true)}>
            <UserRoundPlus />
            Assign Job
          </Button>
        )}
        {readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {job.status === "ASSIGNED" && (
              <Button
                type="button"
                disabled={lifecycleMutationPending}
                onClick={() =>
                  runLifecycleAction(acceptMutation, "Job accepted.")
                }
              >
                {acceptMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Check />
                )}
                Accept Job
              </Button>
            )}
            {(job.status === "ACCEPTED" || job.status === "ON_HOLD") && (
              <Button
                type="button"
                disabled={lifecycleMutationPending}
                onClick={() =>
                  runLifecycleAction(
                    startMutation,
                    job.status === "ON_HOLD" ? "Job resumed." : "Job started.",
                  )
                }
              >
                {startMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Play />
                )}
                {job.status === "ON_HOLD" ? "Resume Job" : "Start Job"}
              </Button>
            )}
            {job.status === "IN_PROGRESS" && (
              <Button
                type="button"
                variant="outline"
                disabled={lifecycleMutationPending}
                onClick={() =>
                  runLifecycleAction(holdMutation, "Job put on hold.")
                }
              >
                {holdMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Pause />
                )}
                Hold Job
              </Button>
            )}
          </div>
        )}
      </div>

      {readOnly && job.status === "IN_PROGRESS" && (
        <EmployeeFieldWorkPanel job={job} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Job Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label="Job ID" value={formatValue(job.jobId)} />
              <DetailRow
                label="Job number"
                value={formatValue(job.jobNumber)}
              />
              <DetailRow label="Title" value={formatValue(job.title)} />
              <DetailRow label="Work type" value={formatLabel(job.workType)} />
              <DetailRow label="Priority" value={formatLabel(job.priority)} />
              <DetailRow
                label="Description"
                value={formatValue(job.description)}
              />
              <DetailRow label="Created" value={formatDate(job.createdAt)} />
              <DetailRow label="Updated" value={formatDate(job.updatedAt)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ATM Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow
                label="ATM ID"
                value={formatValue(atmDetails?.atmId || atm?.atmId)}
              />
              <DetailRow
                label="Location"
                value={formatValue(
                  atmDetails?.locationName || atm?.locationName,
                )}
              />
              <DetailRow
                label="Address"
                value={formatValue(atmDetails?.address || atm?.address)}
              />
              <DetailRow
                label="Bank"
                value={formatValue(atmDetails?.bankId?.bankName || atm?.bank)}
              />
              <DetailRow
                label="District"
                value={formatValue(
                  atmDetails?.districtId?.districtName || atm?.districtId,
                )}
              />
              <DetailRow
                label="Region"
                value={formatValue(atmDetails?.regionId?.name || atm?.regionId)}
              />
              <DetailRow
                label="ATM status"
                value={formatValue(atmDetails?.status)}
              />
              <DetailRow
                label="Installation type"
                value={formatValue(atmDetails?.installationType)}
              />
              {isATMDetailsLoading && (
                <DetailRow
                  label="Additional ATM information"
                  value="Loading..."
                />
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assignment</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label="Employee" value={getPersonName(employee)} />
              <DetailRow
                label="Employee code"
                value={formatValue(employee?.employeeCode)}
              />
              <DetailRow
                label="Phone"
                value={formatValue(employee?.phoneNumber)}
              />
              <DetailRow
                label="Assigned at"
                value={formatDate(job.assignedAt)}
              />
              <DetailRow
                label="Assigned by"
                value={getPersonName(job.assignedBy)}
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
              <DetailRow label="Name" value={customerName} />
              <DetailRow
                label="Email"
                value={formatValue(customer?.customerEmail)}
              />
              <DetailRow
                label="Phone"
                value={formatValue(customer?.customerPhone)}
              />
              <DetailRow
                label="Customer reference"
                value={formatValue(
                  customer?._id ||
                    (typeof job.customerId === "string"
                      ? job.customerId
                      : undefined),
                )}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Complaint</CardTitle>
          </CardHeader>
          <CardContent>
            {complaint ? (
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
                  label="Reported by"
                  value={formatValue(complaint.reportedBy)}
                />
                <DetailRow
                  label="Reported via"
                  value={formatLabel(complaint.reportedVia)}
                />
                <DetailRow
                  label="Status"
                  value={formatLabel(complaint.status)}
                />
                <DetailRow
                  label="Reported at"
                  value={formatDate(complaint.reportedAt)}
                />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                No complaint is linked to this job.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lifecycle dates</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              {lifecycleDates.map(([label, value]) => (
                <DetailRow
                  key={label}
                  label={label}
                  value={formatDate(value)}
                />
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audit</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow
                label="Created by"
                value={getPersonName(job.createdBy)}
              />
              <DetailRow
                label="Updated by"
                value={getPersonName(job.updatedBy)}
              />
            </dl>
          </CardContent>
        </Card>

        <PhotoSection title="Before photos" photos={job.beforePhotos} />
        <PhotoSection title="After photos" photos={job.afterPhotos} />

        {(job.employeeRemarks ||
          job.adminRemarks ||
          job.rejectionReason ||
          job.isReassigned ||
          reassignmentHistory.length > 0) && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Notes and reassignment</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                {job.employeeRemarks && (
                  <DetailRow
                    label="Employee remarks"
                    value={job.employeeRemarks}
                  />
                )}
                {job.adminRemarks && (
                  <DetailRow label="Admin remarks" value={job.adminRemarks} />
                )}
                {job.rejectionReason && (
                  <DetailRow
                    label="Rejection reason"
                    value={job.rejectionReason}
                  />
                )}
                {job.isReassigned && (
                  <DetailRow
                    label="Reassigned"
                    value={job.reassignmentReason || "Yes"}
                  />
                )}
                {job.previousJobId && (
                  <DetailRow
                    label="Previous job ID"
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
                      <span className="px-2 text-muted-foreground">to</span>
                      {getEmployeeLabel(entry.toEmployee)}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatValue(entry.reason)} ·{" "}
                      {formatDate(entry.reassignedAt)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Reassigned by {getPersonName(entry.reassignedBy)}
                    </p>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}
      </div>

      {isAssignDialogOpen && (
        <AssignJobDialog
          job={job}
          onClose={() => setIsAssignDialogOpen(false)}
        />
      )}
    </div>
  );
}
