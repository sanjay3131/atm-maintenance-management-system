import { useQuery } from "@tanstack/react-query";
import { getRegionEmployees } from "@/services/employee.service";

export const useRegionEmployees = (
  regionId: string,
  page: number,
  limit: number,
) =>
  useQuery({
    queryKey: ["region-employees", regionId, page, limit],
    queryFn: () => getRegionEmployees(regionId, page, limit),
    enabled: Boolean(regionId),
  });
