import api from "@/lib/axios";

export type AMCStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";

export interface MyAMCResponse {
  amcs: unknown[];
  month: number;
  year: number;
  statusCounts: Partial<Record<AMCStatus, number>>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface MyAMCQuery {
  month: number;
  year: number;
}

export const getMyAMC = async ({
  month,
  year,
}: MyAMCQuery): Promise<MyAMCResponse> => {
  const response = await api.get<{ data: MyAMCResponse }>("/amc/my-amc", {
    params: { month, year, page: 1, limit: 1 },
  });

  return response.data.data;
};