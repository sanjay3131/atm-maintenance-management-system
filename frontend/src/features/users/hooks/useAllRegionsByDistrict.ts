import { useQuery } from "@tanstack/react-query";
import { getAllRegionsByDistrict } from "../services/region.service";

export const useAllRegionsByDistrict = (districtId: string) =>
  useQuery({
    queryKey: ["regions", districtId, "all"],
    queryFn: () => getAllRegionsByDistrict(districtId),
    enabled: Boolean(districtId),
    staleTime: 1000 * 60 * 10,
  });
