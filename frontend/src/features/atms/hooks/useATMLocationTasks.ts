import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelATMLocationTask,
  createATMLocationTasks,
  getAllActiveATMLocationTasks,
  getATMLocationTasks,
  holdATMLocationTask,
  reassignATMLocationTask,
  reopenATMLocationTask,
  resumeATMLocationTask,
  startATMLocationTask,
} from "../services/atm-location-tasks.service";
import type {
  ATMLocationTaskFilters,
  CancelATMLocationTaskPayload,
  CreateATMLocationTasksPayload,
  ReassignATMLocationTaskPayload,
  ReopenATMLocationTaskPayload,
} from "../types/atm-location-task.types";

export const atmLocationTaskQueryKeys = {
  all: ["atm-location-tasks"] as const,
  list: (filters: ATMLocationTaskFilters) =>
    ["atm-location-tasks", "list", filters] as const,
  active: ["atm-location-tasks", "active"] as const,
};

export const useATMLocationTasks = (filters: ATMLocationTaskFilters) =>
  useQuery({
    queryKey: atmLocationTaskQueryKeys.list(filters),
    queryFn: () => getATMLocationTasks(filters),
  });

export const useAllActiveATMLocationTasks = () =>
  useQuery({
    queryKey: atmLocationTaskQueryKeys.active,
    queryFn: getAllActiveATMLocationTasks,
  });

export const useStartATMLocationTask = () =>
  useLocationTaskMutation((taskId: string) => startATMLocationTask(taskId));

export const useHoldATMLocationTask = () =>
  useLocationTaskMutation((taskId: string) => holdATMLocationTask(taskId));

export const useResumeATMLocationTask = () =>
  useLocationTaskMutation((taskId: string) => resumeATMLocationTask(taskId));

const useLocationTaskMutation = <TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: atmLocationTaskQueryKeys.all,
        }),
        queryClient.invalidateQueries({ queryKey: ["atms"] }),
      ]);
    },
  });
};

export const useCreateATMLocationTasks = () =>
  useLocationTaskMutation((payload: CreateATMLocationTasksPayload) =>
    createATMLocationTasks(payload),
  );

export const useReassignATMLocationTask = () =>
  useLocationTaskMutation(
    ({
      taskId,
      payload,
    }: {
      taskId: string;
      payload: ReassignATMLocationTaskPayload;
    }) => reassignATMLocationTask(taskId, payload),
  );

export const useReopenATMLocationTask = () =>
  useLocationTaskMutation(
    ({
      taskId,
      payload,
    }: {
      taskId: string;
      payload: ReopenATMLocationTaskPayload;
    }) => reopenATMLocationTask(taskId, payload),
  );

export const useCancelATMLocationTask = () =>
  useLocationTaskMutation(
    ({
      taskId,
      payload,
    }: {
      taskId: string;
      payload: CancelATMLocationTaskPayload;
    }) => cancelATMLocationTask(taskId, payload),
  );
