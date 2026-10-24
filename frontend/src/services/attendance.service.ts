import api from "@/lib/axios";

export interface AttendanceRecord {
  _id: string;
  employeeId: string | null;
  supervisorUserId?: string | null;
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

export type AttendanceCalendarStatus =
  | "present"
  | "incomplete"
  | "absent";

export interface AttendanceCalendarDay {
  attendanceDate: string;
  status: AttendanceCalendarStatus;
  statusOrigin: "recorded" | "admin_override";
  checkInAt: string | null;
  checkOutAt: string | null;
}

export interface AttendanceCalendarResponse {
  month: string;
  timeZone: "Asia/Kolkata";
  days: AttendanceCalendarDay[];
}

export interface AttendanceQuery {
  fromDate?: string;
  toDate?: string;
  openOnly?: boolean;
  page: number;
  limit: number;
}

export type AdminAttendanceStatus =
  | "present"
  | "absent"
  | "incomplete"
  | "unrecorded";

export interface AdminAttendanceDashboardQuery {
  date: string;
  search?: string;
  role: "all" | "employee" | "supervisor";
  status: "all" | AdminAttendanceStatus;
  page: number;
  limit: number;
}

export interface AdminAttendanceDashboardRecord {
  employee: {
    id: string;
    employeeCode: string | null;
    name: string;
    role: "employee" | "supervisor";
    avatarUrl: string | null;
    employeeStatus: string | null;
    userStatus: string | null;
  };
  attendance: {
    id: string | null;
    attendanceDate: string;
    actualCheckInAt: string | null;
    actualCheckOutAt: string | null;
    effectiveCheckInAt: string | null;
    effectiveCheckOutAt: string | null;
    effectiveStatus: AdminAttendanceStatus;
    statusOrigin: "recorded" | "admin_override" | "no_record";
  };
}

export interface AdminAttendanceDashboardResponse {
  date: string;
  timeZone: "Asia/Kolkata";
  summary: {
    employees: {
      total: number;
      present: number;
      absent: number;
      incomplete: number;
      unrecorded: number;
    };
    supervisors: {
      total: number;
      present: number;
      absent: number;
      incomplete: number;
      unrecorded: number;
    };
  };
  records: AdminAttendanceDashboardRecord[];
  pagination: AttendancePagination;
}

export interface AttendanceEffectiveValues {
  status: AdminAttendanceStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
}

export interface AttendanceStatusOverrideAuditEvent {
  _id: string;
  employeeId: string;
  attendanceDate: string;
  previousEffectiveValues: AttendanceEffectiveValues | null;
  newEffectiveValues: {
    status: "present" | "absent";
    checkInAt: string | null;
    checkOutAt: string | null;
  };
  actorId: string;
  changedAt: string;
  reason: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AttendanceStatusOverrideAuditResponse {
  events: AttendanceStatusOverrideAuditEvent[];
  pagination: AttendancePagination;
}

export interface SetAttendanceStatusOverridePayload {
  attendanceDate: string;
  status: "present" | "absent";
  reason: string;
}

export interface SetAttendanceStatusOverrideResponse {
  override: {
    _id: string;
    employeeId: string;
    attendanceDate: string;
    status: "present" | "absent";
    changedBy: string;
    changedAt: string;
  };
  audit: AttendanceStatusOverrideAuditEvent;
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

export const getAdminAttendanceDashboard = async (
  params: AdminAttendanceDashboardQuery,
): Promise<AdminAttendanceDashboardResponse> => {
  const response = await api.get<{ data: AdminAttendanceDashboardResponse }>(
    "/attendance/admin/dashboard",
    { params },
  );
  return response.data.data;
};

export const getEmployeeAttendanceCalendar = async (
  employeeId: string,
  month: string,
): Promise<AttendanceCalendarResponse> => {
  const response = await api.get<{ data: AttendanceCalendarResponse }>(
    `/attendance/admin/employees/${employeeId}/calendar`,
    { params: { month } },
  );
  return response.data.data;
};

export const setAttendanceStatusOverride = async ({
  employeeId,
  ...payload
}: {
  employeeId: string;
} & SetAttendanceStatusOverridePayload): Promise<SetAttendanceStatusOverrideResponse> => {
  const response = await api.post<{
    data: SetAttendanceStatusOverrideResponse;
  }>(`/attendance/admin/employees/${employeeId}/status-overrides`, payload);
  return response.data.data;
};

export const getAttendanceStatusOverrideAudit = async ({
  employeeId,
  attendanceDate,
  page = 1,
  limit = 20,
}: {
  employeeId: string;
  attendanceDate: string;
  page?: number;
  limit?: number;
}): Promise<AttendanceStatusOverrideAuditResponse> => {
  const response = await api.get<{
    data: AttendanceStatusOverrideAuditResponse;
  }>(
    `/attendance/admin/employees/${employeeId}/status-overrides/${attendanceDate}/audit`,
    { params: { page, limit } },
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