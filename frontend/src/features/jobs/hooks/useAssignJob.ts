import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assignJob } from "../services/jobs.service";
import type { AssignJobData, Job } from "../types/job.types";

interface AssignJobVariables extends AssignJobData {
  jobId: string;
}

export const useAssignJob = () => {
  const queryClient = useQueryClient();

  return useMutation<Job, Error, AssignJobVariables>({
    mutationFn: ({ jobId, employeeId }) => assignJob(jobId, { employeeId }),
    onSuccess: async (_job, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({
          queryKey: ["job", variables.jobId],
        }),
      ]);
    },
  });
};
