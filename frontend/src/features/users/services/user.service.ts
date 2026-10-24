import api from "@/lib/axios";
import type { CreateUserFormData } from "../types/user.types";

export interface CreatedUser {
  _id: string;
  firstName: string;
  lastName?: string;
  email: string;
  phoneNumber: string;
  userType: string;
  status: string;
}

export interface CreateUserWizardResponse {
  user: CreatedUser;
  role: "employee" | "supervisor" | "customer";
}

export interface SupervisorOption {
  _id: string;
  firstName: string;
  lastName?: string;
  email: string;
  status: string;
}

export interface SupervisorManagementRecord extends SupervisorOption {
  phoneNumber: string;
  createdAt: string;
  teamCount: number;
}

export interface SupervisorManagementResponse {
  supervisors: SupervisorManagementRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SupervisorAccountPayload {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password?: string;
}

export interface SupervisorManagementQuery {
  search?: string;
  page: number;
  limit: number;
}

export const getSupervisors = async (): Promise<SupervisorOption[]> => {
  const response = await api.get<{ data: { supervisors: SupervisorOption[] } }>(
    "/users/supervisors",
  );
  return response.data.data.supervisors;
};

export const getSupervisorManagementList = async (
  params: SupervisorManagementQuery,
): Promise<SupervisorManagementResponse> => {
  const response = await api.get<{ data: SupervisorManagementResponse }>(
    "/users/supervisor-management",
    { params },
  );
  return response.data.data;
};

export const getSupervisorManagementDetails = async (
  id: string,
): Promise<SupervisorManagementRecord> => {
  const response = await api.get<{
    data: { supervisor: SupervisorManagementRecord };
  }>(`/users/supervisor-management/${id}`);
  return response.data.data.supervisor;
};

export const createSupervisor = async (
  payload: SupervisorAccountPayload & { password: string },
): Promise<void> => {
  await api.post("/users/supervisor-management", payload);
};

export const updateSupervisor = async ({
  id,
  ...payload
}: {
  id: string;
} & Omit<SupervisorAccountPayload, "password">): Promise<void> => {
  await api.put(`/users/supervisor-management/${id}`, payload);
};

export const updateSupervisorStatus = async ({
  id,
  status,
}: {
  id: string;
  status: "active" | "inactive";
}): Promise<void> => {
  await api.patch(`/users/supervisor-management/${id}/status`, { status });
};

export const createUserWizard = async (
  payload: CreateUserFormData,
): Promise<CreateUserWizardResponse> => {
  const response = await api.post("/users/wizard", payload);

  return response.data.data;
};

export const createCustomerWizard = async (
  payload: Pick<CreateUserFormData, "user" | "customer">,
): Promise<CreateUserWizardResponse> => {
  const response = await api.post("/users/wizard/customer", payload);

  return response.data.data;
};
