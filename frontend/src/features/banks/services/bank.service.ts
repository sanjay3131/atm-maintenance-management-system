import api from "@/lib/axios";
import type {
  Bank,
  CreateBankData,
  GetBanksParams,
  UpdateBankData,
} from "../types/bank.types";

export const getBanks = async (
  params: GetBanksParams = {},
): Promise<Bank[]> => {
  const response = await api.get<{ data: Bank[] }>("/banks/", { params });
  return response.data.data;
};

export const getBankById = async (id: string): Promise<Bank> => {
  const response = await api.get<{ data: Bank }>(`/banks/${id}`);
  return response.data.data;
};

export const createBank = async (data: CreateBankData): Promise<Bank> => {
  const response = await api.post<{ data: Bank }>("/banks/", data);
  return response.data.data;
};

export const updateBank = async (
  id: string,
  data: UpdateBankData,
): Promise<Bank> => {
  const response = await api.put<{ data: Bank }>(`/banks/${id}`, data);
  return response.data.data;
};

export const deactivateBank = async (id: string): Promise<Bank> => {
  const response = await api.delete<{ data: Bank }>(`/banks/${id}`);
  return response.data.data;
};
