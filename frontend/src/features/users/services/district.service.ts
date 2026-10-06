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

export const getDistricts = async (): Promise<District[]> => {
  const response = await api.get<ApiResponse<District[]>>("/districts");

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
