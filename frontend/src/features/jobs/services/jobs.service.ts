import api from "@/lib/axios";
import type { AxiosProgressEvent } from "axios";
import type {
  AssignJobData,
  AdminJobMaterialUsage,
  AdditionalWorker,
  CancelJobData,
  CreateJobData,
  Job,
  JobHistoryEntry,
  JobMaterialItem,
  JobMaterialUsage,
  JobsListResponse,
  JobsQueryParams,
  MyJobsListResponse,
  MyJobsQueryParams,
  MyJobPerformance,
  JobPerformancePeriod,
  JobPhoto,
  ApproveJobData,
  VerifyJobData,
  UpdateJobData,
} from "../types/job.types";

export type JobPhotoType = "before" | "after";

export interface CompleteJobData {
  gps: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };
  remarks?: string;
}

export interface UploadJobPhotoResponse {
  status: "uploaded" | "finalized";
  clientPhotoId: string;
  uploadIntentId: string;
  ownerVersion: number;
  finalizationPending: boolean;
  asset?: {
    publicId: string;
    secureUrl?: string | null;
    format?: string | null;
    verifiedSha256: string;
  };
  jobPhoto?: JobPhoto;
}

export interface FinalizeJobPhotoResponse {
  status: "finalized";
  clientPhotoId: string;
  uploadIntentId: string;
  ownerVersion: number;
  finalizationPending: false;
  jobPhoto: JobPhoto;
}

export interface AdditionalWorkersMutationResponse {
  additionalWorkers: AdditionalWorker[];
  version: number;
}

export interface PendingJobPhotoUpload {
  uploadIntentId: string;
  clientPhotoId: string;
  ownerUserId: string;
  currentOwnerUserId: string;
  photoType: JobPhotoType;
  ownerVersion: number;
  state: "reserved" | "uploading" | "uploaded" | "failed" | "quarantined";
  leaseExpiresAt?: string | null;
  failureCode?: string | null;
  failedAt?: string | null;
}

export const getPendingJobPhotoUploads = async (
  jobId: string,
): Promise<PendingJobPhotoUpload[]> => {
  const response = await api.get<{ data: PendingJobPhotoUpload[] }>(
    `/photos/job/${jobId}/pending`,
  );
  return response.data.data;
};

export const getJobs = async (
  params: JobsQueryParams,
): Promise<JobsListResponse> => {
  const response = await api.get<{ data: JobsListResponse }>("/jobs/", {
    params,
  });

  return response.data.data;
};

export const getMyJobs = async (
  params: MyJobsQueryParams,
): Promise<MyJobsListResponse> => {
  const response = await api.get<{ data: MyJobsListResponse }>(
    "/jobs/my-jobs",
    { params },
  );

  return response.data.data;
};

export const getMyJobPerformance = async (
  period: JobPerformancePeriod,
): Promise<MyJobPerformance> => {
  const response = await api.get<{ data: MyJobPerformance }>(
    "/jobs/my-performance",
    { params: { period } },
  );

  return response.data.data;
};

export const getJobById = async (jobId: string): Promise<Job> => {
  const response = await api.get<{ data: Job }>(`/jobs/${jobId}`);

  return response.data.data;
};

export const getJobHistory = async (
  jobId: string,
): Promise<JobHistoryEntry[]> => {
  const response = await api.get<{ data: JobHistoryEntry[] }>(
    `/jobs/${jobId}/history`,
  );

  return response.data.data;
};

export const createAdditionalWorker = async (
  jobId: string,
  data: {
    workerType: string;
    quantity: number;
    notes?: string;
    expectedVersion: number;
  },
): Promise<AdditionalWorkersMutationResponse> => {
  const response = await api.post<{ data: AdditionalWorkersMutationResponse }>(
    `/jobs/${jobId}/additional-workers`,
    data,
  );
  return response.data.data;
};

export const updateAdditionalWorker = async (
  jobId: string,
  workerId: string,
  data: {
    workerType?: string;
    quantity?: number;
    notes?: string;
    expectedVersion: number;
  },
): Promise<AdditionalWorkersMutationResponse> => {
  const response = await api.patch<{ data: AdditionalWorkersMutationResponse }>(
    `/jobs/${jobId}/additional-workers/${workerId}`,
    data,
  );
  return response.data.data;
};

export const deleteAdditionalWorker = async (
  jobId: string,
  workerId: string,
  expectedVersion: number,
): Promise<AdditionalWorkersMutationResponse> => {
  const response = await api.delete<{
    data: AdditionalWorkersMutationResponse;
  }>(`/jobs/${jobId}/additional-workers/${workerId}`, {
    data: { expectedVersion },
  });
  return response.data.data;
};

export const getActiveMaterialItems = async (): Promise<JobMaterialItem[]> => {
  const response = await api.get<{
    data: Array<{
      _id: string;
      itemName: string;
      unit: string;
    }>;
  }>("/items", { params: { isActive: true } });

  return response.data.data.map(({ _id, itemName, unit }) => ({
    _id,
    itemName,
    unit,
  }));
};

