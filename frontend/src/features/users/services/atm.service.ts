import api from "@/lib/axios";

export interface ATM {
  _id: string;
  atmId: string;
  locationName: string;
  address: string;
  installationType: "ONSITE" | "OFFSITE";
  status: "ACTIVE" | "INACTIVE" | "UNDER_MAINTENANCE" | "REMOVED";

  bankId: {
    _id: string;
    bankName: string;
  };

  districtId: {
    _id: string;
    districtName: string;
  };

  regionId: {
    _id: string;
    name: string;
  } | null;

  assignedEmployeeId: string[];
}

export const getATMs = async (): Promise<ATM[]> => {
  const response = await api.get("/atm/getAllATMs");

  return response.data.data;
};
