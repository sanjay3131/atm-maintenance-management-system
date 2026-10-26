import { useRef, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useApproveATMLocationRequest,
  useATMLocationRequest,
  useRejectATMLocationRequest,
} from "@/features/atms/hooks/useATMLocationRequests";
import { useATM } from "@/features/atms/hooks/useATM";
import {
  buildATMLocationMapUrl,
  canDecideLinkedATMLocationTaskRequest,
  copyATMLocationCoordinate,
  getATMLocationRequestErrorMessage,
  isValidATMLocationCoordinatePair,
  validateRejectionReason,
} from "@/features/atms/atmLocationRequest.utils";
import { getATMLocationTaskRequestId } from "@/features/atms/atmLocationTask.utils";
import type {
  ATMLocationRequest,
  ATMLocationRequestPerson,
} from "@/features/atms/types/atm-location-request.types";
import type { ATMLocationTask } from "@/features/atms/types/atm-location-task.types";
import { canReviewATMLocationRequests } from "@/features/atms/atmLocationRequest.utils";
import { useAuth } from "@/features/auth/auth-context";

const getTaskATMId = (task: ATMLocationTask) =>
  typeof task.atmId === "string" ? task.atmId : task.atmId._id;

const getRequestATMId = (request?: ATMLocationRequest) =>
  typeof request?.atmId === "string"
    ? request.atmId
    : request?.atmId?._id ?? "";

const personName = (
  person: string | ATMLocationRequestPerson | null | undefined,
) =>
  person && typeof person !== "string"
    ? [person.firstName, person.lastName].filter(Boolean).join(" ") ||
      person.employeeCode ||
      "Not available"
    : "Not available";

const formatDate = (value?: string | null) => {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
};

