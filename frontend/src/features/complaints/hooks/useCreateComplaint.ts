import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createComplaint } from "../services/complaint.service";
import type {
  Complaint,
  CreateComplaintData,
} from "../types/complaint.types";
import { ADMIN_COMPLAINTS_QUERY_KEY } from "./useAdminComplaints";

export const useCreateComplaint = () => {
  const queryClient = useQueryClient();

  return useMutation<Complaint, Error, CreateComplaintData>({
    mutationFn: createComplaint,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ADMIN_COMPLAINTS_QUERY_KEY,
      });
    },
  });
};
