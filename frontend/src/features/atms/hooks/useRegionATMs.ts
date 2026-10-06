import { useQuery } from "@tanstack/react-query";
import { getRegionATMs } from "../services/atm.service";

export const useRegionATMs = (
  regionId: string,
  page: number,
  limit: number,
) =>
  useQuery({
    queryKey: ["region-atms", regionId, page, limit],
    queryFn: () => getRegionATMs(regionId, page, limit),
    enabled: Boolean(regionId),
  });
