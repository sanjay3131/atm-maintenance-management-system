import { useQuery } from "@tanstack/react-query";
import { getDistrictGeographicSummaries } from "../services/district.service";

export const DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY = [
  "district-geographic-summaries",
];

export const useDistrictGeographicSummaries = () =>
  useQuery({
    queryKey: DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY,
    queryFn: getDistrictGeographicSummaries,
    staleTime: 1000 * 60,
  });
