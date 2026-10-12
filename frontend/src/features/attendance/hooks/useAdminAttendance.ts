import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAdminAttendanceDashboard,
  getAttendanceStatusOverrideAudit,
  setAttendanceStatusOverride,
  type AdminAttendanceDashboardQuery,
} from "@/services/attendance.service";

const ADMIN_ATTENDANCE_QUERY_KEY = ["admin-attendance"];

export const useAdminAttendanceDashboard = (
  params: AdminAttendanceDashboardQuery,
) =>
  useQuery({
    queryKey: [...ADMIN_ATTENDANCE_QUERY_KEY, "dashboard", params],
    queryFn: () => getAdminAttendanceDashboard(params),
  });

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
