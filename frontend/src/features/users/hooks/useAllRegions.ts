import { useQuery } from "@tanstack/react-query";
import { getAllRegions } from "../services/region.service";

export const useAllRegions = (includeInactive = false) =>
  useQuery({
    queryKey: ["regions", "all", includeInactive],
    queryFn: () => getAllRegions(includeInactive),
    staleTime: 1000 * 60 * 10,
  });
