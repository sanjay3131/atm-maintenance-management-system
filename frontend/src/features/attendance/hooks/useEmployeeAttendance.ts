import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkInToAttendance,
  checkOutOfAttendance,
  getMyAttendance,
  type AttendanceQuery,
} from "@/services/attendance.service";

const ATTENDANCE_QUERY_KEY = ["employee-attendance", "me"];

export const useMyAttendance = (params: AttendanceQuery) =>
  useQuery({
    queryKey: [...ATTENDANCE_QUERY_KEY, params],
    queryFn: () => getMyAttendance(params),
  });

export const useRecentMyAttendance = () =>
  useQuery({
    queryKey: [...ATTENDANCE_QUERY_KEY, "recent"],
    queryFn: () => getMyAttendance({ page: 1, limit: 100 }),
  });

export const useCheckIn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: checkInToAttendance,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_QUERY_KEY }),
  });
};

export const useCheckOut = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: checkOutOfAttendance,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ATTENDANCE_QUERY_KEY }),
  });
};
