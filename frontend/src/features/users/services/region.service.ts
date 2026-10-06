import api from "@/lib/axios";

export interface DistrictReference {
  _id: string;
  districtName: string;
  pinCode: string;
  state: string;
}

export interface Region {
  _id: string;
  name: string;
  code?: string;
  description?: string;
  isActive: boolean;
  districtId: string | DistrictReference;
}

export interface RegionFormValues {
  name: string;
  code: string;
  description: string;
  isActive: boolean;
}

export interface CreateRegionData extends RegionFormValues {
  districtId: string;
}

export type UpdateRegionData = RegionFormValues;

export const getRegionsByDistrict = async (
  districtId: string,
): Promise<Region[]> => {
  const response = await api.get<{ data: Region[] }>(
    `/regions/district/${districtId}`,
  );

  return response.data.data;
};

export const getAllRegionsByDistrict = async (
  districtId: string,
): Promise<Region[]> => {
  const response = await api.get<{ data: Region[] }>(
    `/regions/district/${districtId}/all`,
  );

  return response.data.data;
};

export const getRegionById = async (regionId: string): Promise<Region> => {
  const response = await api.get<{ data: Region }>(`/regions/${regionId}`);

  return response.data.data;
};

export const createRegion = async (
  data: CreateRegionData,
): Promise<Region> => {
  const response = await api.post<{ data: Region }>("/regions", data);

  return response.data.data;
};

export const updateRegion = async (
  regionId: string,
  data: UpdateRegionData,
): Promise<Region> => {
  const response = await api.patch<{ data: Region }>(
    `/regions/${regionId}`,
    data,
  );

  return response.data.data;
};
