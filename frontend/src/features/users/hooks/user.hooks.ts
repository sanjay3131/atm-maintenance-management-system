import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createCustomerWizard,
  createUserWizard,
  getSupervisors,
  type CreateUserWizardResponse,
} from "../services/user.service";
import type {
  CreateUserFormData,
  CustomerDetailsForm,
  UserDetailsForm,
} from "../types/user.types";

export const useSupervisors = () =>
  useQuery({
    queryKey: ["users", "supervisors"],
    queryFn: getSupervisors,
    staleTime: 5 * 60 * 1000,
  });

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
