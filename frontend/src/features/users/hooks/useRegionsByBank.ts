import { useQuery } from "@tanstack/react-query";
import { getAllRegions, getRegionsByBank } from "../services/region.service";

export const useRegionsByBank = (bankId: string, includeInactive = false) =>
  useQuery({
    queryKey: ["regions", "bank", bankId, includeInactive],
    queryFn: () => getRegionsByBank(bankId, includeInactive),
    enabled: Boolean(bankId),
    staleTime: 1000 * 60 * 10,
  });

export const useAllRegions = (includeInactive = false) =>
  useQuery({
    queryKey: ["regions", "all", includeInactive],
    queryFn: () => getAllRegions(includeInactive),
    staleTime: 1000 * 60 * 10,
  });
