import { useMutation } from "@tanstack/react-query";
import {
  createATM,
  type CreateATMData,
  type CreatedATM,
} from "../services/create-atm.service";

export const useCreateATM = () => {
  return useMutation<CreatedATM, Error, CreateATMData>({
    mutationFn: createATM,
  });
};
