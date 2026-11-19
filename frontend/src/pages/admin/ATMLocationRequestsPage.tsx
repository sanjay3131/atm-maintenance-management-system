import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { getATMDisplayId } from "@/features/atms/atmDisplay.utils";
import { MapPin, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useATMLocationRequests,
  useRejectATMLocationRequest,
} from "@/features/atms/hooks/useATMLocationRequests";
import {
  canDecideATMLocationRequest,
  formatATMLocationRequestStatus,
  getATMLocationRequestErrorMessage,
  getATMLocationRequestListState,
  validateRejectionReason,
} from "@/features/atms/atmLocationRequest.utils";
import type {
  ATMLocationRequest,
  ATMLocationRequestStatus,
} from "@/features/atms/types/atm-location-request.types";
import { useDistricts } from "@/features/users/hooks/useDistricts";
import { useRegionsByDistrict } from "@/features/users/hooks/useRegionsByDistrict";
import { useEmployees } from "@/features/employees/hooks/useEmployees";
import { getEmployeeDisplayName, isEligibleLocationTaskEmployee } from "@/features/atms/atmLocationTask.utils";

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

function getEmployeeCode(request: ATMLocationRequest) {
  const employee = request.requesterEmployeeId;
  return employee && typeof employee !== "string"
    ? employee.employeeCode || "Not available"
    : "Not available";
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
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [districtId, setDistrictId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const { data: districts = [] } = useDistricts();
  const { data: regions = [] } = useRegionsByDistrict(districtId);
  const { data: employeeData = [] } = useEmployees();
  const employees = useMemo(
    () => employeeData.filter(isEligibleLocationTaskEmployee),
    [employeeData],
  );
  const requestFilters = useMemo(
    () => ({
      search: deferredSearch.trim() || undefined,
      districtId: districtId || undefined,
      regionId: regionId || undefined,
      employeeId: employeeId || undefined,
    }),
    [deferredSearch, districtId, employeeId, regionId],
  );
  const requestQuery = useATMLocationRequests(
    status || undefined,
    page,
    PAGE_SIZE,
    undefined,
    requestFilters,
  );
  const rejectMutation = useRejectATMLocationRequest();
  const [rejectionRequest, setRejectionRequest] =
    useState<ATMLocationRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionError, setRejectionError] = useState("");
  const [confirmingRejection, setConfirmingRejection] = useState(false);
  const requests = requestQuery.data?.requests ?? [];
  const pagination = requestQuery.data?.pagination;
  const listState = getATMLocationRequestListState({
    isLoading: requestQuery.isLoading,
    isError: requestQuery.isError,
    requests,
  });
  const clearFilters = () => {
    setStatus("");
    setSearch("");
    setDistrictId("");
    setRegionId("");
    setEmployeeId("");
    setPage(1);
  };
  const closeRejectionDialog = () => {
    if (rejectMutation.isPending) return;
    setRejectionRequest(null);
    setRejectionReason("");
    setRejectionError("");
    setConfirmingRejection(false);
  };
  const openRejectionDialog = (request: ATMLocationRequest) => {
    if (!canDecideATMLocationRequest(request.status)) return;
    setRejectionRequest(request);
    setRejectionReason("");
    setRejectionError("");
    setConfirmingRejection(false);
  };
  const continueToRejectionConfirmation = () => {
    const reasonError = validateRejectionReason(rejectionReason);
    if (reasonError) {
      setRejectionError(reasonError);
      return;
    }
    setRejectionError("");
    setConfirmingRejection(true);
  };
  const confirmRejection = async () => {
    const request = rejectionRequest;
    if (
      !request ||
      rejectMutation.isPending ||
      !canDecideATMLocationRequest(request.status)
    ) {
      return;
    }
    const reasonError = validateRejectionReason(rejectionReason);
    if (reasonError) {
      setRejectionError(reasonError);
      return;
    }
    setRejectionError("");
    try {
      await rejectMutation.mutateAsync({
        requestId: request._id,
        reason: rejectionReason.trim(),
      });
      closeRejectionDialog();
      toast.success("Location request rejected.");
    } catch (actionError) {
      setRejectionError(getATMLocationRequestErrorMessage(actionError));
    }
  };

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
        <div className="flex flex-wrap gap-2">
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

      <section
        aria-label="Filter ATM location requests"
        className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 xl:grid-cols-5"
      >
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="location-request-search">
            ATM identifier or name
          </label>
          <input
            id="location-request-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="ATM ID, location, or address"
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="location-request-district">
            District
          </label>
          <select
            id="location-request-district"
            value={districtId}
            onChange={(event) => {
              setDistrictId(event.target.value);
              setRegionId("");
              setPage(1);
            }}
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="">All districts</option>
            {districts.map((district) => (
              <option key={district._id} value={district._id}>
                {district.districtName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="location-request-region">
            Region
          </label>
          <select
            id="location-request-region"
            value={regionId}
            onChange={(event) => {
              setRegionId(event.target.value);
              setPage(1);
            }}
            disabled={!districtId || regions.length === 0}
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
          >
            <option value="">All regions</option>
            {regions.map((region) => (
              <option key={region._id} value={region._id}>
                {region.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="location-request-employee">
            Employee / submitter
          </label>
          <select
            id="location-request-employee"
            value={employeeId}
            onChange={(event) => {
              setEmployeeId(event.target.value);
              setPage(1);
            }}
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="">All employees</option>
            {employees.map((employee) => (
              <option key={employee._id} value={employee._id}>
                {getEmployeeDisplayName(employee)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            disabled={!status && !search && !districtId && !regionId && !employeeId}
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        </div>
      </section>

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
            No {status ? status.toLowerCase() : ""} location requests match these filters. Requests with missing optional district, region, or employee details remain visible unless that specific filter is selected.
          </CardContent>
        </Card>
      )}

      {requestQuery.isFetching && !requestQuery.isLoading && (
        <p className="text-sm text-muted-foreground" role="status">
          Updating request results…
        </p>
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
                        {getATMDisplayId(atm) || "ATM reference unavailable"}
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
                    {(typeof atm?.districtId === "object" &&
                      atm.districtId?.districtName) ||
                    (typeof atm?.regionId === "object" && atm.regionId?.name) ? (
                      <p className="text-xs text-muted-foreground">
                        {[
                          typeof atm.districtId === "object"
                            ? atm.districtId?.districtName
                            : undefined,
                          typeof atm.regionId === "object"
                            ? atm.regionId?.name
                            : undefined,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                    <div className="grid gap-x-5 gap-y-1 text-sm sm:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">Submitted by: </span>
                        {getPersonName(request.requestedBy)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Employee code: </span>
                        {getEmployeeCode(request)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Proposed latitude: </span>
                        {request.proposedLatitude}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Proposed longitude: </span>
                        {request.proposedLongitude}
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
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Link
                      to={`/admin/location-requests/${request._id}`}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/80 sm:w-auto"
                    >
                      Review details
                    </Link>
                    {canDecideATMLocationRequest(request.status) && (
                      <Button
                        type="button"
                        variant="destructive"
                        className="min-h-11"
                        disabled={rejectMutation.isPending}
                        onClick={() => openRejectionDialog(request)}
                      >
                        Reject
                      </Button>
                    )}
                  </div>
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

      <Dialog
        open={rejectionRequest !== null}
        onOpenChange={(open) => {
          if (!open) closeRejectionDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>
            {confirmingRejection
              ? "Confirm location request rejection?"
              : "Reject location request"}
          </DialogTitle>
          <DialogDescription className="mt-2">
            {confirmingRejection
              ? "This proposal will be rejected and the reason will be recorded."
              : "Enter a reason for rejecting this proposed ATM location."}
          </DialogDescription>
          {confirmingRejection ? (
            <p className="mt-3 rounded-md bg-muted p-3 text-sm">
              {rejectionReason.trim()}
            </p>
          ) : (
            <div className="mt-4">
              <label
                htmlFor="location-request-list-rejection-reason"
                className="mb-1 block text-sm font-medium"
              >
                Rejection reason
              </label>
              <textarea
                id="location-request-list-rejection-reason"
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                maxLength={1000}
                rows={3}
                disabled={rejectMutation.isPending}
                placeholder="Required when rejecting"
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {rejectionReason.length}/1000 characters
              </p>
            </div>
          )}
          {rejectionError && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {rejectionError}
            </p>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {confirmingRejection ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={rejectMutation.isPending}
                  onClick={() => {
                    setConfirmingRejection(false);
                    setRejectionError("");
                  }}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={
                    rejectMutation.isPending ||
                    !rejectionRequest ||
                    !canDecideATMLocationRequest(rejectionRequest.status)
                  }
                  onClick={() => void confirmRejection()}
                >
                  {rejectMutation.isPending
                    ? "Rejecting..."
                    : "Confirm rejection"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={rejectMutation.isPending}
                  onClick={closeRejectionDialog}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={
                    rejectMutation.isPending ||
                    !rejectionRequest ||
                    !canDecideATMLocationRequest(rejectionRequest.status)
                  }
                  onClick={continueToRejectionConfirmation}
                >
                  Continue
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
