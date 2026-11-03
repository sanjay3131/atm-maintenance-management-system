import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createAdditionalWorker,
  deleteAdditionalWorker,
  updateAdditionalWorker,
  type AdditionalWorkersMutationResponse,
} from "../services/jobs.service";
import type { Job } from "../types/job.types";
import { hasAuthoritativeAdditionalWorkersResponse } from "../utils/additionalWorkers.utils";

interface CreateAdditionalWorkerVariables {
  jobId: string;
  workerType: string;
  quantity: number;
  notes?: string;
  expectedVersion: number;
}

interface UpdateAdditionalWorkerVariables {
  jobId: string;
  workerId: string;
  workerType: string;
  quantity: number;
  notes: string;
  expectedVersion: number;
}

interface DeleteAdditionalWorkerVariables {
  jobId: string;
  workerId: string;
  expectedVersion: number;
}

function useAdditionalWorkerMutation<TVariables extends { jobId: string }>(
  mutationFn: (variables: TVariables) => Promise<AdditionalWorkersMutationResponse>,
) {
  const queryClient = useQueryClient();

  return useMutation<AdditionalWorkersMutationResponse, Error, TVariables>({
    mutationFn,
    retry: false,
    onSuccess: async (response, variables) => {
      const { jobId } = variables;
      if (hasAuthoritativeAdditionalWorkersResponse(response)) {
        queryClient.setQueryData<Job>(["job", jobId], (current) =>
          current
            ? {
                ...current,
                additionalWorkers: response.additionalWorkers,
                __v: response.version,
              }
            : current,
        );
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["job-history", jobId] }),
      ]);
    },
  });
}

export const useCreateAdditionalWorker = () =>
  useAdditionalWorkerMutation<CreateAdditionalWorkerVariables>(
    ({ jobId, ...data }) => createAdditionalWorker(jobId, data),
  );

export const useUpdateAdditionalWorker = () =>
  useAdditionalWorkerMutation<UpdateAdditionalWorkerVariables>(
    ({ jobId, workerId, ...data }) =>
      updateAdditionalWorker(jobId, workerId, data),
  );

export const useDeleteAdditionalWorker = () =>
  useAdditionalWorkerMutation<DeleteAdditionalWorkerVariables>(
    ({ jobId, workerId, expectedVersion }) =>
      deleteAdditionalWorker(jobId, workerId, expectedVersion),
  );
