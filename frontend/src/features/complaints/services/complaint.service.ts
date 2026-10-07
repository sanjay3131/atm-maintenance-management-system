import api from "@/lib/axios";
import type {
  Complaint,
  CreateComplaintData,
  ComplaintListParams,
  ComplaintListResponse,
} from "../types/complaint.types";

export const getAdminComplaints = async (
  filters: ComplaintListParams,
): Promise<ComplaintListResponse> => {
  const response = await api.get<{ data: ComplaintListResponse }>(
    "/complaints",
    { params: filters },
  );

  return response.data.data;
};

export const getComplaintById = async (id: string): Promise<Complaint> => {
  const response = await api.get<{ data: Complaint }>(`/complaints/${id}`);
  return response.data.data;
};

export const createComplaint = async (
  data: CreateComplaintData,
): Promise<Complaint> => {
  const response = await api.post<{ data: Complaint }>("/complaints", data);
  return response.data.data;
};