export default function ATMLocationTaskRequestDialog({
  task,
  onOpenChange,
  onDecision,
}: {
  task: ATMLocationTask | null;
  onOpenChange: (open: boolean) => void;
  onDecision: () => Promise<void>;
}) {
  const requestId = task ? getATMLocationTaskRequestId(task) : "";
  const requestQuery = useATMLocationRequest(requestId);
  const request = requestQuery.data;
  const taskATMId = task ? getTaskATMId(task) : "";
  const atmId = request ? getRequestATMId(request) : taskATMId;
  const atmQuery = useATM(atmId, Boolean(atmId));
  const approveMutation = useApproveATMLocationRequest();
  const rejectMutation = useRejectATMLocationRequest();
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [refreshingDecision, setRefreshingDecision] = useState(false);
  const [confirmedTaskStatus, setConfirmedTaskStatus] = useState<{
    taskId: string;
    status: "COMPLETED" | "REJECTED";
  } | null>(null);
  const [confirmation, setConfirmation] = useState<"approve" | "reject" | null>(
    null,
  );
  const decisionLock = useRef(false);
  const busy =
    approveMutation.isPending || rejectMutation.isPending || refreshingDecision;
  const allowedToReview = canReviewATMLocationRequests(user?.userType);
  const canDecide = Boolean(
    task &&
      request &&
    canDecideLinkedATMLocationTaskRequest(task, request) &&
      allowedToReview,
  );
  const taskStatus =
    task && confirmedTaskStatus?.taskId === task._id
      ? confirmedTaskStatus.status
      : task?.status;
  const requestATMId = getRequestATMId(request);
  const relationshipMismatch = Boolean(
    task && request && (!taskATMId || !requestATMId || taskATMId !== requestATMId),
  );
  const mapUrl = request
    ? buildATMLocationMapUrl(
        request.proposedLatitude,
        request.proposedLongitude,
      )
    : null;
  const currentCoordinates = atmQuery.data?.location?.coordinates;
  const validCurrentCoordinates =
    currentCoordinates?.length === 2 &&
    isValidATMLocationCoordinatePair(
      currentCoordinates[1],
      currentCoordinates[0],
    );

  const copyCoordinate = async (label: string, coordinate: number) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable.");
      }
      await copyATMLocationCoordinate(
        coordinate,
        (text) => navigator.clipboard.writeText(text),
      );
      toast.success(`${label} copied.`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}.`);
    }
  };

  const requestDecision = (action: "approve" | "reject") => {
    if (!canDecide || busy) return;
    if (action === "reject") {
      const reasonError = validateRejectionReason(reason);
      if (reasonError) {
        setError(reasonError);
        return;
      }
    }
    setError("");
    setConfirmation(action);
  };

  const confirmDecision = async () => {
    if (!request || !canDecide || !confirmation || decisionLock.current) return;
    if (confirmation === "reject") {
      const reasonError = validateRejectionReason(reason);
      if (reasonError) {
        setError(reasonError);
        return;
      }
    }
    decisionLock.current = true;
    setRefreshingDecision(true);
    setError("");
    try {
      try {
        if (confirmation === "approve") {
          await approveMutation.mutateAsync({ requestId });
        } else {
          await rejectMutation.mutateAsync({ requestId, reason: reason.trim() });
        }
      } catch (decisionError) {
        const message = getATMLocationRequestErrorMessage(decisionError);
        setError(message);
        toast.error(message);
        await Promise.allSettled([requestQuery.refetch(), onDecision()]);
        return;
      }

      setConfirmation(null);
      if (task) {
        setConfirmedTaskStatus({
          taskId: task._id,
          status: confirmation === "approve" ? "COMPLETED" : "REJECTED",
        });
      }
      toast.success(
        confirmation === "approve"
          ? "Location request approved."
          : "Location request rejected.",
      );
      const [requestRefresh, taskRefresh] = await Promise.allSettled([
        requestQuery.refetch(),
        onDecision(),
      ]);
      if (
        requestRefresh.status === "rejected" ||
        requestRefresh.value.isError ||
        taskRefresh.status === "rejected"
      ) {
        toast.warning(
          "The decision was saved, but some review data did not refresh. Use Retry or refresh the task inventory.",
        );
      }
    } finally {
      decisionLock.current = false;
      setRefreshingDecision(false);
    }
  };

  return (
    <Dialog
      open={Boolean(task)}
      onOpenChange={(open) => {
        if (!busy) onOpenChange(open);
      }}
    >
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogTitle>Linked ATM location proposal</DialogTitle>
        <DialogDescription>
          Proposed coordinates are separate from the ATM’s current official location.
        </DialogDescription>
        {requestQuery.isLoading ? (
          <p className="py-8 text-sm text-muted-foreground" role="status">
            Loading linked location request…
          </p>
        ) : requestQuery.isError || !request ? (
          <div className="space-y-3 py-4" role="alert">
            <p className="text-sm text-destructive">
              Could not load the linked location request.
            </p>
            <p className="text-sm text-muted-foreground">
              {getATMLocationRequestErrorMessage(requestQuery.error)}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void requestQuery.refetch()}
              disabled={requestQuery.isFetching}
            >
              {requestQuery.isFetching ? "Retrying…" : "Retry"}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {relationshipMismatch && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              >
                This request references a different ATM than its linked task. Review decisions are disabled until the relationship is corrected.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={request.status === "REJECTED" ? "destructive" : "secondary"}>
                Request: {request.status.replaceAll("_", " ")}
              </Badge>
              <Badge variant="outline">
                Task: {taskStatus?.replaceAll("_", " ") ?? "Unavailable"}
              </Badge>
              <Badge variant="outline">
                {request.requestType === "LOCATION_CHANGE"
                  ? "Location correction"
                  : "Initial collection"}
              </Badge>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">ATM</dt>
                <dd className="text-sm font-medium">
                  {typeof request.atmId === "object" && request.atmId
                    ? `${request.atmId.atmId ?? "ATM"} — ${request.atmId.locationName ?? request.atmId.address ?? "Details unavailable"}`
                    : "ATM details unavailable"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Submitted by</dt>
                <dd className="text-sm font-medium">{personName(request.requestedBy)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Submitted</dt>
                <dd className="text-sm font-medium">{formatDate(request.submittedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Source / accuracy</dt>
                <dd className="text-sm font-medium">
                  {request.inputSource} ·{" "}
                  {request.inputSource === "GPS" && request.accuracy !== null
                    ? `${request.accuracy} m`
                    : request.inputSource === "MANUAL"
                      ? "Not applicable"
                      : "Not provided"}
                </dd>
              </div>
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <dt className="text-xs font-medium text-muted-foreground">
                  Proposed latitude
                </dt>
                <dd className="mt-1 flex flex-wrap items-center justify-between gap-2 font-semibold">
                  {request.proposedLatitude}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!isValidATMLocationCoordinatePair(request.proposedLatitude, request.proposedLongitude)}
                    onClick={() => void copyCoordinate("Latitude", request.proposedLatitude)}
                  >
                    <Copy aria-hidden="true" /> Copy Latitude
                  </Button>
                </dd>
              </div>
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <dt className="text-xs font-medium text-muted-foreground">
                  Proposed longitude
                </dt>
                <dd className="mt-1 flex flex-wrap items-center justify-between gap-2 font-semibold">
                  {request.proposedLongitude}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!isValidATMLocationCoordinatePair(request.proposedLatitude, request.proposedLongitude)}
                    onClick={() => void copyCoordinate("Longitude", request.proposedLongitude)}
                  >
                    <Copy aria-hidden="true" /> Copy Longitude
                  </Button>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Current official ATM coordinates</dt>
                <dd className="text-sm font-medium">
                  {atmQuery.isLoading
                    ? "Loading…"
                    : atmQuery.isError
                      ? "Could not load current official coordinates"
                      : validCurrentCoordinates
                      ? `${currentCoordinates[1]}, ${currentCoordinates[0]} (latitude, longitude)`
                      : "No current official coordinates"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Official coordinates at submission</dt>
                <dd className="text-sm font-medium">
                  {request.officialLocationSnapshot.coordinates?.length === 2
                    ? `${request.officialLocationSnapshot.coordinates[1]}, ${request.officialLocationSnapshot.coordinates[0]} (latitude, longitude)`
                    : "Not configured"}
                </dd>
              </div>
              {mapUrl && (
                <div className="sm:col-span-2">
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-2 text-sm text-primary underline underline-offset-4"
                  >
                    Open proposed coordinates in Google Maps
                    <ExternalLink aria-hidden="true" className="size-4" />
                  </a>
                </div>
              )}
            </dl>

            {request.status === "REJECTED" && request.rejectionReason && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                Rejection reason: {request.rejectionReason}
              </p>
            )}

            {canDecide && (
              <section className="space-y-3 border-t pt-4">
                <label className="block text-sm font-medium" htmlFor="linked-request-reason">
                  Rejection reason (required)
                </label>
                <textarea
                  id="linked-request-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={1000}
                  rows={3}
                  disabled={busy}
                  className="w-full rounded-md border border-input bg-background p-3 text-sm"
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy || !canDecide}
                    onClick={() => requestDecision("reject")}
                  >
                    Reject request
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || !canDecide}
                    onClick={() => requestDecision("approve")}
                  >
                    Approve request
                  </Button>
                </div>
              </section>
            )}

            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
        )}

        <Dialog
          open={confirmation !== null}
          onOpenChange={(open) => {
            if (!open && !busy) setConfirmation(null);
          }}
        >
          <DialogContent>
            <DialogTitle>
              {confirmation === "approve"
                ? "Approve this proposal?"
                : "Reject this proposal?"}
            </DialogTitle>
            <DialogDescription>
              {confirmation === "approve"
                ? "Approval applies the proposed coordinates as the official ATM location."
                : "Rejection preserves the current official ATM coordinates."}
            </DialogDescription>
            {confirmation === "reject" && (
              <p className="rounded-md bg-muted p-3 text-sm">{reason.trim()}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={confirmation === "reject" ? "destructive" : "default"}
                disabled={busy || !canDecide}
                onClick={() => void confirmDecision()}
              >
                {busy ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
