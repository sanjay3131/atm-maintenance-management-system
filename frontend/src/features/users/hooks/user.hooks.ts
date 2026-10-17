import { useMutation } from "@tanstack/react-query";
import {
  createCustomerWizard,
  createUserWizard,
  type CreateUserWizardResponse,
} from "../services/user.service";
import type {
  CreateUserFormData,
  CustomerDetailsForm,
  UserDetailsForm,
} from "../types/user.types";

export const useCreateUserWizard = () => {
  return useMutation<CreateUserWizardResponse, Error, CreateUserFormData>({
    mutationFn: createUserWizard,
  });
};

export const useCreateCustomerWizard = () => {
  return useMutation<
    CreateUserWizardResponse,
    Error,
    { user: UserDetailsForm; customer: CustomerDetailsForm }
  >({
    mutationFn: createCustomerWizard,
  });
};
