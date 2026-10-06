import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createDistrict,
  updateDistrict,
} from "../services/district.service";
import { DISTRICTS_QUERY_KEY } from "./useDistricts";
import { DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY } from "./useDistrictGeographicSummaries";
import type {
  CreateDistrictData,
  UpdateDistrictData,
} from "../types/district.types";

export const useCreateDistrict = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateDistrictData) => createDistrict(data),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DISTRICTS_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY,
        }),
      ]);
    },
  });
};

export const useUpdateDistrict = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateDistrictData;
    }) => updateDistrict(id, data),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DISTRICTS_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY,
        }),
      ]);
    },
  });
};
