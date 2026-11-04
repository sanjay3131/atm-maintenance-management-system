import api from "@/lib/axios";

export interface AttendanceRecord {
  _id: string;
  employeeId: string | null;
  supervisorUserId?: string | null;
  attendanceDate: string;
  checkInAt: string;
  checkOutAt: string | null;
  checkInSource: "employee" | "supervisor" | "admin" | "superAdmin";
  checkOutSource: "employee" | "supervisor" | "admin" | "superAdmin" | "system" | null;
  checkInRecordedBy: string;
  checkOutRecordedBy: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AttendanceReadRecord extends AttendanceRecord {
  effectiveStatus: "present" | "absent" | "incomplete";
  statusOrigin: "recorded" | "admin_override";
  workedDurationMs: number;
}

export interface AttendancePagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AttendanceListResponse {
  records: AttendanceReadRecord[];
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
  workedDurationMs: number | null;
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
    workedDurationMs: number | null;
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

export type AttendanceReportStatus =
  | "present"
  | "incomplete"
  | "absent"
  | "not_recorded";

export type AttendanceReportStatusOrigin =
  | "recorded"
  | "admin_override"
  | "no_record";

export type AttendanceReportCheckoutSource =
  | "employee"
  | "supervisor"
  | "admin"
  | "superAdmin"
  | "system";

export interface AttendanceReportSummary {
  eligibleWorkingDays: number;
  presentDays: number;
  incompleteDays: number;
  absentDays: number;
  notRecordedDays: number;
  attendancePercentage: number | null;
  workedDurationMs: number;
  finalizedWorkedDurationMs: number;
  provisionalWorkedDurationMs: number;
}

export interface AttendanceReportDailyDetail {
  attendanceDate: string;
  status: AttendanceReportStatus;
  calculatedStatus: "present" | "incomplete" | null;
  statusOrigin: AttendanceReportStatusOrigin;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkoutState: "not_checked_out" | "checked_out" | "no_record";
  checkOutSource: AttendanceReportCheckoutSource | null;
  workedDurationMs: number | null;
  durationIsProvisional: boolean;
}

export interface AttendanceReportQuery {
  fromDate: string;
  toDate: string;
  page?: number;
  limit?: number;
  employeeId?: string;
  asOf?: string;
}

export interface AttendanceReportExportQuery {
  fromDate: string;
  toDate: string;
  periodType: "week" | "month" | "year" | "custom";
  employeeId?: string;
  asOf: string;
}

export interface AttendanceReportResponse {
  timeZone: "Asia/Kolkata";
  asOf: string | null;
  period: {
    fromDate: string;
    toDate: string;
    calculatedThroughDate: string | null;
  };
  pagination: {
    page: number;
    limit: number;
    totalEmployees: number;
    totalPages: number;
  };
  employees: Array<{
    employeeId: string;
    employeeCode: string | null;
    summary: AttendanceReportSummary;
    dailyDetails: AttendanceReportDailyDetail[];
  }>;
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

export const getAttendanceReport = async (
  params: AttendanceReportQuery,
): Promise<AttendanceReportResponse> => {
  const response = await api.get<{ data: AttendanceReportResponse }>(
    "/attendance/admin/reports",
    {
      params: {
        fromDate: params.fromDate,
        toDate: params.toDate,
        page: params.page ?? 1,
        limit: params.limit ?? 25,
        ...(params.employeeId !== undefined
          ? { employeeId: params.employeeId }
          : {}),
        ...(params.asOf !== undefined ? { asOf: params.asOf } : {}),
      },
    },
  );
  return response.data.data;
};

export const downloadAttendanceReportExport = async (
  format: "xlsx" | "pdf",
  params: AttendanceReportExportQuery,
): Promise<{ blob: Blob; filename: string }> => {
  const response = await api.get<Blob>(
    `/attendance/admin/reports/export.${format}`,
    {
      params,
      responseType: "blob",
    },
  );
  const disposition = response.headers["content-disposition"] ?? "";
  const filename = disposition.match(
    /filename="(attendance-report-\d{4}-\d{2}-\d{2}\.(?:xlsx|pdf))"/,
  )?.[1];
  return {
    blob: response.data,
    filename:
      filename ??
      `attendance-report-${params.fromDate}.${format}`,
  };
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