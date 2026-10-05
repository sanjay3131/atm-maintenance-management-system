import { useQuery } from "@tanstack/react-query";
import { getBanks } from "../services/bank.service";
import type { GetBanksParams } from "../types/bank.types";

export const BANKS_QUERY_KEY = ["banks"];

export const useBanks = (params: GetBanksParams = {}) =>
  useQuery({
    queryKey: [...BANKS_QUERY_KEY, params],
    queryFn: () => getBanks(params),
  });
