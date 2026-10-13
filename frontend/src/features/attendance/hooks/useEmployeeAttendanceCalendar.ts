import { useQuery } from "@tanstack/react-query";
import { getEmployeeAttendanceCalendar } from "@/services/attendance.service";

export const useEmployeeAttendanceCalendar = (
  employeeId: string,
  month: string,
) =>
  useQuery({
    queryKey: ["admin-attendance", "employee-calendar", employeeId, month],
    queryFn: () => getEmployeeAttendanceCalendar(employeeId, month),
    enabled: /^[a-fA-F0-9]{24}$/.test(employeeId) && /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
  });
