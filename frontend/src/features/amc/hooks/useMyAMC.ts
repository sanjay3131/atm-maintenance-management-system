import { useQuery } from "@tanstack/react-query";
import { getMyAMC } from "@/services/amc.service";

export const useMyAMC = (month: number, year: number) => {
  return useQuery({
    queryKey: ["my-amc", month, year],
    queryFn: () => getMyAMC({ month, year }),
  });
};
