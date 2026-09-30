import { useMutation } from "@tanstack/react-query";
import { updateATM } from "../services/atm.service";
import type { UpdateATMData } from "../types/atm.types";

interface UpdateATMVariables {
  atmId: string;
  data: UpdateATMData;
}

export const useUpdateATM = () => {
  return useMutation<void, Error, UpdateATMVariables>({
    mutationFn: ({ atmId, data }) => updateATM(atmId, data),
  });
};
