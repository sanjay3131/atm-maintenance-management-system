import { useQuery } from "@tanstack/react-query";
import { getRegionById } from "../services/region.service";

export const useRegion = (regionId: string) =>
  useQuery({
    queryKey: ["region", regionId],
    queryFn: () => getRegionById(regionId),
    enabled: Boolean(regionId),
  });
