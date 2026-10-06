import { useQuery } from "@tanstack/react-query";
import { getRegionCustomers } from "../services/customer.service";

export const useRegionCustomers = (
  regionId: string,
  page: number,
  limit: number,
) =>
  useQuery({
    queryKey: ["region-customers", regionId, page, limit],
    queryFn: () => getRegionCustomers(regionId, page, limit),
    enabled: Boolean(regionId),
  });
