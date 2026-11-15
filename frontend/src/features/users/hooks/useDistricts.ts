import { useQuery } from "@tanstack/react-query";
import { getDistricts } from "../services/district.service";

export const DISTRICTS_QUERY_KEY = ["districts"];

export const useDistricts = (enabled = true, regionId?: string) => {
  return useQuery({
    queryKey: [...DISTRICTS_QUERY_KEY, regionId ?? "all"],
    queryFn: () => getDistricts(regionId),
    enabled,
    staleTime: 1000 * 60 * 10,
  });
};
