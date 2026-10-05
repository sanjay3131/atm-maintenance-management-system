import { useQuery } from "@tanstack/react-query";
import { getBankById } from "../services/bank.service";

export const useBank = (id: string) =>
  useQuery({
    queryKey: ["bank", id],
    queryFn: () => getBankById(id),
    enabled: Boolean(id),
  });
