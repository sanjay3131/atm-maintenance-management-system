import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAttendanceReport,
  type AttendanceReportResponse,
} from "@/services/attendance.service";
import {
  getAttendanceReportQueryKey,
  useAttendanceReport,
} from "@/features/attendance/hooks/useAdminAttendance";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("@/lib/axios", () => ({
  default: { get: mockGet },
}));

const reportResponse: AttendanceReportResponse = {
  timeZone: "Asia/Kolkata",
  asOf: "2024-01-03T10:00:00.000Z",
  period: {
    fromDate: "2024-01-01",
    toDate: "2024-01-03",
    calculatedThroughDate: "2024-01-03",
  },
  pagination: { page: 1, limit: 25, totalEmployees: 0, totalPages: 0 },
  employees: [],
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("attendance report API service and query", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("uses the report endpoint, defaults pagination, and unwraps the response", async () => {
    mockGet.mockResolvedValue({ data: { data: reportResponse } });

    await expect(
      getAttendanceReport({
        fromDate: "2024-01-01",
        toDate: "2024-01-03",
      }),
    ).resolves.toEqual(reportResponse);
    expect(mockGet).toHaveBeenCalledWith("/attendance/admin/reports", {
      params: {
        fromDate: "2024-01-01",
        toDate: "2024-01-03",
        page: 1,
        limit: 25,
      },
    });
  });

  it("passes the exact employee filter and reporting cutoff when supplied", async () => {
    mockGet.mockResolvedValue({ data: { data: reportResponse } });

    await getAttendanceReport({
      fromDate: "2024-01-01",
      toDate: "2024-01-03",
      page: 2,
      limit: 50,
      employeeId: "0123456789abcdef01234567",
      asOf: "2024-01-04T00:00:00+05:30",
    });

    expect(mockGet).toHaveBeenCalledWith("/attendance/admin/reports", {
      params: {
        fromDate: "2024-01-01",
        toDate: "2024-01-03",
        page: 2,
        limit: 50,
        employeeId: "0123456789abcdef01234567",
        asOf: "2024-01-04T00:00:00+05:30",
      },
    });
  });

  it("uses a separate key that distinguishes every report input", () => {
    const base = {
      fromDate: "2024-01-01",
      toDate: "2024-01-31",
      page: 1,
      limit: 25,
    };
    const baseKey = getAttendanceReportQueryKey(base);
    const variants = [
      { ...base, fromDate: "2024-02-01" },
      { ...base, toDate: "2024-02-29" },
      { ...base, page: 2 },
      { ...base, limit: 50 },
      { ...base, employeeId: "0123456789abcdef01234567" },
      { ...base, asOf: "2024-02-01T00:00:00Z" },
    ];

    for (const variant of variants) {
      expect(getAttendanceReportQueryKey(variant)).not.toEqual(baseKey);
    }
    expect(baseKey[0]).toBe("admin-attendance-report");
  });

  it("passes an explicit asOf through the query for a consistent later page", async () => {
    mockGet.mockResolvedValue({ data: { data: reportResponse } });
    const params = {
      fromDate: "2024-01-01",
      toDate: "2024-01-31",
      page: 2,
      limit: 25,
      asOf: reportResponse.asOf!,
    };

    const { result } = renderHook(() => useAttendanceReport(params), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith("/attendance/admin/reports", {
      params: {
        fromDate: params.fromDate,
        toDate: params.toDate,
        page: 2,
        limit: 25,
        asOf: params.asOf,
      },
    });
  });

  it("does not fetch when dates are absent or invalid", async () => {
    const { result: missingDates } = renderHook(
      () => useAttendanceReport({}),
      { wrapper: createWrapper() },
    );
    const { result: invalidDates } = renderHook(
      () =>
        useAttendanceReport({
          fromDate: "2024-02-30",
          toDate: "2024-03-01",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(missingDates.current.fetchStatus).toBe("idle");
      expect(invalidDates.current.fetchStatus).toBe("idle");
    });
    expect(mockGet).not.toHaveBeenCalled();
  });
});
