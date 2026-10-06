import { useQuery } from "@tanstack/react-query";
import { getDistrictEmployees } from "@/services/employee.service";

export const useDistrictEmployees = (
  districtId: string,
  page: number,
  limit: number,
) =>
  useQuery({
    queryKey: ["district-employees", districtId, page, limit],
    queryFn: () => getDistrictEmployees(districtId, page, limit),
    enabled: Boolean(districtId),
  });
