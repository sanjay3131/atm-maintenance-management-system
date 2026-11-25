import { useQuery } from "@tanstack/react-query";
import {
  getScopedATMs,
  type GetScopedATMsParams,
} from "../services/atm.service";

export const useScopedATMs = (
  params: GetScopedATMsParams,
  enabled = true,
) =>
  useQuery({
    queryKey: ["atms", "scoped", params],
    queryFn: ({ signal }) => getScopedATMs(params, signal),
    staleTime: 30_000,
    enabled,
  });
