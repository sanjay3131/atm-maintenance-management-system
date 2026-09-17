import api from "@/lib/axios";

export interface LoginPayload {
  email: string;
  password: string;
}

export const loginAdmin = async (payload: LoginPayload) => {
  const response = await api.post("/auth/login", payload);

  return response.data.data;
};

export const refreshAccessToken = async () => {
  const response = await api.post("/auth/refresh");

  return response.data.data;
};

export const getCurrentUser = async () => {
  const response = await api.get("/auth/me");

  return response.data.data;
};

export const logout = async () => {
  const response = await api.post("/auth/logout");

  return response.data.data;
};
