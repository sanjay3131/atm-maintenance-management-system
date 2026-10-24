import { useRef, useState } from "react";
import { MapPin, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useMyATMLocationRequests,
  useSubmitATMLocationRequest,
} from "@/features/atms/hooks/useATMLocationRequests";
import {
  createATMLocationRequestPayload,
  getGeolocationErrorMessage,
  getATMLocationRequestErrorMessage,
  isAcceptableATMLocationRequestAccuracy,
  isEmployeeLocationRequestClosed,
  parseLocationCoordinates,
} from "@/features/atms/atmLocationRequest.utils";
import type { ATMLocationRequest } from "@/features/atms/types/atm-location-request.types";

interface EmployeeATMLocationRequestProps {
  atmId: string;
  atmCode: string;
  amcId: string;
  locationConfigured?: boolean;
  officialCoordinates?: number[];
  hasApprovedLocationRequest?: boolean;
  locationRequestWindowOpen?: boolean;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

export default function EmployeeATMLocationRequest({
  atmId,
  atmCode,
  amcId,
  locationConfigured,
  officialCoordinates,
  hasApprovedLocationRequest = false,
  locationRequestWindowOpen,
}: EmployeeATMLocationRequestProps) {
  const submitMutation = useSubmitATMLocationRequest();
  const historyQuery = useMyATMLocationRequests(atmId);
  const submittingRef = useRef(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [inputSource, setInputSource] = useState<"GPS" | "MANUAL">("MANUAL");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [submittedRequest, setSubmittedRequest] =
    useState<ATMLocationRequest | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const ownRequests = historyQuery.data?.requests ?? [];
  const latestRequest = ownRequests[0] ?? submittedRequest;
  const isPending = latestRequest?.status === "PENDING";
  const latestATM =
    latestRequest && typeof latestRequest.atmId === "object"
      ? latestRequest.atmId
      : null;
  const isApprovedAndClosed = isEmployeeLocationRequestClosed(
    latestRequest?.status,
    latestATM?.locationRequestWindowOpen ?? locationRequestWindowOpen,
    hasApprovedLocationRequest,
  );

  const captureGPS = () => {
    setError("");
    if (!navigator.geolocation) {
      setError("This browser does not support GPS location capture. Enter coordinates manually.");
      return;
    }
    setLatitude("");
    setLongitude("");
    setAccuracy(null);
    setInputSource("MANUAL");
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(String(position.coords.latitude));
        setLongitude(String(position.coords.longitude));
        setAccuracy(position.coords.accuracy);
        setInputSource("GPS");
        setIsLocating(false);
      },
      (locationError) => {
        setIsLocating(false);
        setError(getGeolocationErrorMessage(locationError.code));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };

  const updateCoordinates = (
    setter: (value: string) => void,
    value: string,
  ) => {
    setter(value);
    setInputSource("MANUAL");
    setAccuracy(null);
  };

  const submit = async () => {
    if (submittingRef.current || isPending || isApprovedAndClosed) return;
    setError("");
    const coordinates = parseLocationCoordinates(latitude, longitude);
    if (!coordinates.valid) {
      setError(coordinates.error);
      return;
    }
    if (
      inputSource === "GPS" &&
      !isAcceptableATMLocationRequestAccuracy(accuracy)
    ) {
      setError("GPS accuracy must be 50 meters or better. Capture GPS again or enter coordinates manually.");
      return;
    }

    try {
      submittingRef.current = true;
      const request = await submitMutation.mutateAsync(createATMLocationRequestPayload({
        atmId,
        amcId,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        inputSource,
        accuracy,
      }));
      setSubmittedRequest(request);
    } catch (requestError) {
      setError(getATMLocationRequestErrorMessage(requestError));
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="size-5 text-primary" aria-hidden="true" />
          Request ATM location review
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Submit a proposed location for {atmCode}. It will not change the official ATM coordinates until an Admin or SuperAdmin approves it.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {historyQuery.isLoading && (
          <p className="text-sm text-muted-foreground" role="status">
            Checking this ATM&apos;s location-request history...
          </p>
        )}
        {historyQuery.isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
            Could not verify whether a request is already pending or approved.{" "}
            {getATMLocationRequestErrorMessage(historyQuery.error)}
            <Button
              type="button"
              variant="outline"
              className="mt-2 min-h-11"
              onClick={() => void historyQuery.refetch()}
              disabled={historyQuery.isFetching}
            >
              {historyQuery.isFetching ? "Retrying..." : "Retry status check"}
            </Button>
          </div>
        )}
        {latestRequest && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-semibold">
              Your latest request: {latestRequest.status}
            </p>
            <p className="mt-1 text-muted-foreground">
              Submitted {formatDate(latestRequest.submittedAt)}.
            </p>
            {latestRequest.status === "PENDING" && (
              <p className="mt-1">An Admin or SuperAdmin must review it. You cannot submit another request while it is pending.</p>
            )}
            {latestRequest.status === "APPROVED" && (
              <p className="mt-1">
                {isApprovedAndClosed
                  ? "Approved. Location requests are closed for this ATM."
                  : "Approved previously. An Admin has reopened location requests for this ATM."}
              </p>
            )}
            {latestRequest.status === "REJECTED" && latestRequest.rejectionReason && (
              <p className="mt-2 text-destructive">
                Rejection reason: {latestRequest.rejectionReason}
              </p>
            )}
          </div>
        )}
        {isApprovedAndClosed && (
          <p className="rounded-lg border border-emerald-600/20 bg-emerald-600/5 p-3 text-sm" role="status">
            The location was approved. Your request option will remain hidden until an Admin or SuperAdmin explicitly reopens it.
          </p>
        )}
        {historyQuery.isError === false &&
          !historyQuery.isLoading &&
          !latestRequest &&
          submittedRequest && (
            <div className="rounded-lg border border-emerald-600/20 bg-emerald-600/5 p-3 text-sm" role="status">
              Request submitted: {submittedRequest.status}. An Admin or SuperAdmin must review it.
            </div>
          )}
        {locationConfigured && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Official location is currently configured.</p>
            {officialCoordinates?.length === 2 && (
              <p className="mt-1 text-muted-foreground">
                {officialCoordinates[1]}, {officialCoordinates[0]} (latitude, longitude)
              </p>
            )}
            <p className="mt-1 text-muted-foreground">
              Your proposal requests a review; it does not update this location directly.
            </p>
          </div>
        )}

        {!isPending && !isApprovedAndClosed && !historyQuery.isError && (
        <>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={captureGPS}
            disabled={isLocating || submitMutation.isPending}
          >
            <Navigation aria-hidden="true" />
            {isLocating ? "Capturing GPS..." : "Use current GPS"}
          </Button>
          {inputSource === "GPS" && accuracy !== null && (
            <p className="self-center text-sm text-muted-foreground" role="status">
              Captured accuracy: {Math.round(accuracy)} m
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="location-request-latitude" className="mb-1 block text-sm font-medium">
              Latitude
            </label>
            <input
              id="location-request-latitude"
              type="number"
              step="any"
              min="-90"
              max="90"
              value={latitude}
              onChange={(event) => updateCoordinates(setLatitude, event.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="location-request-longitude" className="mb-1 block text-sm font-medium">
              Longitude
            </label>
            <input
              id="location-request-longitude"
              type="number"
              step="any"
              min="-180"
              max="180"
              value={longitude}
              onChange={(event) => updateCoordinates(setLongitude, event.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3"
              autoComplete="off"
            />
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          type="button"
          className="min-h-11 w-full sm:w-auto"
          onClick={() => void submit()}
          disabled={
            isLocating ||
            submitMutation.isPending ||
            historyQuery.isLoading ||
            historyQuery.isError ||
            !latitude ||
            !longitude
          }
        >
          {submitMutation.isPending ? "Submitting request..." : "Submit for review"}
        </Button>
        </>
        )}
      </CardContent>
    </Card>
  );
}
