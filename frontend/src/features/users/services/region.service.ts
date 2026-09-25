import api from "@/lib/axios";

export interface Region {
  _id: string;
  name: string;
  code?: string;
  description?: string;
  isActive: boolean;
  districtId: {
    _id: string;
    districtName: string;
    pinCode: string;
    state: string;
  };
}

export const getRegionsByDistrict = async (
  districtId: string,
): Promise<Region[]> => {
  const response = await api.get(`/regions/district/${districtId}`);

  return response.data.data;
};