export const getJobMaterialUsage = async (
  jobId: string,
): Promise<JobMaterialUsage[]> => {
  const response = await api.get<{
    data: Array<{
      _id: string;
      itemNameSnapshot: string;
      quantity: number;
      unitSnapshot: string;
      createdAt?: string;
    }>;
  }>(`/jobs/${jobId}/material-usage`);

  return response.data.data.map(
    ({ _id, itemNameSnapshot, quantity, unitSnapshot, createdAt }) => ({
      _id,
      itemNameSnapshot,
      quantity,
      unitSnapshot,
      createdAt,
    }),
  );
};

export const getAdminJobMaterialUsage = async (
  jobId: string,
): Promise<AdminJobMaterialUsage[]> => {
  const response = await api.get<{
    data: AdminJobMaterialUsage[];
  }>(`/jobs/${jobId}/material-usage`);

  return response.data.data.map(
    ({
      _id,
      itemNameSnapshot,
      quantity,
      unitSnapshot,
      unitCostSnapshot,
      lineCostSnapshot,
      correctionReason,
      createdAt,
    }) => ({
      _id,
      itemNameSnapshot,
      quantity,
      unitSnapshot,
      unitCostSnapshot,
      lineCostSnapshot,
      correctionReason,
      createdAt,
    }),
  );
};

export const createJobMaterialUsage = async (
  jobId: string,
  data: {
    itemId: string;
    quantity: number;
    correctionReason?: string;
  },
): Promise<void> => {
  await api.post(`/jobs/${jobId}/material-usage`, data);
};

export const deleteJobMaterialUsage = async (
  jobId: string,
  usageId: string,
): Promise<void> => {
  await api.delete(`/jobs/${jobId}/material-usage/${usageId}`);
};

export const createJob = async (data: CreateJobData): Promise<Job> => {
  const response = await api.post<{ data: Job }>("/jobs/", data);

  return response.data.data;
};

export const updateJob = async (
  jobId: string,
  data: UpdateJobData,
): Promise<Job> => {
  const response = await api.put<{ data: Job }>(`/jobs/${jobId}`, data);

  return response.data.data;
};

export const assignJob = async (
  jobId: string,
  data: AssignJobData,
): Promise<Job> => {
  const response = await api.put<{ data: Job }>(`/jobs/${jobId}/assign`, data);

  return response.data.data;
};

export const reassignJob = async (
  jobId: string,
  data: AssignJobData & { reason: string },
): Promise<Job> => {
  const response = await api.put<{ data: Job }>(
    `/jobs/${jobId}/reassign`,
    data,
  );

  return response.data.data;
};

export const acceptJob = async (jobId: string): Promise<Job> => {
  const response = await api.put<{ data: Job }>(`/jobs/${jobId}/accept`);

  return response.data.data;
};

export const startJob = async (jobId: string): Promise<Job> => {
  const response = await api.put<{ data: Job }>(`/jobs/${jobId}/start`);

  return response.data.data;
};

export const holdJob = async (
  jobId: string,
  reason?: string,
): Promise<Job> => {
  const response = await api.put<{ data: Job }>(
    `/jobs/${jobId}/hold`,
    reason ? { reason } : {},
  );

  return response.data.data;
};

export const completeJob = async (
  jobId: string,
  data: CompleteJobData,
): Promise<Job> => {
  const response = await api.put<{ data: Job }>(
    `/jobs/${jobId}/complete`,
    data,
  );

  return response.data.data;
};

export const verifyJob = async (
  jobId: string,
  data: VerifyJobData,
): Promise<Job> => {
  const response = await api.put<{ data: Job }>(`/jobs/${jobId}/verify`, data);

  return response.data.data;
};

export const approveJob = async (
  jobId: string,
  data: ApproveJobData,
): Promise<Job> => {
  const response = await api.put<{ data: Job }>(`/jobs/${jobId}/approve`, data);

  return response.data.data;
};

export const closeJob = async (jobId: string): Promise<Job> => {
  const response = await api.put<{ data: Job }>(`/jobs/${jobId}/close`);

  return response.data.data;
};

export const cancelJob = async (
  jobId: string,
  data: CancelJobData,
): Promise<Job> => {
  const response = await api.put<{ data: Job }>(
    `/jobs/${jobId}/cancel`,
    data,
  );

  return response.data.data;
};

export const uploadJobPhotos = async (
  jobId: string,
  files: File[],
  photoType: JobPhotoType,
  clientPhotoId: string,
  onProgress?: (percent: number) => void,
): Promise<UploadJobPhotoResponse> => {
  const formData = new FormData();
  files.forEach((file) => formData.append("photos", file, file.name));
  formData.append("photoType", photoType);
  formData.append("clientPhotoId", clientPhotoId);

  const response = await api.post<{ data: UploadJobPhotoResponse }>(
    `/photos/upload/${jobId}`,
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (event.total) {
          onProgress?.(Math.round((event.loaded / event.total) * 100));
        }
      },
    },
  );

  return response.data.data;
};

export const finalizeJobPhoto = async (
  jobId: string,
  uploadIntentId: string,
): Promise<FinalizeJobPhotoResponse> => {
  const response = await api.post<{ data: FinalizeJobPhotoResponse }>(
    `/photos/finalize/${jobId}/${uploadIntentId}`,
  );
  return response.data.data;
};
