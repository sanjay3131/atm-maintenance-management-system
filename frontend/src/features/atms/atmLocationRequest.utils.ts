import type {
  ATMLocationRequestStatus,
  SubmitATMLocationRequestPayload,
} from "./types/atm-location-request.types";

export type CoordinateValidation =
  | { valid: true; latitude: number; longitude: number }
  | { valid: false; error: string };

export const parseLocationCoordinates = (
  latitudeInput: string,
  longitudeInput: string,
): CoordinateValidation => {
  if (!latitudeInput.trim() || !longitudeInput.trim()) {
    return { valid: false, error: "Enter both latitude and longitude." };
  }

  const latitude = Number(latitudeInput);
  const longitude = Number(longitudeInput);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { valid: false, error: "Coordinates must be valid finite numbers." };
  }
  if (latitude < -90 || latitude > 90) {
    return { valid: false, error: "Latitude must be between -90 and 90." };
  }
  if (longitude < -180 || longitude > 180) {
    return { valid: false, error: "Longitude must be between -180 and 180." };
  }
  return { valid: true, latitude, longitude };
};

export const createATMLocationRequestPayload = ({
  atmId,
  amcId,
  latitude,
  longitude,
  inputSource,
  accuracy,
}: {
  atmId: string;
  amcId?: string;
  latitude: number;
  longitude: number;
  inputSource: "GPS" | "MANUAL";
  accuracy?: number | null;
}): SubmitATMLocationRequestPayload => ({
  atmId,
  ...(amcId ? { amcId } : {}),
  latitude,
  longitude,
  ...(inputSource === "GPS" && accuracy !== null && accuracy !== undefined
    ? { accuracy }
    : {}),
  inputSource,
});

export const getGeolocationErrorMessage = (code: number) => {
  if (code === 1) {
    return "GPS permission was denied. Allow location access or enter coordinates manually.";
  }
  if (code === 2) {
    return "Your current location is unavailable. Try GPS again or enter coordinates manually.";
  }
  return "GPS capture timed out. Try again or enter coordinates manually.";
};

export const validateRejectionReason = (reason: string) => {
  const trimmed = reason.trim();
  if (!trimmed) return "Enter a reason before rejecting this request.";
  if (trimmed.length > 1000) {
    return "Rejection reason must be 1000 characters or fewer.";
  }
  return "";
};

export const canReviewATMLocationRequests = (userType?: string | null) =>
  userType === "admin" || userType === "superAdmin";

export const canSubmitEmployeeATMLocationRequest = (
  atm:
    | {
        locationConfigured?: boolean;
        locationRequestWindowOpen?: boolean;
      }
    | null
    | undefined,
) =>
  atm != null &&
  (!atm.locationConfigured || atm.locationRequestWindowOpen === true);

export const isEmployeeLocationRequestClosed = (
  latestStatus: ATMLocationRequestStatus | undefined,
  requestWindowOpen: boolean | undefined,
  hasApprovedLocationRequest = false,
) =>
  (hasApprovedLocationRequest || latestStatus === "APPROVED") &&
  requestWindowOpen !== true;

export const getATMLocationRequestErrorMessage = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "message" in error.response.data &&
    typeof error.response.data.message === "string"
  ) {
    return error.response.data.message;
  }
  return error instanceof Error ? error.message : "Please try again.";
};

export const getATMLocationRequestListState = ({
  isLoading,
  isError,
  requests,
}: {
  isLoading: boolean;
  isError: boolean;
  requests: unknown[];
}) => {
  if (isLoading) return "loading" as const;
  if (isError) return "error" as const;
  return requests.length ? ("ready" as const) : ("empty" as const);
};

export const formatATMLocationRequestStatus = (
  status: ATMLocationRequestStatus,
) =>
  status
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
