import api from "@/lib/axios";

export interface AttendanceRecord {
  _id: string;
  employeeId: string;
  attendanceDate: string;
  checkInAt: string;
  checkOutAt: string | null;
  checkInSource: "employee" | "supervisor" | "admin" | "superAdmin";
  checkOutSource: "employee" | "supervisor" | "admin" | "superAdmin" | null;
  checkInRecordedBy: string;
  checkOutRecordedBy: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AttendancePagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AttendanceListResponse {
  records: AttendanceRecord[];
  pagination: AttendancePagination;
}

export interface AttendanceQuery {
  fromDate?: string;
  toDate?: string;
  page: number;
  limit: number;
}

export const getMyAttendance = async (
  params: AttendanceQuery,
): Promise<AttendanceListResponse> => {
  const response = await api.get<{ data: AttendanceListResponse }>(
    "/attendance/me",
    { params },
  );
  return response.data.data;
};

export const checkInToAttendance = async (): Promise<AttendanceRecord> => {
  const response = await api.post<{ data: AttendanceRecord }>(
    "/attendance/me/check-in",
  );
  return response.data.data;
};

export const checkOutOfAttendance = async (): Promise<AttendanceRecord> => {
  const response = await api.post<{ data: AttendanceRecord }>(
    "/attendance/me/check-out",
  );
  return response.data.data;
};