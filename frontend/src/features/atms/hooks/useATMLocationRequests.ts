import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approveATMLocationRequest,
  getATMLocationRequest,
  getATMLocationRequests,
  reopenATMLocationRequests,
  rejectATMLocationRequest,
  submitATMLocationRequest,
} from "../services/atm-location-requests.service";
import type {
  ATMLocationRequest,
  ATMLocationRequestStatus,
  SubmitATMLocationRequestPayload,
} from "../types/atm-location-request.types";

export const useATMLocationRequests = (
  status?: ATMLocationRequestStatus,
  page = 1,
  limit = 20,
  atmId?: string,
  filters: {
    search?: string;
    districtId?: string;
    regionId?: string;
    employeeId?: string;
  } = {},
) =>
  useQuery({
    queryKey: ["atm-location-requests", status, page, limit, atmId, filters],
    queryFn: () =>
      getATMLocationRequests({ status, page, limit, atmId, ...filters }),
  });

export const useMyATMLocationRequests = (atmId: string) =>
  useQuery({
    queryKey: ["my-atm-location-requests", atmId],
    queryFn: () => getATMLocationRequests({ atmId, page: 1, limit: 100 }),
    enabled: Boolean(atmId),
  });

export const useATMLocationRequest = (requestId: string) =>
  useQuery({
    queryKey: ["atm-location-request", requestId],
    queryFn: () => getATMLocationRequest(requestId),
    enabled: Boolean(requestId),
  });

export const useSubmitATMLocationRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SubmitATMLocationRequestPayload) =>
      submitATMLocationRequest(payload),
    onSuccess: async (_request, payload) => {
      await queryClient.invalidateQueries({
        queryKey: ["my-atm-location-requests", payload.atmId],
      });
    },
  });
};

const useReviewMutation = <TVariables, TData>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (_result, variables) => {
      const atmId =
        typeof variables === "object" &&
        variables !== null &&
        "atmId" in variables
          ? String(variables.atmId)
          : "";
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["atm-location-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["atm-location-request"] }),
        queryClient.invalidateQueries({ queryKey: ["atm-location-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["atms"] }),
        queryClient.invalidateQueries({ queryKey: ["atm"] }),
        ...(atmId
          ? [queryClient.invalidateQueries({
              queryKey: ["my-atm-location-requests", atmId],
            })]
          : []),
      ]);
    },
  });
};

export const useApproveATMLocationRequest = () =>
  useReviewMutation<{ requestId: string }, ATMLocationRequest>(
    ({ requestId }) => approveATMLocationRequest(requestId),
  );

export const useRejectATMLocationRequest = () =>
  useReviewMutation<{ requestId: string; reason: string }, ATMLocationRequest>(
    ({ requestId, reason }) =>
      rejectATMLocationRequest(requestId, reason),
  );

export const useReopenATMLocationRequests = () =>
  useReviewMutation<{ atmId: string }, Awaited<ReturnType<typeof reopenATMLocationRequests>>>(
    ({ atmId }) => reopenATMLocationRequests(atmId),
  );
