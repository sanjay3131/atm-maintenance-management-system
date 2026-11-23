import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createRegion,
  updateRegion,
  type CreateRegionData,
  type UpdateRegionData,
} from "../services/region.service";
import { DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY } from "./useDistrictGeographicSummaries";
import { REGION_SUMMARIES_QUERY_KEY } from "./useRegionSummaries";

export const useCreateRegion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRegionData) => createRegion(data),
    onSuccess: async (_region, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["regions", "bank", variables.bankId],
        }),
        queryClient.invalidateQueries({ queryKey: REGION_SUMMARIES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["bank"] }),
        queryClient.invalidateQueries({
          queryKey: DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY,
        }),
      ]);
    },
  });
};

export const useUpdateRegion = (bankId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      regionId,
      data,
    }: {
      regionId: string;
      data: UpdateRegionData;
    }) => updateRegion(regionId, data),
    onSuccess: async (_region, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["region", variables.regionId],
        }),
        queryClient.invalidateQueries({ queryKey: ["regions", "bank", bankId] }),
        queryClient.invalidateQueries({ queryKey: REGION_SUMMARIES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["bank"] }),
        queryClient.invalidateQueries({
          queryKey: DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY,
        }),
      ]);
    },
  });
};
