import { useQuery } from "@tanstack/react-query";
import { getDistricts } from "../services/district.service";

export const useDistricts = () => {
  return useQuery({
    queryKey: ["districts"],
    queryFn: getDistricts,
    staleTime: 1000 * 60 * 10,
  });
};
