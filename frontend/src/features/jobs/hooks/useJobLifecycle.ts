import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  acceptJob,
  approveJob,
  cancelJob,
  closeJob,
  completeJob,
  holdJob,
  startJob,
  uploadJobPhotos,
  verifyJob,
  type CompleteJobData,
  type JobPhotoType,
} from "../services/jobs.service";
import type {
  ApproveJobData,
  CancelJobData,
  Job,
  VerifyJobData,
} from "../types/job.types";

interface JobLifecycleVariables {
  jobId: string;
  reason?: string;
}

const useJobLifecycleMutation = (
  mutationFn: (jobId: string, reason?: string) => Promise<Job>,
) => {
  const queryClient = useQueryClient();

  return useMutation<Job, Error, JobLifecycleVariables>({
    mutationFn: ({ jobId, reason }) => mutationFn(jobId, reason),
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

export const useAcceptJob = () =>
  useJobLifecycleMutation((jobId) => acceptJob(jobId));
export const useStartJob = () =>
  useJobLifecycleMutation((jobId) => startJob(jobId));
export const useHoldJob = () =>
  useJobLifecycleMutation((jobId, reason) => holdJob(jobId, reason));
export const useCloseJob = () =>
  useJobLifecycleMutation((jobId) => closeJob(jobId));

export const useCancelJob = () => {
  const queryClient = useQueryClient();

  return useMutation<
    Job,
    Error,
    { jobId: string; data: CancelJobData }
  >({
    mutationFn: ({ jobId, data }) => cancelJob(jobId, data),
    onSuccess: async (_job, { jobId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["job-history", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["my-jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({
          queryKey: ["customer-complaints"],
        }),
        queryClient.invalidateQueries({ queryKey: ["complaint"] }),
        queryClient.invalidateQueries({
          queryKey: ["complaints", "admin-list"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard-stats"],
        }),
      ]);
    },
  });
};

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
