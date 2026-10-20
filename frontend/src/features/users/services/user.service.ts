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

export const getSupervisors = async (): Promise<SupervisorOption[]> => {
  const response = await api.get<{ data: { supervisors: SupervisorOption[] } }>(
    "/users/supervisors",
  );
  return response.data.data.supervisors;
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
