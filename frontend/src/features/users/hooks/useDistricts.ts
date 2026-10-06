import { useQuery } from "@tanstack/react-query";
import { getDistricts } from "../services/district.service";

export const DISTRICTS_QUERY_KEY = ["districts"];

export const useDistricts = () => {
  return useQuery({
    queryKey: DISTRICTS_QUERY_KEY,
    queryFn: getDistricts,
    staleTime: 1000 * 60 * 10,
  });
};
