import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAdminAttendanceDashboard,
  getAttendanceReport,
  getAttendanceStatusOverrideAudit,
  setAttendanceStatusOverride,
  type AdminAttendanceDashboardQuery,
  type AttendanceReportQuery,
} from "@/services/attendance.service";
import { validateAttendanceReportDateRange } from "@/features/attendance/attendanceReport.utils";

const ADMIN_ATTENDANCE_QUERY_KEY = ["admin-attendance"];
const ADMIN_ATTENDANCE_REPORT_QUERY_KEY = ["admin-attendance-report"] as const;

export type AttendanceReportQueryInput = Partial<AttendanceReportQuery>;

export const getAttendanceReportQueryKey = (
  params: AttendanceReportQueryInput,
) =>
  [
    ...ADMIN_ATTENDANCE_REPORT_QUERY_KEY,
    params.fromDate ?? null,
    params.toDate ?? null,
    params.page ?? 1,
    params.limit ?? 25,
    params.employeeId ?? null,
    params.asOf ?? null,
  ] as const;

export const useAdminAttendanceDashboard = (
  params: AdminAttendanceDashboardQuery,
) =>
  useQuery({
    queryKey: [...ADMIN_ATTENDANCE_QUERY_KEY, "dashboard", params],
    queryFn: () => getAdminAttendanceDashboard(params),
  });

export const useAttendanceReport = (params: AttendanceReportQueryInput) => {
  const validDateRange =
    typeof params.fromDate === "string" &&
    typeof params.toDate === "string" &&
    validateAttendanceReportDateRange(params.fromDate, params.toDate).valid;

  return useQuery({
    queryKey: getAttendanceReportQueryKey(params),
    queryFn: () => {
      if (!validDateRange || !params.fromDate || !params.toDate) {
        throw new RangeError("A valid attendance report date range is required");
      }

      const request: AttendanceReportQuery = {
        fromDate: params.fromDate,
        toDate: params.toDate,
        ...(params.page !== undefined ? { page: params.page } : {}),
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.employeeId !== undefined
          ? { employeeId: params.employeeId }
          : {}),
        ...(params.asOf !== undefined ? { asOf: params.asOf } : {}),
      };
      return getAttendanceReport(request);
    },
    enabled: validDateRange,
  });
};

export const useAttendanceStatusOverrideAudit = (
  employeeId: string | null,
  attendanceDate: string,
  page: number,
  limit: number,
) =>
  useQuery({
    queryKey: [
      ...ADMIN_ATTENDANCE_QUERY_KEY,
      "audit",
      employeeId,
      attendanceDate,
      page,
      limit,
    ],
    queryFn: () =>
      getAttendanceStatusOverrideAudit({
        employeeId: employeeId!,
        attendanceDate,
        page,
        limit,
      }),
    enabled: Boolean(employeeId),
  });

export const useSetAttendanceStatusOverride = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setAttendanceStatusOverride,
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [...ADMIN_ATTENDANCE_QUERY_KEY, "dashboard"],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            ...ADMIN_ATTENDANCE_QUERY_KEY,
            "audit",
            variables.employeeId,
            variables.attendanceDate,
          ],
        }),
      ]);
    },
  });
};
