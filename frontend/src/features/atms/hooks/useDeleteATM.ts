import { useMutation } from "@tanstack/react-query";
import { deleteATM } from "../services/atm.service";

export const useDeleteATM = () => {
  return useMutation<void, Error, string>({
    mutationFn: deleteATM,
  });
};
