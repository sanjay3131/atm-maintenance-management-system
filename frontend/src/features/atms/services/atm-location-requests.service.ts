import api from "@/lib/axios";
import type {
  ATMLocationRequest,
  ATMLocationRequestListResponse,
  ATMLocationRequestStatus,
  SubmitATMLocationRequestPayload,
} from "../types/atm-location-request.types";

export const submitATMLocationRequest = async (
  payload: SubmitATMLocationRequestPayload,
): Promise<ATMLocationRequest> => {
  const response = await api.post<{ data: ATMLocationRequest }>(
    "/atm/location-requests",
    payload,
  );
  return response.data.data;
};

export const getATMLocationRequests = async ({
  status,
  atmId,
  page = 1,
  limit = 20,
}: {
  status?: ATMLocationRequestStatus;
  atmId?: string;
  page?: number;
  limit?: number;
} = {}): Promise<ATMLocationRequestListResponse> => {
  const response = await api.get<{ data: ATMLocationRequestListResponse }>(
    "/atm/location-requests",
    {
      params: {
        ...(status ? { status } : {}),
        ...(atmId ? { atmId } : {}),
        page,
        limit,
      },
    },
  );
  return response.data.data;
};

export const getATMLocationRequest = async (
  requestId: string,
): Promise<ATMLocationRequest> => {
  const response = await api.get<{ data: ATMLocationRequest }>(
    `/atm/location-requests/${requestId}`,
  );
  return response.data.data;
};

export const approveATMLocationRequest = async (
  requestId: string,
): Promise<ATMLocationRequest> => {
  const response = await api.post<{ data: ATMLocationRequest }>(
    `/atm/location-requests/${requestId}/approve`,
  );
  return response.data.data;
};

export const rejectATMLocationRequest = async (
  requestId: string,
  reason: string,
): Promise<ATMLocationRequest> => {
  const response = await api.post<{ data: ATMLocationRequest }>(
    `/atm/location-requests/${requestId}/reject`,
    { reason: reason.trim() },
  );
  return response.data.data;
};

export const reopenATMLocationRequests = async (
  atmId: string,
): Promise<{
  atmId: string;
  locationRequestReopenedAt: string;
  locationRequestReopenedBy: string;
}> => {
  const response = await api.post<{
    data: {
      atmId: string;
      locationRequestReopenedAt: string;
      locationRequestReopenedBy: string;
    };
  }>(`/atm/${atmId}/location-requests/reopen`);
  return response.data.data;
};
