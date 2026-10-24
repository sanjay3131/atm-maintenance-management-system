import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createSupervisor,
  createCustomerWizard,
  createUserWizard,
  getSupervisors,
  getSupervisorManagementDetails,
  getSupervisorManagementList,
  updateSupervisor,
  updateSupervisorStatus,
  type CreateUserWizardResponse,
  type SupervisorManagementQuery,
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

const SUPERVISOR_MANAGEMENT_QUERY_KEY = ["users", "supervisor-management"];

export const useSupervisorManagement = (params: SupervisorManagementQuery) =>
  useQuery({
    queryKey: [...SUPERVISOR_MANAGEMENT_QUERY_KEY, params],
    queryFn: () => getSupervisorManagementList(params),
  });

export const useSupervisorManagementDetails = (id: string | null) =>
  useQuery({
    queryKey: [...SUPERVISOR_MANAGEMENT_QUERY_KEY, "detail", id],
    queryFn: () => getSupervisorManagementDetails(id!),
    enabled: Boolean(id),
  });

export const useCreateSupervisor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createSupervisor,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: SUPERVISOR_MANAGEMENT_QUERY_KEY,
      }),
  });
};

export const useUpdateSupervisor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSupervisor,
    onSuccess: async (_result, { id }) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: SUPERVISOR_MANAGEMENT_QUERY_KEY,
        }),
        queryClient.invalidateQueries({
          queryKey: [...SUPERVISOR_MANAGEMENT_QUERY_KEY, "detail", id],
        }),
      ]);
    },
  });
};

export const useUpdateSupervisorStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSupervisorStatus,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: SUPERVISOR_MANAGEMENT_QUERY_KEY,
      }),
  });
};

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
