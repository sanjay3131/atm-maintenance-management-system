import api from "@/lib/axios";

export interface District {
  _id: string;
  districtName: string;
  pinCode: string;
  state: string;
  isActive: boolean;
  regions: string[];
}

export const getDistricts = async (): Promise<District[]> => {
  const response = await api.get("/districts");

  return response.data.data;
};
