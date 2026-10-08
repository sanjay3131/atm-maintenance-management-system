import api from "@/lib/axios";
import type { Item, ItemData } from "../types/item.types";

export interface GetItemsParams {
  isActive?: boolean;
}

export const getItems = async (
  params: GetItemsParams = {},
): Promise<Item[]> => {
  const response = await api.get<{ data: Item[] }>("/items/", { params });
  return response.data.data;
};

export const createItem = async (data: ItemData): Promise<Item> => {
  const response = await api.post<{ data: Item }>("/items/", data);
  return response.data.data;
};

export const updateItem = async (
  id: string,
  data: ItemData,
): Promise<Item> => {
  const response = await api.put<{ data: Item }>(`/items/${id}`, data);
  return response.data.data;
};
