import { useMutation } from "@tanstack/react-query";
import {
  assignUserRole,
  createUser,
  type CreateUserPayload,
} from "../services/user.service";

export const useCreateUser = () => {
  return useMutation({
    mutationFn: (payload: CreateUserPayload) => createUser(payload),
  });
};

export const useAssignUserRole = () => {
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      assignUserRole(userId, role),
  });
};
