import api from "@/lib/axios";
import type { ATM } from "../types/atm.types";

export const getATMs = async (): Promise<ATM[]> => {
  const response = await api.get("/atm/getAllATMs");
  return response.data.data;
};
