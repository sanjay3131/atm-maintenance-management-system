import { useQuery } from "@tanstack/react-query";
import {
  getSupervisorAMC,
  getSupervisorAMCPhotos,
} from "@/services/supervisor.service";

export const useSupervisorAMCDetails = (amcId: string, enabled = true) =>
  useQuery({
    queryKey: ["supervisor-amc", amcId],
    queryFn: () => getSupervisorAMC(amcId),
    enabled: enabled && Boolean(amcId),
    staleTime: 0,
    refetchOnMount: "always",
  });

export const useSupervisorAMCPhotos = (amcId: string, enabled = true) =>
  useQuery({
    queryKey: ["supervisor-amc-photos", amcId],
    queryFn: () => getSupervisorAMCPhotos(amcId),
    enabled: enabled && Boolean(amcId),
    staleTime: 0,
    refetchOnMount: "always",
  });
