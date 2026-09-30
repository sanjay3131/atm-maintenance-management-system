import { useQuery } from "@tanstack/react-query";
import { getATMById } from "../services/atm.service";

export const useATM = (atmId: string) => {
  return useQuery({
    queryKey: ["atm", atmId],
    queryFn: () => getATMById(atmId),
    enabled: Boolean(atmId),
    staleTime: 1000 * 60 * 10,
  });
};
