import type { AxiosProgressEvent } from "axios";
import api from "@/lib/axios";

export type AMCStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";

export interface AMCATMReference {
  _id?: string;
  atmId?: string | null;
  locationName?: string | null;
  address?: string | null;
  locationConfigured?: boolean;
  location?: { coordinates?: number[] };
}

export interface AMCChecklistItem {
  item: string;
  response: string;
  remarks?: string;
}

export interface EmployeeAMCRecord {
  _id: string;
  amcId: string;
  atmId?: AMCATMReference | string | null;
  month: number;
  year: number;
  status: AMCStatus;
  deadlineDate?: string | null;
  visitDate?: string | null;
  completedAt?: string | null;
  checklist?: AMCChecklistItem[];
  checklistCompleted?: boolean;
  employeeRemarks?: string;
  photoCount?: number;
}

export interface MyAMCResponse {
  amcs: EmployeeAMCRecord[];
  month: number;
  year: number;
  statusCounts: Partial<Record<AMCStatus, number>>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface MyAMCQuery {
  month: number;
  year: number;
  page?: number;
  limit?: number;
  status?: AMCStatus;
}

export interface AMCCompletionData {
  gps: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };
  remarks?: string;
}

export interface UploadedAMCPhotosResponse {
  uploaded: number;
  total: number;
  remaining: number;
}

export interface AdminAMCRecord {
  _id: string;
  amcId: string;
  atmId?: {
    _id: string;
    atmId?: string;
    locationName?: string;
    address?: string;
  } | string | null;
  employeeId?: {
    _id: string;
    firstName?: string;
    lastName?: string;
  } | string | null;
  bankId?: { _id: string; bankName?: string } | string | null;
  customerId?: { _id: string; customerName?: string } | string | null;
  districtId?: { _id: string; districtName?: string } | string | null;
  month: number;
  year: number;
  status: AMCStatus;
  deadlineDate?: string | null;
  visitDate?: string | null;
  completedAt?: string | null;
  generatedAt?: string | null;
  createdAt?: string | null;
}

export interface AdminAMCDetails
  extends Omit<
    AdminAMCRecord,
    "atmId" | "employeeId" | "bankId" | "customerId" | "districtId"
  > {
  atmId?: {
    _id?: string;
    atmId?: string | null;
    locationName?: string | null;
    address?: string | null;
  } | string | null;
  employeeId?: {
    _id?: string;
    firstName?: string | null;
    lastName?: string | null;
  } | string | null;
  bankId?: { _id?: string; bankName?: string | null } | string | null;
  customerId?:
    | { _id?: string; customerName?: string | null }
    | string
    | null;
  districtId?:
    | { _id?: string; districtName?: string | null }
    | string
    | null;
  checklist?: AMCChecklistItem[] | null;
  checklistCompleted?: boolean;
  employeeRemarks?: string | null;
  photoCount?: number;
  gpsValidated?: boolean;
  gpsDistance?: number | null;
}

export interface AdminAMCPhoto {
  _id: string;
  url?: string | null;
  thumbnailUrl?: string | null;
  uploadedAt?: string | null;
  originalName?: string | null;
  size?: number;
  mimeType?: string;
  uploadedBy?:
    | { firstName?: string | null; lastName?: string | null }
    | string
    | null;
}

export interface AdminAMCPhotosResponse {
  photos: AdminAMCPhoto[];
}

export interface AdminAMCListResponse {
  amcs: AdminAMCRecord[];
  pagination: MyAMCResponse["pagination"];
}

export interface AdminAMCQuery {
  page: number;
  limit: number;
  month?: number;
  year?: number;
  status?: AMCStatus;
  search?: string;
}

export interface AMCGenerationResult {
  created: number;
  skipped: number;
  errors: Array<{ atmId?: string; employee?: string; error: string }>;
}

export const getMyAMC = async ({
  month,
  year,
  page = 1,
  limit = 20,
  status,
}: MyAMCQuery): Promise<MyAMCResponse> => {
  const response = await api.get<{ data: MyAMCResponse }>("/amc/my-amc", {
    params: { month, year, page, limit, ...(status ? { status } : {}) },
  });

  return response.data.data;
};

export const getAdminAMCs = async (
  query: AdminAMCQuery,
): Promise<AdminAMCListResponse> => {
  const response = await api.get<{ data: AdminAMCListResponse }>("/amc", {
    params: {
      ...query,
      ...(query.search?.trim() ? { search: query.search.trim() } : {}),
    },
  });
  return response.data.data;
};

export const getAdminAMC = async (amcId: string): Promise<AdminAMCDetails> => {
  const response = await api.get<{ data: AdminAMCDetails }>(`/amc/${amcId}`);
  return response.data.data;
};

export const getAdminAMCPhotos = async (
  amcId: string,
): Promise<AdminAMCPhotosResponse> => {
  const response = await api.get<{ data: AdminAMCPhotosResponse }>(
    `/amc-photos/${amcId}`,
  );
  return response.data.data;
};

export const downloadAdminAMCPhotosZip = async (amcId: string): Promise<Blob> => {
  const response = await api.get<Blob>(`/amc/${amcId}/download-photos`, {
    responseType: "blob",
  });
  return response.data;
};

export const downloadAdminAMCReport = async (amcId: string): Promise<Blob> => {
  const response = await api.get<Blob>(`/amc/${amcId}/report`, {
    responseType: "blob",
  });
  return response.data;
};

export const generateAdminAMCs = async ({
  month,
  year,
}: {
  month: number;
  year: number;
}): Promise<AMCGenerationResult> => {
  const response = await api.post<{ data: AMCGenerationResult }>("/amc/generate", {
    month,
    year,
  });
  return response.data.data;
};

export const getEmployeeAMC = async (
  amcId: string,
): Promise<EmployeeAMCRecord> => {
  const response = await api.get<{ data: EmployeeAMCRecord }>(`/amc/${amcId}`);
  return response.data.data;
};

export const startEmployeeAMC = async (
  amcId: string,
): Promise<EmployeeAMCRecord> => {
  const response = await api.put<{ data: EmployeeAMCRecord }>(
    `/amc/${amcId}/start`,
  );
  return response.data.data;
};

export const saveEmployeeAMCChecklist = async (
  amcId: string,
  checklist: AMCChecklistItem[],
): Promise<EmployeeAMCRecord> => {
  const response = await api.put<{ data: EmployeeAMCRecord }>(
    `/amc/${amcId}/save-checklist`,
    { checklist },
  );
  return response.data.data;
};

export const completeEmployeeAMC = async (
  amcId: string,
  data: AMCCompletionData,
): Promise<EmployeeAMCRecord> => {
  const response = await api.put<{ data: EmployeeAMCRecord }>(
    `/amc/${amcId}/complete`,
    data,
  );
  return response.data.data;
};

export const uploadEmployeeAMCPhotos = async (
  amcId: string,
  files: File[],
  onProgress?: (percent: number) => void,
): Promise<UploadedAMCPhotosResponse> => {
  const formData = new FormData();
  files.forEach((file) => formData.append("photos", file, file.name));
  const response = await api.post<{
    data: UploadedAMCPhotosResponse;
  }>(`/amc-photos/upload/${amcId}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (event: AxiosProgressEvent) => {
      if (event.total) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    },
  });

  const { uploaded, total, remaining } = response.data.data;
  return { uploaded, total, remaining };
};
