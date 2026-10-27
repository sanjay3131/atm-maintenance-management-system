import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateJob } from "../services/jobs.service";
import type { Job, UpdateJobData } from "../types/job.types";

export const useUpdateJob = () => {
  const queryClient = useQueryClient();

  return useMutation<Job, Error, { jobId: string; data: UpdateJobData }>({
    mutationFn: ({ jobId, data }) => updateJob(jobId, data),
    onSuccess: async (_job, { jobId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["my-jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
      ]);
    },
  });
};
