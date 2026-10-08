import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  acceptJob,
  approveJob,
  closeJob,
  completeJob,
  holdJob,
  startJob,
  uploadJobPhotos,
  verifyJob,
  type CompleteJobData,
  type JobPhotoType,
} from "../services/jobs.service";
import type { ApproveJobData, Job, VerifyJobData } from "../types/job.types";

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
        queryClient.invalidateQueries({ queryKey: ["job-history", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["my-jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
    },
  });
};

export const useAcceptJob = () => useJobLifecycleMutation(acceptJob);
export const useStartJob = () => useJobLifecycleMutation(startJob);
export const useHoldJob = () => useJobLifecycleMutation(holdJob);
export const useCloseJob = () => useJobLifecycleMutation(closeJob);

interface JobReviewVariables<TData> {
  jobId: string;
  data: TData;
}

const useJobReviewMutation = <TData>(
  mutationFn: (jobId: string, data: TData) => Promise<Job>,
) => {
  const queryClient = useQueryClient();

  return useMutation<Job, Error, JobReviewVariables<TData>>({
    mutationFn: ({ jobId, data }) => mutationFn(jobId, data),
    onSuccess: async (_job, { jobId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["job-history", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["my-jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
    },
  });
};

export const useVerifyJob = () =>
  useJobReviewMutation<VerifyJobData>(verifyJob);
export const useApproveJob = () =>
  useJobReviewMutation<ApproveJobData>(approveJob);

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
        queryClient.invalidateQueries({ queryKey: ["job-history", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["my-jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
    },
  });
};

interface UploadJobPhotoVariables {
  jobId: string;
  files: File[];
  photoType: JobPhotoType;
  onProgress?: (percent: number) => void;
}

export const useUploadJobPhoto = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      jobId,
      files,
      photoType,
      onProgress,
    }: UploadJobPhotoVariables) =>
      uploadJobPhotos(jobId, files, photoType, onProgress),
    onSuccess: async (_response, { jobId }) => {
      await queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });
};
