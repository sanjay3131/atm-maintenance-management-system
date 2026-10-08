import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createJobMaterialUsage,
  getActiveMaterialItems,
  getJobMaterialUsage,
} from "../services/jobs.service";

export const jobMaterialUsageQueryKey = (jobId: string) => [
  "job-material-usage",
  jobId,
];

export const useJobMaterialUsage = (jobId: string) =>
  useQuery({
    queryKey: jobMaterialUsageQueryKey(jobId),
    queryFn: () => getJobMaterialUsage(jobId),
    enabled: Boolean(jobId),
    retry: false,
  });

export const useActiveMaterialItems = (enabled: boolean) =>
  useQuery({
    queryKey: ["items", "active"],
    queryFn: getActiveMaterialItems,
    enabled,
    retry: false,
  });

interface CreateUsageVariables {
  jobId: string;
  itemId: string;
  quantity: number;
}

export const useCreateJobMaterialUsage = () => {
  const queryClient = useQueryClient();

  return useMutation<void, Error, CreateUsageVariables>({
    mutationFn: ({ jobId, itemId, quantity }) =>
      createJobMaterialUsage(jobId, { itemId, quantity }),
    onSuccess: async (_response, { jobId }) => {
      await queryClient.invalidateQueries({
        queryKey: jobMaterialUsageQueryKey(jobId),
      });
    },
    onError: async (error, { jobId }) => {
      if (
        !isAxiosError(error) ||
        ![400, 403, 404].includes(error.response?.status ?? 0)
      ) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({
          queryKey: jobMaterialUsageQueryKey(jobId),
        }),
        ...(error.response?.status === 404
          ? [queryClient.invalidateQueries({ queryKey: ["items", "active"] })]
          : []),
      ]);
    },
  });
};
