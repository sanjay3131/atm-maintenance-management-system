import api from "@/lib/axios";
import type { AxiosProgressEvent } from "axios";
import type {
  AssignJobData,
  CreateJobData,
  Job,
  JobsListResponse,
  JobsQueryParams,
  MyJobsListResponse,
  MyJobsQueryParams,
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
  photos: NonNullable<Job["beforePhotos"]>;
  totalBefore: number;
  totalAfter: number;
}

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

export const getJobById = async (jobId: string): Promise<Job> => {
  const response = await api.get<{ data: Job }>(`/jobs/${jobId}`);

  return response.data.data;
};

export const createJob = async (data: CreateJobData): Promise<Job> => {
  const response = await api.post<{ data: Job }>("/jobs/", data);

  return response.data.data;
};

export const assignJob = async (
  jobId: string,
  data: AssignJobData,
): Promise<Job> => {
  const response = await api.put<{ data: Job }>(`/jobs/${jobId}/assign`, data);

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

export const holdJob = async (jobId: string): Promise<Job> => {
  const response = await api.put<{ data: Job }>(`/jobs/${jobId}/hold`, {});

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

export const uploadJobPhoto = async (
  jobId: string,
  file: File,
  photoType: JobPhotoType,
  onProgress?: (percent: number) => void,
): Promise<UploadJobPhotoResponse> => {
  const formData = new FormData();
  formData.append("photos", file, file.name);
  formData.append("photoType", photoType);

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
