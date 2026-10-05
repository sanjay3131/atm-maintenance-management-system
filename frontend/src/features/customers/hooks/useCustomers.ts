import { useQuery } from "@tanstack/react-query";
import { getCustomers } from "../services/customer.service";

export const useCustomers = (enabled = true) => {
  return useQuery({
    queryKey: ["customers"],
    queryFn: getCustomers,
    enabled,
    staleTime: 1000 * 60,
  });
};
