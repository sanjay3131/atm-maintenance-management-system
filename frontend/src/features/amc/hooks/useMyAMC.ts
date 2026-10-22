import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  completeEmployeeAMC,
  getEmployeeAMC,
  getMyAMC,
  saveEmployeeAMCChecklist,
  startEmployeeAMC,
  uploadEmployeeAMCPhotos,
  type AMCChecklistItem,
  type AMCCompletionData,
  type AMCStatus,
} from "@/services/amc.service";

export const useMyAMC = (
  month: number,
  year: number,
  options: { page?: number; limit?: number; status?: AMCStatus } = {},
) => {
  return useQuery({
    queryKey: ["my-amc", month, year, options],
    queryFn: () => getMyAMC({ month, year, ...options }),
  });
};

export const useEmployeeAMC = (amcId: string) =>
  useQuery({
    queryKey: ["employee-amc", amcId],
    queryFn: () => getEmployeeAMC(amcId),
    enabled: Boolean(amcId),
  });

const useEmployeeAMCMutation = <TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (_result, variables) => {
      const amcId =
        typeof variables === "object" && variables !== null && "amcId" in variables
          ? String(variables.amcId)
          : "";
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-amc"] }),
        ...(amcId
          ? [queryClient.invalidateQueries({ queryKey: ["employee-amc", amcId] })]
          : []),
      ]);
    },
  });
};

export const useStartEmployeeAMC = () =>
  useEmployeeAMCMutation(({ amcId }: { amcId: string }) =>
    startEmployeeAMC(amcId),
  );

export const useSaveEmployeeAMCChecklist = () =>
  useEmployeeAMCMutation(
    ({
      amcId,
      checklist,
    }: {
      amcId: string;
      checklist: AMCChecklistItem[];
    }) => saveEmployeeAMCChecklist(amcId, checklist),
  );

export const useCompleteEmployeeAMC = () =>
  useEmployeeAMCMutation(
    ({ amcId, data }: { amcId: string; data: AMCCompletionData }) =>
      completeEmployeeAMC(amcId, data),
  );

export const useUploadEmployeeAMCPhotos = () =>
  useEmployeeAMCMutation(
    ({
      amcId,
      files,
      onProgress,
    }: {
      amcId: string;
      files: File[];
      onProgress?: (percent: number) => void;
    }) => uploadEmployeeAMCPhotos(amcId, files, onProgress),
  );
