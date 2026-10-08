import { useQuery } from "@tanstack/react-query";
import { getItems } from "../services/item.service";
import type { GetItemsParams } from "../services/item.service";

export const ITEMS_QUERY_KEY = ["items"];

export const useItems = (params: GetItemsParams = {}) =>
  useQuery({
    queryKey: [...ITEMS_QUERY_KEY, "admin-list", params],
    queryFn: () => getItems(params),
  });
