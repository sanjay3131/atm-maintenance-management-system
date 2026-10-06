import { useQuery } from "@tanstack/react-query";
import { getDistrictById } from "../services/district.service";

export const useDistrict = (districtId: string) =>
  useQuery({
    queryKey: ["district", districtId],
    queryFn: () => getDistrictById(districtId),
    enabled: Boolean(districtId),
  });
