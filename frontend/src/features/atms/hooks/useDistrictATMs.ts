import { useQuery } from "@tanstack/react-query";
import { getDistrictATMs } from "../services/atm.service";

export const useDistrictATMs = (
  districtId: string,
  page: number,
  limit: number,
) =>
  useQuery({
    queryKey: ["district-atms", districtId, page, limit],
    queryFn: () => getDistrictATMs(districtId, page, limit),
    enabled: Boolean(districtId),
  });
