import { useQuery } from "@tanstack/react-query";
import { getBankSummary } from "@/services/dashboard.service";

export const useBankSummary = () => {
  return useQuery({
    queryKey: ["dashboard-bank-summary"],
    queryFn: getBankSummary,
    staleTime: 1000 * 60,
  });
};
