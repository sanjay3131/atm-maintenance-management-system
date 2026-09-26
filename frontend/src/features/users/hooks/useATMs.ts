import { useQuery } from "@tanstack/react-query";
import { getATMs } from "../services/atm.service";

export const useATMs = () => {
  return useQuery({
    queryKey: ["atms"],
    queryFn: getATMs,
    staleTime: 1000 * 60 * 10,
  });
};
