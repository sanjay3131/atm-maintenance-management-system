import { useState } from "react";
import { Link } from "react-router-dom";
import { MapPin, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useATMLocationRequests } from "@/features/atms/hooks/useATMLocationRequests";
import {
  formatATMLocationRequestStatus,
  getATMLocationRequestErrorMessage,
  getATMLocationRequestListState,
} from "@/features/atms/atmLocationRequest.utils";
import type {
  ATMLocationRequest,
  ATMLocationRequestStatus,
} from "@/features/atms/types/atm-location-request.types";

const PAGE_SIZE = 20;

function getATM(request: ATMLocationRequest) {
  return typeof request.atmId === "object" && request.atmId !== null
    ? request.atmId
    : null;
}

function getPersonName(
  person: ATMLocationRequest["requestedBy"] | ATMLocationRequest["reviewedBy"],
) {
  if (!person || typeof person === "string") return "Not available";
  return (
    [person.firstName, person.lastName].filter(Boolean).join(" ") ||
    "Not available"
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

function statusVariant(status: ATMLocationRequestStatus) {
  if (status === "APPROVED") return "default" as const;
  if (status === "REJECTED") return "destructive" as const;
  return "secondary" as const;
}

export default function ATMLocationRequestsPage() {
  const [status, setStatus] = useState<ATMLocationRequestStatus | "">("PENDING");
  const [page, setPage] = useState(1);
  const requestQuery = useATMLocationRequests(
    status || undefined,
    page,
    PAGE_SIZE,
  );
  const requests = requestQuery.data?.requests ?? [];
  const pagination = requestQuery.data?.pagination;
  const listState = getATMLocationRequestListState({
    isLoading: requestQuery.isLoading,
    isError: requestQuery.isError,
    requests,
  });

  return (
    <main className="space-y-5 p-4 sm:space-y-6 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <MapPin className="size-6 text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-bold sm:text-3xl">
              ATM Location Requests
            </h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Review proposed ATM coordinates. Only approval changes the official location.
          </p>
        </div>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="location-request-status">
            Filter requests by status
          </label>
          <select
            id="location-request-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ATMLocationRequestStatus | "");
              setPage(1);
            }}
            className="h-11 min-w-40 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All requests</option>
          </select>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => void requestQuery.refetch()}
            disabled={requestQuery.isFetching}
            aria-label="Refresh location requests"
          >
            <RefreshCw className={requestQuery.isFetching ? "animate-spin" : ""} aria-hidden="true" />
          </Button>
        </div>
      </header>

      {listState === "loading" && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground" role="status">
            Loading ATM location requests...
          </CardContent>
        </Card>
      )}

      {listState === "error" && (
        <Card className="border-destructive/30">
          <CardContent className="space-y-3 p-6" role="alert">
            <p className="font-medium text-destructive">
              Could not load ATM location requests.
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
      )}

      {listState === "empty" && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No {status ? status.toLowerCase() : ""} location requests found.
          </CardContent>
        </Card>
      )}

      {listState === "ready" && (
        <section aria-label="ATM location requests" className="space-y-3">
          {requests.map((request) => {
            const atm = getATM(request);
            return (
              <Card key={request._id}>
                <CardContent className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">
                        {atm?.atmId || "ATM reference unavailable"}
                      </p>
                      <Badge variant={statusVariant(request.status)}>
                        {formatATMLocationRequestStatus(request.status)}
                      </Badge>
                      <Badge variant="outline">
                        {request.requestType === "LOCATION_CHANGE"
                          ? "Location change"
                          : "Initial configuration"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {atm?.locationName || atm?.address || "ATM details unavailable"}
                    </p>
                    <div className="grid gap-x-5 gap-y-1 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">Requester: </span>
                        {getPersonName(request.requestedBy)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Proposed: </span>
                        {request.proposedLatitude}, {request.proposedLongitude}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Submitted: </span>
                        {formatDate(request.submittedAt)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Accuracy/source: </span>
                        {request.accuracy === null
                          ? "Not provided"
                          : `${request.accuracy} m`}{" "}
                        / {request.inputSource}
                      </p>
                    </div>
                    {request.status === "REJECTED" && request.rejectionReason && (
                      <p className="text-sm text-destructive">
                        Rejection reason: {request.rejectionReason}
                      </p>
                    )}
                  </div>
                  <Link
                    to={`/admin/location-requests/${request._id}`}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/80 sm:w-auto"
                  >
                    Review details
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} requests)
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={page <= 1 || requestQuery.isFetching}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={page >= pagination.totalPages || requestQuery.isFetching}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
