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

export const createUserWizard = async (
  payload: CreateUserFormData,
): Promise<CreateUserWizardResponse> => {
  const response = await api.post("/users/wizard", payload);

  return response.data.data;
};
