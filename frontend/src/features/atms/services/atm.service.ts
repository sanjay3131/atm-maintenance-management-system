import api from "@/lib/axios";
import type {
  ATM,
  ScopedATMsResponse,
  SetATMLocationData,
  UpdateATMData,
} from "../types/atm.types";

export const getDistrictATMs = async (
  districtId: string,
  page: number,
  limit: number,
): Promise<ScopedATMsResponse> => {
  const response = await api.get<{ data: ScopedATMsResponse }>(
    "/atm/getAllATMs",
    { params: { districtId, page, limit } },
  );
  return response.data.data;
};

export const getRegionATMs = async (
  regionId: string,
  page: number,
  limit: number,
): Promise<ScopedATMsResponse> => {
  const response = await api.get<{ data: ScopedATMsResponse }>(
    "/atm/getAllATMs",
    { params: { regionId, page, limit } },
  );
  return response.data.data;
};

export const getATMs = async (): Promise<ATM[]> => {
  const response = await api.get("/atm/getAllATMs");
  return response.data.data;
};

export const getATMById = async (atmId: string): Promise<ATM> => {
  const response = await api.get(`/atm/getATMById/${atmId}`);
  return response.data.data;
};

export const updateATM = async (
  atmId: string,
  data: UpdateATMData,
): Promise<void> => {
  await api.patch(`/atm/updateATM/${atmId}`, data);
};

export const assignEmployeeToATM = async (
  atmId: string,
  employeeId: string | null,
): Promise<ATM> => {
  const response = await api.patch(`/atm/assignEmployee/${atmId}`, {
    employeeId,
  });
  return response.data.data;
};

export const setATMAMCResponsibleEmployee = async (
  atmId: string,
  employeeId: string | null,
): Promise<ATM> => {
  const response = await api.patch(`/atm/${atmId}/amc-responsible`, {
    employeeId,
  });
  return response.data.data;
};

export const setATMLocation = async (
  atmId: string,
  data: SetATMLocationData,
): Promise<ATM> => {
  const response = await api.post<{ data: ATM }>(
    `/atm/${atmId}/set-location`,
    data,
  );
  return response.data.data;
};

export const deleteATM = async (atmId: string): Promise<void> => {
  await api.delete(`/atm/deleteATM/${atmId}`);
};
