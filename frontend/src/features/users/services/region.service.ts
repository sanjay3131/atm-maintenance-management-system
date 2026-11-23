import api from "@/lib/axios";
import type { Bank } from "@/features/banks/types/bank.types";

export interface Region {
  _id: string;
  name: string;
  code?: string;
  description?: string;
  isActive: boolean;
  bankId: string | Pick<Bank, "_id" | "bankName" | "bankCode">;
}

export interface RegionSummary {
  regionId: string;
  name: string;
  code?: string | null;
  description?: string;
  isActive: boolean;
  bank: {
    id: string;
    name: string;
    code?: string | null;
  } | null;
  counts: {
    districts: number;
    atms: number;
    employees: number;
    customers: number;
  };
}

export interface RegionSummaryParams {
  search?: string;
  status?: "active" | "inactive";
  bankId?: string;
}

export interface RegionFormValues {
  name: string;
  code: string;
  description: string;
  isActive: boolean;
}

export interface CreateRegionData extends RegionFormValues {
  bankId: string;
}

export type UpdateRegionData = Partial<RegionFormValues>;

export const getRegionSummaries = async (
  params: RegionSummaryParams = {},
): Promise<RegionSummary[]> => {
  const response = await api.get<{ data: RegionSummary[] }>(
    "/regions/summary",
    { params },
  );
  return response.data.data;
};

export const getRegionsByBank = async (
  bankId: string,
  includeInactive = false,
): Promise<Region[]> => {
  const response = await api.get<{ data: Region[] }>(
    `/regions/bank/${bankId}`,
    { params: includeInactive ? { includeInactive: true } : undefined },
  );

  return response.data.data;
};

export const getAllRegionsByBank = async (
  bankId: string,
): Promise<Region[]> => {
  const response = await api.get<{ data: Region[] }>(
    `/regions/bank/${bankId}`,
    { params: { includeInactive: true } },
  );

  return response.data.data;
};

export const getAllRegions = async (
  includeInactive = false,
): Promise<Region[]> => {
  const response = await api.get<{ data: Region[] }>("/regions", {
    params: includeInactive ? { includeInactive: true } : undefined,
  });
  return response.data.data;
};

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
