import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setATMAMCResponsibleEmployee } from "../services/atm.service";
import type { ATM } from "../types/atm.types";

interface SetAMCResponsibleEmployeeVariables {
  atmId: string;
  employeeId: string | null;
}

export const useSetATMAMCResponsibleEmployee = () => {
  const queryClient = useQueryClient();

  return useMutation<ATM, Error, SetAMCResponsibleEmployeeVariables>({
    mutationFn: ({ atmId, employeeId }) =>
      setATMAMCResponsibleEmployee(atmId, employeeId),
    onSuccess: async (_atm, { atmId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["atm", atmId] }),
        queryClient.invalidateQueries({ queryKey: ["atms"] }),
      ]);
    },
  });
};
