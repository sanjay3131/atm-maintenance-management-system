import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createBank,
  deactivateBank,
  updateBank,
} from "../services/bank.service";
import { BANKS_QUERY_KEY } from "./useBanks";
import type { CreateBankData, UpdateBankData } from "../types/bank.types";

export const useCreateBank = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBankData) => createBank(data),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: BANKS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["bank"] }),
      ]);
    },
  });
};

export const useUpdateBank = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBankData }) =>
      updateBank(id, data),
    onSuccess: async (bank) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: BANKS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["bank", bank._id] }),
        queryClient.invalidateQueries({ queryKey: ["regions"] }),
        queryClient.invalidateQueries({ queryKey: ["districts"] }),
        queryClient.invalidateQueries({ queryKey: ["atms", "scoped"] }),
        queryClient.invalidateQueries({ queryKey: ["atms"] }),
        queryClient.invalidateQueries({ queryKey: ["district-geographic-summaries"] }),
      ]);
    },
  });
};

export const useDeactivateBank = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deactivateBank,
    onSuccess: async (bank) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: BANKS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["bank", bank._id] }),
        queryClient.invalidateQueries({ queryKey: ["regions"] }),
        queryClient.invalidateQueries({ queryKey: ["districts"] }),
        queryClient.invalidateQueries({ queryKey: ["atms", "scoped"] }),
        queryClient.invalidateQueries({ queryKey: ["atms"] }),
        queryClient.invalidateQueries({ queryKey: ["district-geographic-summaries"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
};
