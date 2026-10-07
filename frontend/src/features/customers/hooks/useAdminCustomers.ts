import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deactivateCustomer,
  getAdminCustomers,
  updateCustomer,
} from "../services/customer.service";
import type {
  CustomerListParams,
  CustomerUpdateData,
} from "../services/customer.service";
import { CUSTOMER_DETAIL_QUERY_KEY } from "./useCustomer";

export const ADMIN_CUSTOMERS_QUERY_KEY = ["customers", "admin-list"];

export const useAdminCustomers = (params: CustomerListParams) =>
  useQuery({
    queryKey: [...ADMIN_CUSTOMERS_QUERY_KEY, params],
    queryFn: () => getAdminCustomers(params),
  });

export const useUpdateCustomer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: CustomerUpdateData }) =>
      updateCustomer(id, data),
    onSuccess: async (_customer, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
        queryClient.invalidateQueries({
          queryKey: [...CUSTOMER_DETAIL_QUERY_KEY, variables.id],
        }),
      ]);
    },
  });
};

export const useDeactivateCustomer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deactivateCustomer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
};
