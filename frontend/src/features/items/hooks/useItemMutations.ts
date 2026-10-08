import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createItem, updateItem } from "../services/item.service";
import { ITEMS_QUERY_KEY } from "./useItems";
import type { ItemData } from "../types/item.types";

export const useCreateItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
    },
  });
};

export const useUpdateItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ItemData }) =>
      updateItem(id, data),
    onSuccess: async (item) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: ["admin-job-material-usage"],
        }),
      ]);
      return item;
    },
  });
};
