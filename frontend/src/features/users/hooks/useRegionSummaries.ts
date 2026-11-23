import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getRegionSummaries,
  type RegionSummaryParams,
} from "../services/region.service";

export const REGION_SUMMARIES_QUERY_KEY = ["regions", "summary"] as const;

export const useRegionSummaries = (
  params: RegionSummaryParams,
  enabled = true,
) =>
  useQuery({
    queryKey: [...REGION_SUMMARIES_QUERY_KEY, params],
    queryFn: () => getRegionSummaries(params),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60,
  });
