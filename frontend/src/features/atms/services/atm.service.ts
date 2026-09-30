import api from "@/lib/axios";
import type { ATM, UpdateATMData } from "../types/atm.types";

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

export const deleteATM = async (atmId: string): Promise<void> => {
  await api.delete(`/atm/deleteATM/${atmId}`);
};
