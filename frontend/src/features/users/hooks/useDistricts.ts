import { useQuery } from "@tanstack/react-query";
import { getDistricts } from "../services/district.service";

export const DISTRICTS_QUERY_KEY = ["districts"];

export const useDistricts = (
  enabled = true,
  regionId?: string | string[],
) => {
  const regionIds = Array.isArray(regionId)
    ? [...new Set(regionId.filter(Boolean))].sort()
    : undefined;

  return useQuery({
    queryKey: [...DISTRICTS_QUERY_KEY, regionIds ?? regionId ?? "all"],
    queryFn: async () => {
      if (!Array.isArray(regionId)) return getDistricts(regionId);

      const districtsById = new Map(
        (
          await Promise.all((regionIds ?? []).map((id) => getDistricts(id)))
        )
          .flat()
          .map((district) => [district._id, district]),
      );

      return [...districtsById.values()].sort((left, right) =>
        left.districtName.localeCompare(right.districtName),
      );
    },
    enabled: enabled && (!regionIds || regionIds.length > 0),
    staleTime: 1000 * 60 * 10,
  });
};
