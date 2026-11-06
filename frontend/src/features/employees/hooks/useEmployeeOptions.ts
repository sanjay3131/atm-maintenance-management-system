import { useQuery } from "@tanstack/react-query";
import { getEmployeeOptions } from "@/services/employee.service";

export const useEmployeeOptions = (
  search: string,
  page: number,
  enabled = true,
  activeOnly = false,
) =>
  useQuery({
    queryKey: ["employee-options", search, page, activeOnly],
    queryFn: ({ signal }) => getEmployeeOptions(search, page, signal, activeOnly),
    enabled,
    staleTime: 30_000,
  });
