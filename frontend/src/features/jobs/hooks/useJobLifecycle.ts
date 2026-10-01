import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  acceptJob,
  completeJob,
  holdJob,
  startJob,
  uploadJobPhoto,
  type CompleteJobData,
  type JobPhotoType,
} from "../services/jobs.service";
import type { Job } from "../types/job.types";

interface JobLifecycleVariables {
  jobId: string;
}

const useJobLifecycleMutation = (
  mutationFn: (jobId: string) => Promise<Job>,
) => {
  const queryClient = useQueryClient();

  return useMutation<Job, Error, JobLifecycleVariables>({
    mutationFn: ({ jobId }) => mutationFn(jobId),
    onSuccess: async (_job, { jobId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["my-jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
    },
  });
};

export const useAcceptJob = () => useJobLifecycleMutation(acceptJob);
export const useStartJob = () => useJobLifecycleMutation(startJob);
export const useHoldJob = () => useJobLifecycleMutation(holdJob);

interface CompleteJobVariables {
  jobId: string;
  data: CompleteJobData;
}

export const useCompleteJob = () => {
  const queryClient = useQueryClient();

  return useMutation<Job, Error, CompleteJobVariables>({
    mutationFn: ({ jobId, data }) => completeJob(jobId, data),
    onSuccess: async (_job, { jobId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["my-jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
    },
  });
};

interface UploadJobPhotoVariables {
  jobId: string;
  file: File;
  photoType: JobPhotoType;
  onProgress?: (percent: number) => void;
}

export const useUploadJobPhoto = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      jobId,
      file,
      photoType,
      onProgress,
    }: UploadJobPhotoVariables) =>
      uploadJobPhoto(jobId, file, photoType, onProgress),
    onSuccess: async (_response, { jobId }) => {
      await queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });
};
