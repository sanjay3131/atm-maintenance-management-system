import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setATMLocation } from "../services/atm.service";
import type { SetATMLocationData } from "../types/atm.types";

interface SetATMLocationVariables {
  atmId: string;
  jobId: string;
  data: SetATMLocationData;
}

export const useSetATMLocation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ atmId, data }: SetATMLocationVariables) =>
      setATMLocation(atmId, data),
    onSuccess: async (_atm, { atmId, jobId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["atm", atmId] }),
        queryClient.invalidateQueries({ queryKey: ["atms"] }),
      ]);
    },
  });
};
