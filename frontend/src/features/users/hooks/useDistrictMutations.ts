import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDistrict,
  getDistrictTransfers,
  transferDistrict,
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
        queryClient.invalidateQueries({ queryKey: ["district"] }),
        queryClient.invalidateQueries({ queryKey: ["regions"] }),
        queryClient.invalidateQueries({ queryKey: ["region"] }),
        queryClient.invalidateQueries({ queryKey: ["bank"] }),
        queryClient.invalidateQueries({
          queryKey: DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY,
        }),
        queryClient.invalidateQueries({ queryKey: ["atms"] }),
        queryClient.invalidateQueries({ queryKey: ["atms", "scoped"] }),
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
        queryClient.invalidateQueries({ queryKey: ["district"] }),
        queryClient.invalidateQueries({ queryKey: ["regions"] }),
        queryClient.invalidateQueries({ queryKey: ["region"] }),
        queryClient.invalidateQueries({ queryKey: ["bank"] }),
        queryClient.invalidateQueries({ queryKey: ["atms"] }),
        queryClient.invalidateQueries({ queryKey: ["atms", "scoped"] }),
        queryClient.invalidateQueries({
          queryKey: DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY,
        }),
      ]);
    },
  });
};

export const useTransferDistrict = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      districtId,
      regionId,
      reason,
    }: {
      districtId: string;
      regionId: string;
      reason: string;
    }) => transferDistrict(districtId, { regionId, reason }),
    onSuccess: async (_result, { districtId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DISTRICTS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["district", districtId] }),
        queryClient.invalidateQueries({ queryKey: ["district-transfers", districtId] }),
        queryClient.invalidateQueries({ queryKey: ["atms"] }),
        queryClient.invalidateQueries({ queryKey: ["atms", "scoped"] }),
        queryClient.invalidateQueries({ queryKey: ["regions"] }),
        queryClient.invalidateQueries({ queryKey: ["region"] }),
        queryClient.invalidateQueries({ queryKey: ["bank"] }),
        queryClient.invalidateQueries({
          queryKey: DISTRICT_GEOGRAPHIC_SUMMARIES_QUERY_KEY,
        }),
        queryClient.invalidateQueries({ queryKey: ["district-atms"] }),
        queryClient.invalidateQueries({ queryKey: ["region-atms"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
};

export const useDistrictTransfers = (districtId: string) => {
  return useQuery({
    queryKey: ["district-transfers", districtId],
    queryFn: () => getDistrictTransfers(districtId),
    enabled: Boolean(districtId),
  });
};
