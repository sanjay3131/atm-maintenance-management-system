import api from "@/lib/axios";

export interface CreateATMData {
  bankId: string;
  customerId: string;
  districtId: string;
  regionId: string | null;
  locationName: string;
  address: string;
  installationType: "ONSITE" | "OFFSITE";
  location?: {
    type: "Point";
    coordinates: [number, number];
  };
  status?: "ACTIVE" | "INACTIVE" | "UNDER_MAINTENANCE" | "REMOVED";
  assignedEmployeeId?: string[];
}

export interface CreatedATM {
  _id: string;
  atmId: string;
  customer: string;
  bankId: string;
  districtId: string;
  regionId: string | null;
  locationName: string;
  address: string;
  installationType: "ONSITE" | "OFFSITE";
  status: string;
}

export const createATM = async (data: CreateATMData): Promise<CreatedATM> => {
  const response = await api.post("/atm/createATM", data);

  return response.data.data;
};
