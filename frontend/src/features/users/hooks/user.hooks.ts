import { useMutation } from "@tanstack/react-query";
import {
  createUserWizard,
  type CreateUserWizardResponse,
} from "../services/user.service";
import type { CreateUserFormData } from "../types/user.types";

export const useCreateUserWizard = () => {
  return useMutation<CreateUserWizardResponse, Error, CreateUserFormData>({
    mutationFn: createUserWizard,
  });
};
