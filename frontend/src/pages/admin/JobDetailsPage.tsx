import { useState, type ReactNode } from "react";
import { isAxiosError } from "axios";
import {
  ArrowLeft,
  Check,
  LoaderCircle,
  Pause,
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
import AdminMaterialUsageSection from "@/features/jobs/components/AdminMaterialUsageSection";
import EmployeeFieldWorkPanel from "@/features/jobs/components/EmployeeFieldWorkPanel";
import EmployeeMaterialUsageSection from "@/features/jobs/components/EmployeeMaterialUsageSection";
import JobPhotoGallery from "@/features/jobs/components/JobPhotoGallery";
import {
  useAcceptJob,
  useApproveJob,
  useCloseJob,
  useHoldJob,
  useStartJob,
  useVerifyJob,
} from "@/features/jobs/hooks/useJobLifecycle";
import { useJobHistory } from "@/features/jobs/hooks/useJobHistory";
import { useJob } from "@/features/jobs/hooks/useJob";
import { useATM } from "@/features/atms/hooks/useATM";
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

interface JobDetailsPageProps {
  readOnly?: boolean;
  backPath?: string;
}

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

function formatScheduledDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? NOT_AVAILABLE
    : date.toLocaleDateString("en-IN", {
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

function formatHistoryAction(action: string, entry: JobHistoryEntry) {
  if (action === "status_changed") {
    if (entry.toStatus === "IN_PROGRESS" && entry.fromStatus === "ON_HOLD") {
      return "Resumed";
    }
    if (entry.toStatus === "IN_PROGRESS") return "Started";
    if (entry.toStatus === "ON_HOLD") return "Put On Hold";
    if (entry.toStatus === "ACCEPTED") return "Accepted";
    if (entry.toStatus === "COMPLETED") return "Completed";
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
    note_added: "Note Added",
  };

  return labels[action] || formatLabel(action);
}

function isDetailsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatHistoryDetailLines(
  action: string,
  details: unknown,
  atm?: { documentId?: string; identifier?: string },
): string[] {
  if (details === null || details === undefined || details === "") return [];
  if (typeof details === "string") return [details];
  if (typeof details !== "object") return [String(details)];

  if (Array.isArray(details)) {
    const values = details.filter(
      (value) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean",
    );
    return values.length > 0 ? [`Details: ${values.join(", ")}`] : [];
  }

  const record = details as Record<string, unknown>;
  if (action === "gps_validated") {
    const gpsLines: string[] = [];
    const distance = record.gpsDistance;
    const accuracy = record.gpsAccuracy;
    if (typeof distance === "number" && Number.isFinite(distance)) {
      gpsLines.push(`GPS Distance: ${distance} m`);
    }
    if (typeof accuracy === "number" && Number.isFinite(accuracy)) {
      gpsLines.push(`GPS Accuracy: ${accuracy} m`);
    }

    const formatLocation = (label: string, location: unknown) => {
      if (!isDetailsRecord(location)) return;
      const { latitude, longitude } = location;
      if (
        typeof latitude === "number" &&
        Number.isFinite(latitude) &&
        typeof longitude === "number" &&
        Number.isFinite(longitude)
      ) {
        gpsLines.push(`${label}: ${latitude}, ${longitude}`);
      }
    };

    formatLocation("Employee Location", record.employeeLocation);
    formatLocation("ATM Location", record.atmLocation);
    if (gpsLines.length > 0) return gpsLines;
  }

  const labels: Record<string, string> = {
    adminRemarks: "Admin Remarks",
    assignedTo: "Assigned employee updated",
    employeeId: "Employee assignment updated",
    fromEmployee: "Previous employee updated",
    holdReason: "Hold Reason",
    reason: "Reason",
    rejectionReason: "Rejection Reason",
    reassignmentReason: "Reassignment Reason",
    title: "Title",
    toEmployee: "New employee assigned",
    atmId: "ATM ID",
  };
  const lines = Object.entries(record).flatMap(([key, value]) => {
    if (value === null || value === undefined || value === "") return [];
    if (key === "atmId" && typeof value === "string") {
      const resolvesToCurrentATM =
        atm?.documentId &&
        atm.identifier &&
        value.toLowerCase() === atm.documentId.toLowerCase();
      return [`ATM ID: ${resolvesToCurrentATM ? atm.identifier : value}`];
    }
    if (
      ["assignedTo", "employeeId", "fromEmployee", "toEmployee"].includes(key)
    ) {
      return [labels[key]];
    }

    const label =
      labels[key] ||
      key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (character) => character.toUpperCase());
    if (Array.isArray(value)) {
      const scalarValues = value.filter(
        (item) =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean",
      );
      return scalarValues.length > 0
        ? [`${label}: ${scalarValues.join(", ")}`]
        : [];
    }
    if (typeof value === "object") return [`${label}: details recorded`];
    return [`${label}: ${String(value)}`];
  });

  return lines;
}

function formatGpsValue(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : NOT_AVAILABLE;
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
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [rejectionAction, setRejectionAction] = useState<
    "verify" | "approve" | null
  >(null);
  const [rejectionRemarks, setRejectionRemarks] = useState("");
  const acceptMutation = useAcceptJob();
  const startMutation = useStartJob();
  const holdMutation = useHoldJob();
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
  const historyQuery = useJobHistory(readOnly ? "" : jobId);
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
  const reassignmentHistory = job.reassignmentHistory ?? [];
  const lifecycleMutationPending =
    acceptMutation.isPending ||
    startMutation.isPending ||
    holdMutation.isPending;
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

  const handleRejectSuccess = () => {
    setIsRejectDialogOpen(false);
    setRejectionAction(null);
    setRejectionRemarks("");
    toast.success("Job rejected.");
  };

  const handleRejectError = (mutationError: Error) => {
    toast.error(getMutationErrorMessage(mutationError));
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
          toast.error(getMutationErrorMessage(mutationError)),
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
          toast.error(getMutationErrorMessage(mutationError)),
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
          toast.error(getMutationErrorMessage(mutationError)),
      },
    );
  };

  return (
    <div className="min-w-0 space-y-6 p-3 sm:p-6">
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
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {job.status === "PENDING" ||
            REASSIGNABLE_STATUSES.includes(job.status) ? (
              <Button type="button" onClick={() => setIsAssignDialogOpen(true)}>
                <UserRoundPlus />
                {job.status === "PENDING" ? "Assign Job" : "Reassign Job"}
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
                    "Job stopped and put on hold.",
                  )
                }
              >
                {holdMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Pause />
                )}
                Stop (Put On Hold)
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
                  Verify
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={reviewMutationPending}
                  onClick={() => openRejectDialog("verify")}
                >
                  <X />
                  Reject
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
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={reviewMutationPending}
                  onClick={() => openRejectDialog("approve")}
                >
                  <X />
                  Reject
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
                Close
              </Button>
            )}
          </div>
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

      {readOnly ? (
        <EmployeeMaterialUsageSection job={job} />
      ) : (
        <AdminMaterialUsageSection jobId={job._id} />
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

        {job.recurringMaintenance?.source === "RECURRING" && (
          <Card>
            <CardHeader>
              <CardTitle>Recurring Maintenance</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <DetailRow
                  label="Type"
                  value={formatLabel(
                    job.recurringMaintenance.maintenanceType,
                  )}
                />
                <DetailRow
                  label="Scheduled date"
                  value={formatScheduledDate(
                    job.recurringMaintenance.scheduledDate,
                  )}
                />
              </dl>
            </CardContent>
          </Card>
        )}

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

        {!readOnly && (
          <Card>
            <CardHeader>
              <CardTitle>Completion GPS</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <DetailRow
                  label="Latitude"
                  value={formatGpsValue(job.employeeGpsAtCompletion?.latitude)}
                />
                <DetailRow
                  label="Longitude"
                  value={formatGpsValue(job.employeeGpsAtCompletion?.longitude)}
                />
                <DetailRow
                  label="Accuracy"
                  value={
                    job.employeeGpsAtCompletion?.accuracy !== undefined &&
                    Number.isFinite(job.employeeGpsAtCompletion.accuracy)
                      ? `${job.employeeGpsAtCompletion.accuracy} m`
                      : NOT_AVAILABLE
                  }
                />
                <DetailRow
                  label="Distance from ATM"
                  value={
                    job.gpsDistance !== undefined &&
                    Number.isFinite(job.gpsDistance)
                      ? `${job.gpsDistance} m`
                      : NOT_AVAILABLE
                  }
                />
                <DetailRow
                  label="GPS validation"
                  value={
                    job.gpsValidated === true ? (
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        Validated
                      </Badge>
                    ) : job.gpsValidated === false ? (
                      <Badge variant="secondary">Not validated</Badge>
                    ) : (
                      NOT_AVAILABLE
                    )
                  }
                />
                <DetailRow
                  label="Captured at"
                  value={formatDate(job.employeeGpsAtCompletion?.timestamp)}
                />
              </dl>
            </CardContent>
          </Card>
        )}

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

        {(!readOnly || job.status !== "IN_PROGRESS") && (
          <JobPhotoGallery
            beforePhotos={job.beforePhotos}
            afterPhotos={job.afterPhotos}
          />
        )}

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

        {!readOnly && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Job History</CardTitle>
            </CardHeader>
            <CardContent>
              {historyQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">
                  Loading history...
                </p>
              ) : historyQuery.isError ? (
                <p role="status" className="text-sm text-destructive">
                  Unable to load job history.
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
                        .join(" ") || "Unknown user";
                    const details = formatHistoryDetailLines(
                      entry.action,
                      entry.details,
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
                            {formatHistoryAction(entry.action, entry)}
                          </p>
                          <time className="text-xs text-muted-foreground">
                            {formatDate(entry.performedAt)}
                          </time>
                        </div>
                        {entry.fromStatus && entry.toStatus && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {formatLabel(entry.fromStatus)} -&gt;{" "}
                            {formatLabel(entry.toStatus)}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          Performed by: {actorName}
                          {entry.performedBy?.userType && (
                            <>
                              {" "}
                              · Role: {formatLabel(entry.performedBy.userType)}
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
                  No history available.
                </p>
              )}
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

      <Dialog open={isRejectDialogOpen} onOpenChange={handleRejectDialogChange}>
        <DialogContent>
          <div className="space-y-2">
            <DialogTitle>Reject Job</DialogTitle>
            <DialogDescription>
              This job will move to Rejected. You may optionally provide a
              reason.
            </DialogDescription>
          </div>
          <div className="mt-4">
            <label
              htmlFor="job-rejection-remarks"
              className="mb-2 block text-sm font-medium"
            >
              Rejection reason
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
              Cancel
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
              Confirm Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
