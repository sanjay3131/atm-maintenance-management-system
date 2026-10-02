import { useMutation } from "@tanstack/react-query";
import { assignEmployeeToATM } from "../services/atm.service";
import type { ATM } from "../types/atm.types";

interface AssignEmployeeVariables {
  atmId: string;
  employeeId: string;
}

export const useAssignEmployeeToATM = () => {
  return useMutation<ATM, Error, AssignEmployeeVariables>({
    mutationFn: ({ atmId, employeeId }) =>
      assignEmployeeToATM(atmId, employeeId),
  });
};
