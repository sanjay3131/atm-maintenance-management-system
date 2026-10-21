import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAdminAMC,
  generateAdminAMCs,
  getAdminAMCPhotos,
  getAdminAMCs,
  type AdminAMCQuery,
} from "@/services/amc.service";

export const useAdminAMCDetails = (amcId: string, enabled = true) =>
  useQuery({
    queryKey: ["admin-amc", amcId],
    queryFn: () => getAdminAMC(amcId),
    enabled: enabled && Boolean(amcId),
  });

export const useAdminAMCPhotos = (amcId: string, enabled = true) =>
  useQuery({
    queryKey: ["admin-amc-photos", amcId],
    queryFn: () => getAdminAMCPhotos(amcId),
    enabled: enabled && Boolean(amcId),
  });

export const useAdminAMCs = (query: AdminAMCQuery) =>
  useQuery({
    queryKey: ["admin-amcs", query],
    queryFn: () => getAdminAMCs(query),
  });

export const useGenerateAdminAMCs = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generateAdminAMCs,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-amcs"] }),
        queryClient.invalidateQueries({ queryKey: ["amc-dashboard"] }),
      ]);
    },
  });
};
