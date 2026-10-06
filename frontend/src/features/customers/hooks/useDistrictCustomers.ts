import { useQuery } from "@tanstack/react-query";
import { getDistrictCustomers } from "../services/customer.service";

export const useDistrictCustomers = (
  districtId: string,
  page: number,
  limit: number,
) =>
  useQuery({
    queryKey: ["district-customers", districtId, page, limit],
    queryFn: () => getDistrictCustomers(districtId, page, limit),
    enabled: Boolean(districtId),
  });
