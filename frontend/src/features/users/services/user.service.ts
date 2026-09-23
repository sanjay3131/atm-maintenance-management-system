import api from "@/lib/axios";

export interface CreateUserPayload {
  firstName: string;
  lastName?: string;
  email: string;
  password: string;
  phoneNumber: string;
}

export interface CreatedUser {
  _id: string;
  firstName: string;
  lastName?: string;
  email: string;
  phoneNumber: string;
  userType: string;
  status: string;
}

export const createUser = async (
  payload: CreateUserPayload,
): Promise<CreatedUser> => {
  const response = await api.post("/auth/register", payload);

  return response.data.data.user;
};

export const assignUserRole = async (userId: string, role: string) => {
  const response = await api.put(`/users/${userId}/assign-role`, {
    role,
  });

  return response.data.data.user;
};
