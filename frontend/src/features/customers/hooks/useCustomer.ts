import { useQueries, useQuery } from "@tanstack/react-query";
import { getJobs } from "@/features/jobs/services/jobs.service";
import type { JobStatus } from "@/features/jobs/types/job.types";
import {
  getCustomerById,
  getCustomerComplaints,
} from "../services/customer.service";

export const CUSTOMER_DETAIL_QUERY_KEY = ["customer"];

export const useCustomer = (id: string) =>
  useQuery({
    queryKey: [...CUSTOMER_DETAIL_QUERY_KEY, id],
    queryFn: () => getCustomerById(id),
    enabled: Boolean(id),
  });

export const useCustomerJobs = (
  customerId: string,
  page: number,
  limit: number,
) =>
  useQuery({
    queryKey: ["jobs", { customerId, page, limit }],
    queryFn: () => getJobs({ customerId, page, limit }),
    enabled: Boolean(customerId),
  });

export const useCustomerComplaints = (
  customerId: string,
  page: number,
  limit: number,
  status?: string,
) =>
  useQuery({
    queryKey: ["customer-complaints", customerId, page, limit, status],
    queryFn: () =>
      getCustomerComplaints(customerId, { page, limit, ...(status ? { status } : {}) }),
    enabled: Boolean(customerId),
  });

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  "PENDING",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "ON_HOLD",
];

export const useCustomerActiveJobCount = (customerId: string) => {
  const counts = useQueries({
    queries: ACTIVE_JOB_STATUSES.map((status) => ({
      queryKey: ["customer-active-job-count", customerId, status],
      queryFn: () =>
        getJobs({ customerId, status, page: 1, limit: 1 }),
      enabled: Boolean(customerId),
      staleTime: 60_000,
    })),
  });

  return {
    count:
      counts.every((query) => query.data !== undefined) &&
      !counts.some((query) => query.isError)
        ? counts.reduce(
            (total, query) => total + (query.data?.pagination.total ?? 0),
            0,
          )
        : undefined,
    isLoading: counts.some((query) => query.isLoading),
    isError: counts.some((query) => query.isError),
  };
};
