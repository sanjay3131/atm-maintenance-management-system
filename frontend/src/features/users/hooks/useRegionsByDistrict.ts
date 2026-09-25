import { useQuery } from "@tanstack/react-query";
import { getRegionsByDistrict } from "../services/region.service";

export const useRegionsByDistrict = (districtId: string) => {
  return useQuery({
    queryKey: ["regions", districtId],
    queryFn: () => getRegionsByDistrict(districtId),
    enabled: Boolean(districtId),
    staleTime: 1000 * 60 * 10,
  });
};
