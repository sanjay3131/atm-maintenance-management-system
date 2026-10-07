import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reassignJob } from "../services/jobs.service";
import type { Job } from "../types/job.types";

interface ReassignJobVariables {
  jobId: string;
  employeeId: string;
  reason: string;
}

export const useReassignJob = () => {
  const queryClient = useQueryClient();

  return useMutation<Job, Error, ReassignJobVariables>({
    mutationFn: ({ jobId, employeeId, reason }) =>
      reassignJob(jobId, { employeeId, reason }),
    onSuccess: async (_job, { jobId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["my-jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
      ]);
    },
  });
};
