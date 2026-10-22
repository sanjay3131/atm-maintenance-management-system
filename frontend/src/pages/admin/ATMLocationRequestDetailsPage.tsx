import { useRef, useState } from "react";
import { ArrowLeft, Check, MapPin, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useApproveATMLocationRequest,
  useATMLocationRequest,
  useRejectATMLocationRequest,
} from "@/features/atms/hooks/useATMLocationRequests";
import {
  canReviewATMLocationRequests,
  formatATMLocationRequestStatus,
  getATMLocationRequestErrorMessage,
  validateRejectionReason,
} from "@/features/atms/atmLocationRequest.utils";
import type {
  ATMLocationRequest,
  ATMLocationRequestPerson,
} from "@/features/atms/types/atm-location-request.types";
import { useAuth } from "@/features/auth/auth-context";

const isValidRequestId = (value: string) => /^[a-f\d]{24}$/i.test(value);

function personName(
  person:
    | string
    | ATMLocationRequestPerson
    | null
    | undefined,
) {
  if (!person || typeof person === "string") return "Not available";
  return (
    [person.firstName, person.lastName].filter(Boolean).join(" ") ||
    person.employeeCode ||
    "Not available"
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium sm:max-w-[65%] sm:text-right">
        {children}
      </dd>
    </div>
  );
}

function LocationRequestDetails({ request }: { request: ATMLocationRequest }) {
  const atm =
    typeof request.atmId === "object" && request.atmId !== null
      ? request.atmId
      : null;
  const snapshot = request.officialLocationSnapshot;
  const currentOfficialCoordinates =
    snapshot.coordinates?.length === 2
      ? `${snapshot.coordinates[1]}, ${snapshot.coordinates[0]}`
      : "Not configured when request was submitted";
  const atmConfiguredNow = atm?.locationConfigured;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {atm?.atmId || "ATM reference unavailable"}
            <Badge variant={request.status === "REJECTED" ? "destructive" : request.status === "APPROVED" ? "default" : "secondary"}>
              {formatATMLocationRequestStatus(request.status)}
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {atm?.locationName || atm?.address || "ATM details unavailable"}
          </p>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <Detail label="Request type">
              {request.requestType === "LOCATION_CHANGE"
                ? "Change existing location"
                : "Initial configuration"}
            </Detail>
            <Detail label="Requested by">{personName(request.requestedBy)}</Detail>
            <Detail label="Requester role">{request.requesterRole}</Detail>
            <Detail label="Employee code">
              {personName(request.requesterEmployeeId)}
            </Detail>
            <Detail label="Submitted">{formatDate(request.submittedAt)}</Detail>
            <Detail label="Proposed coordinates">
              {request.proposedLatitude}, {request.proposedLongitude} (latitude, longitude)
            </Detail>
            <Detail label="GPS accuracy">
              {request.accuracy === null ? "Not provided" : `${request.accuracy} m`}
            </Detail>
            <Detail label="Input source">{request.inputSource}</Detail>
            <Detail label="Official location at submission">
              {currentOfficialCoordinates}
            </Detail>
            <Detail label="Official location currently configured">
              {atmConfiguredNow === undefined
                ? "Current status not provided by the API"
                : atmConfiguredNow
                  ? "Yes"
                  : "No"}
            </Detail>
            <Detail label="Location captured at submission">
              {formatDate(snapshot.locationCapturedAt)}
            </Detail>
            <Detail label="Reviewed by">{personName(request.reviewedBy)}</Detail>
            <Detail label="Decision time">{formatDate(request.reviewedAt)}</Detail>
            {request.amcId && (
              <Detail label="Related AMC reference">{request.amcId}</Detail>
            )}
          </dl>
          {request.status === "REJECTED" && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm font-semibold">Rejection reason</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {request.rejectionReason || "No reason was returned."}
              </p>
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            The API returns the official coordinates recorded when this request was submitted, not the current coordinate values. Approval is guarded against stale official-location changes by the backend.
          </p>
        </CardContent>
      </Card>
    </>
  );
}

