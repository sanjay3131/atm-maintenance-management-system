import { useQuery } from "@tanstack/react-query";
import { getRegionsByBank } from "../services/region.service";

export const useRegionsByBank = (bankId: string, includeInactive = false) =>
  useQuery({
    queryKey: ["regions", "bank", bankId, includeInactive],
    queryFn: () => getRegionsByBank(bankId, includeInactive),
    enabled: Boolean(bankId),
    staleTime: 1000 * 60 * 10,
  });
