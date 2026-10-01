import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createJob } from "../services/jobs.service";
import type { CreateJobData, Job } from "../types/job.types";

export const useCreateJob = () => {
  const queryClient = useQueryClient();

  return useMutation<Job, Error, CreateJobData>({
    mutationFn: createJob,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
};