export default function ATMLocationRequestDetailsPage() {
  const { requestId = "" } = useParams();
  const { user } = useAuth();
  const validId = isValidRequestId(requestId);
  const requestQuery = useATMLocationRequest(validId ? requestId : "");
  const approveMutation = useApproveATMLocationRequest();
  const rejectMutation = useRejectATMLocationRequest();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatedRequest, setUpdatedRequest] =
    useState<ATMLocationRequest | null>(null);
  const decisionInFlight = useRef(false);
  const busy = approveMutation.isPending || rejectMutation.isPending;
  const request = updatedRequest ?? requestQuery.data;

  if (!canReviewATMLocationRequests(user?.userType)) {
    return (
      <main className="p-4 sm:p-6">
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-destructive" role="alert">
          You do not have permission to review ATM location requests.
        </p>
      </main>
    );
  }

  if (!validId) {
    return (
      <main className="space-y-5 p-4 sm:p-6">
        <Link to="/admin/location-requests" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
          <ArrowLeft aria-hidden="true" /> Location requests
        </Link>
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-destructive" role="alert">
          This location request reference is invalid.
        </p>
      </main>
    );
  }

  if (requestQuery.isLoading) {
    return (
      <main className="space-y-4 p-4 sm:p-6" role="status">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg border bg-muted/40" />
        <span className="sr-only">Loading location request...</span>
      </main>
    );
  }

  if (requestQuery.isError || !request) {
    return (
      <main className="space-y-5 p-4 sm:p-6">
        <Link to="/admin/location-requests" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
          <ArrowLeft aria-hidden="true" /> Location requests
        </Link>
        <Card className="border-destructive/30">
          <CardContent className="space-y-3 p-5" role="alert">
            <p className="font-medium text-destructive">
              Location request unavailable.
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
              {requestQuery.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const approve = async () => {
    if (decisionInFlight.current || request.status !== "PENDING") return;
    decisionInFlight.current = true;
    setError("");
    setNotice("");
    try {
      const result = await approveMutation.mutateAsync({ requestId });
      const refreshed = await requestQuery.refetch();
      setUpdatedRequest(
        refreshed.isError
          ? {
              ...request,
              ...result,
              atmId: request.atmId,
              requestedBy: request.requestedBy,
              requesterEmployeeId: request.requesterEmployeeId,
            }
          : refreshed.data ?? {
          ...request,
          ...result,
          atmId: request.atmId,
          requestedBy: request.requestedBy,
          requesterEmployeeId: request.requesterEmployeeId,
            },
      );
      setNotice("Location request approved. The official ATM location was updated.");
    } catch (actionError) {
      setError(getATMLocationRequestErrorMessage(actionError));
    } finally {
      decisionInFlight.current = false;
    }
  };

  const reject = async () => {
    if (decisionInFlight.current || request.status !== "PENDING") return;
    const reasonError = validateRejectionReason(reason);
    if (reasonError) {
      setError(reasonError);
      return;
    }
    decisionInFlight.current = true;
    setError("");
    setNotice("");
    try {
      const result = await rejectMutation.mutateAsync({
        requestId,
        reason: reason.trim(),
      });
      const refreshed = await requestQuery.refetch();
      setUpdatedRequest(
        refreshed.isError
          ? {
              ...request,
              ...result,
              atmId: request.atmId,
              requestedBy: request.requestedBy,
              requesterEmployeeId: request.requesterEmployeeId,
            }
          : refreshed.data ?? {
          ...request,
          ...result,
          atmId: request.atmId,
          requestedBy: request.requestedBy,
          requesterEmployeeId: request.requesterEmployeeId,
            },
      );
      setNotice("Location request rejected.");
    } catch (actionError) {
      setError(getATMLocationRequestErrorMessage(actionError));
    } finally {
      decisionInFlight.current = false;
    }
  };

  return (
    <main className="space-y-5 p-4 sm:space-y-6 sm:p-6">
      <Link to="/admin/location-requests" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
        <ArrowLeft aria-hidden="true" /> Location requests
      </Link>
      <header>
        <div className="flex items-center gap-3">
          <MapPin className="size-6 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-bold sm:text-3xl">Review ATM location request</h1>
        </div>
      </header>

      {notice && (
        <p className="rounded-lg border border-emerald-600/20 bg-emerald-600/5 p-4 text-sm" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <LocationRequestDetails request={request} />

      {request.status === "PENDING" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review decision</CardTitle>
            <p className="text-sm text-muted-foreground">
              Approve only if the proposed location is verified. A stale request is rejected by the backend.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="location-request-rejection-reason" className="mb-1 block text-sm font-medium">
                Rejection reason
              </label>
              <textarea
                id="location-request-rejection-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
                rows={3}
                disabled={busy}
                placeholder="Required when rejecting"
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {reason.length}/1000 characters
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="destructive"
                className="min-h-11"
                onClick={() => void reject()}
                disabled={busy}
              >
                <X aria-hidden="true" />
                {rejectMutation.isPending ? "Rejecting..." : "Reject request"}
              </Button>
              <Button
                type="button"
                className="min-h-11"
                onClick={() => void approve()}
                disabled={busy}
              >
                <Check aria-hidden="true" />
                {approveMutation.isPending ? "Approving..." : "Approve request"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
