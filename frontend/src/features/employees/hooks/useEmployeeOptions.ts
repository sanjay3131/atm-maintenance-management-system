import { useQuery } from "@tanstack/react-query";
import { getEmployeeOptions } from "@/services/employee.service";

export const useEmployeeOptions = (
  search: string,
  page: number,
  enabled = true,
) =>
  useQuery({
    queryKey: ["employee-options", search, page],
    queryFn: ({ signal }) => getEmployeeOptions(search, page, signal),
    enabled,
    staleTime: 30_000,
  });
