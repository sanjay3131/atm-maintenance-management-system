import { useQuery } from "@tanstack/react-query";
import { getComplaintById } from "../services/complaint.service";

export const COMPLAINT_QUERY_KEY = ["complaint"];

export const useComplaint = (id: string) =>
  useQuery({
    queryKey: [...COMPLAINT_QUERY_KEY, id],
    queryFn: () => getComplaintById(id),
    enabled: /^[0-9a-fA-F]{24}$/.test(id),
  });
