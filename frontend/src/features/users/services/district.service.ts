import api from "@/lib/axios";
import type {
  CreateDistrictData,
  District,
  DistrictGeographicSummary,
  UpdateDistrictData,
} from "../types/district.types";

interface ApiResponse<T> {
  data: T;
}

export const getDistricts = async (regionId?: string): Promise<District[]> => {
  const response = await api.get<ApiResponse<District[]>>("/districts", {
    params: regionId ? { regionId } : undefined,
  });

  return response.data.data;
};

export const getDistrictGeographicSummaries = async (): Promise<
  DistrictGeographicSummary[]
> => {
  const response = await api.get<ApiResponse<DistrictGeographicSummary[]>>(
    "/districts/geographic-summaries",
  );
  return response.data.data;
};

export const getDistrictById = async (id: string): Promise<District> => {
  const response = await api.get<ApiResponse<District>>(`/districts/${id}`);
  return response.data.data;
};

export const createDistrict = async (
  data: CreateDistrictData,
): Promise<District> => {
  const response = await api.post<ApiResponse<District>>("/districts", data);
  return response.data.data;
};

export const transferDistrict = async (
  districtId: string,
  data: { regionId: string; reason: string },
): Promise<{ _id: string }> => {
  const response = await api.post<ApiResponse<{ _id: string }>>(
    `/districts/${districtId}/transfer`,
    data,
  );
  return response.data.data;
};

export const getDistrictTransfers = async (districtId: string) => {
  const response = await api.get<ApiResponse<DistrictTransfer[]>>(
    `/districts/${districtId}/transfers`,
  );
  return response.data.data;
};

export interface DistrictTransfer {
  _id: string;
  fromRegionId: { _id: string; name: string };
  toRegionId: { _id: string; name: string };
  fromRegionName: string;
  toRegionName: string;
  reason: string;
  affectedATMCount: number;
  performedBy: { firstName?: string; lastName?: string } | string;
  createdAt: string;
}

export const updateDistrict = async (
  id: string,
  data: UpdateDistrictData,
): Promise<District> => {
  const response = await api.patch<ApiResponse<District>>(
    `/districts/${id}`,
    data,
  );
  return response.data.data;
};
