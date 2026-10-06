import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createRegion,
  updateRegion,
  type CreateRegionData,
  type UpdateRegionData,
} from "../services/region.service";
import { DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY } from "./useDistrictGeographicSummaries";

export const useCreateRegion = (districtId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRegionData) => createRegion(data),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["regions", districtId] }),
        queryClient.invalidateQueries({ queryKey: ["district", districtId] }),
        queryClient.invalidateQueries({
          queryKey: DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY,
        }),
      ]);
    },
  });
};

export const useUpdateRegion = (districtId: string) => {
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
        queryClient.invalidateQueries({ queryKey: ["regions", districtId] }),
        queryClient.invalidateQueries({ queryKey: ["district", districtId] }),
        queryClient.invalidateQueries({
          queryKey: DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY,
        }),
      ]);
    },
  });
};
