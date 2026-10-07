import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getAdminComplaints } from "../services/complaint.service";
import type { ComplaintListParams } from "../types/complaint.types";

export const ADMIN_COMPLAINTS_QUERY_KEY = ["complaints", "admin-list"];

export const useAdminComplaints = (filters: ComplaintListParams) =>
  useQuery({
    queryKey: [...ADMIN_COMPLAINTS_QUERY_KEY, filters],
    queryFn: () => getAdminComplaints(filters),
    placeholderData: keepPreviousData,
  });
