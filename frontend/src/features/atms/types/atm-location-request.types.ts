export type ATMLocationRequestStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ATMLocationRequestSource = "GPS" | "MANUAL";

export interface ATMLocationRequestATM {
  _id?: string;
  atmId?: string;
  locationName?: string;
  address?: string;
  districtId?: { _id?: string; districtName?: string } | string | null;
  regionId?: { _id?: string; name?: string } | string | null;
  location?: { coordinates?: number[] } | null;
  locationConfigured?: boolean;
  locationRequestReopenedAt?: string | null;
  locationRequestWindowOpen?: boolean;
}

export interface ATMLocationRequestPerson {
  _id?: string;
  firstName?: string;
  lastName?: string;
  userType?: string;
  employeeCode?: string;
}

export interface OfficialLocationSnapshot {
  locationConfigured: boolean;
  coordinates: number[] | null;
  locationCapturedAt: string | null;
  locationCapturedBy: string | null;
}

export interface ATMLocationRequest {
  _id: string;
  atmId: string | ATMLocationRequestATM | null;
  requestType: "INITIAL_CONFIGURATION" | "LOCATION_CHANGE";
  requestedBy: string | ATMLocationRequestPerson;
  requesterRole: "employee" | "admin" | "superAdmin";
  requesterEmployeeId: string | ATMLocationRequestPerson | null;
  locationTaskId?: string | null;
  amcId: string | null;
  proposedLatitude: number;
  proposedLongitude: number;
  accuracy: number | null;
  inputSource: ATMLocationRequestSource;
  submittedAt: string;
  officialLocationSnapshot: OfficialLocationSnapshot;
  status: ATMLocationRequestStatus;
  reviewedBy: string | ATMLocationRequestPerson | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ATMLocationRequestListResponse {
  requests: ATMLocationRequest[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SubmitATMLocationRequestPayload {
  atmId: string;
  locationTaskId?: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  inputSource: ATMLocationRequestSource;
  amcId?: string;
}
