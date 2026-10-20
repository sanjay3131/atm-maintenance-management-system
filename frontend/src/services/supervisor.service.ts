import api from "@/lib/axios";

export type SupervisorJobStatus =
  | "PENDING"
  | "ASSIGNED"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "VERIFIED"
  | "APPROVED"
  | "CLOSED"
  | "REJECTED"
  | "CANCELLED";

export type SupervisorAmcStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "OVERDUE";

export interface SupervisorDashboard {
  employees?: { total?: number | null } | null;
  atms?: { total?: number | null } | null;
  attendance?: {
    date?: string | null;
    records?: number | null;
    checkedIn?: number | null;
    checkedOut?: number | null;
    open?: number | null;
  } | null;
  jobs?: {
    total?: number | null;
    byStatus?: Partial<Record<SupervisorJobStatus, number>> | null;
    scheduledToday?: number | null;
    overdue?: number | null;
  } | null;
  amc?: {
    month?: number | null;
    year?: number | null;
    total?: number | null;
    byStatus?: Partial<Record<SupervisorAmcStatus, number>> | null;
    completionRate?: number | null;
  } | null;
  recentActivity?: Array<{
    jobId?: string | null;
    jobNumber?: string | null;
    title?: string | null;
    action?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    occurredAt?: string | null;
  }> | null;
}

export interface SupervisorPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SupervisorEmployeeSummary {
  _id: string;
  userId?: string | null;
  employeeCode?: string | null;
  designation?: string | null;
  department?: string | null;
  status?: string | null;
  joiningDate?: string | null;
  employmentType?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  assignedAtms?: SupervisorAssignedATM[] | null;
}

export interface SupervisorAssignedATM {
  _id: string;
  atmId?: string | null;
  locationName?: string | null;
  address?: string | null;
  status?: string | null;
}

export interface SupervisorEmployeesResponse {
  employees: SupervisorEmployeeSummary[];
  pagination: SupervisorPagination;
}

export interface SupervisorEmployeeDetailsResponse {
  employee: SupervisorEmployeeSummary;
  assignedAtms: SupervisorAssignedATM[];
}

export interface SupervisorAttendanceRecord {
  _id: string;
  employeeId: string;
  attendanceDate: string;
  checkInAt: string;
  checkOutAt: string | null;
  checkInSource?: string | null;
  checkOutSource?: string | null;
}

export interface SupervisorAttendanceResponse {
  records: SupervisorAttendanceRecord[];
  pagination: SupervisorPagination;
}

export interface SupervisorEmployeeJob {
  _id: string;
  jobId?: string | null;
  jobNumber?: string | null;
  title?: string | null;
  description?: string | null;
  status: SupervisorJobStatus;
  workType?: string | null;
  priority?: string | null;
  scheduledDate?: string | null;
  dueAt?: string | null;
  dueState?: string | null;
  createdAt?: string | null;
  assignedAt?: string | null;
  acceptedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  verifiedAt?: string | null;
  approvedAt?: string | null;
  closedAt?: string | null;
  rejectedAt?: string | null;
  cancelledAt?: string | null;
  employee?: { _id: string; userId: string; name: string | null } | null;
  atm?: SupervisorAssignedATM | null;
  completionEvidence?: {
    employeeRemarks?: string | null;
    gpsDistance?: number | null;
    gpsValidated?: boolean | null;
    employeeGpsAtCompletion?: {
      latitude?: number;
      longitude?: number;
      accuracy?: number;
      timestamp?: string;
    } | null;
    beforePhotos?: unknown[] | null;
    afterPhotos?: unknown[] | null;
  } | null;
}

export interface SupervisorEmployeeJobsResponse {
  jobs: SupervisorEmployeeJob[];
  pagination: SupervisorPagination;
}

export interface SupervisorEmployeeAMC {
  _id: string;
  amcId?: string | null;
  month: number;
  year: number;
  status: SupervisorAmcStatus;
  deadlineDate?: string | null;
  visitDate?: string | null;
  completedAt?: string | null;
  visitGps?: {
    latitude?: number;
    longitude?: number;
    accuracy?: number;
  } | null;
  gpsDistance?: number | null;
  gpsValidated?: boolean | null;
  checklist?: Array<{
    item?: string;
    response?: string;
    remarks?: string;
  }> | null;
  checklistCompleted?: boolean | null;
  employeeRemarks?: string | null;
  photoCount?: number | null;
  photos?: unknown[] | null;
  atm?: SupervisorAssignedATM | null;
}

export interface SupervisorEmployeeAMCResponse {
  employeeId: string;
  amcs: SupervisorEmployeeAMC[];
  statusCounts: Partial<Record<SupervisorAmcStatus, number>> & {
    total: number;
  };
  month: number;
  year: number;
  pagination: SupervisorPagination;
}

export interface SupervisorEmployeeListQuery {
  page: number;
  limit: number;
  search?: string;
}

export interface SupervisorEmployeeHistoryQuery {
  employeeId: string;
  page: number;
  limit: number;
}

export interface SupervisorEmployeeAMCQuery extends SupervisorEmployeeHistoryQuery {
  month: number;
  year: number;
}

export interface SupervisorJobListQuery {
  page: number;
  limit: number;
  search?: string;
  status?: SupervisorJobStatus;
  fromDate?: string;
  toDate?: string;
}

export interface SupervisorJobsResponse {
  jobs: SupervisorEmployeeJob[];
  pagination: SupervisorPagination;
}

export interface SupervisorJobHistoryEntry {
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  occurredAt: string;
}

export interface SupervisorJobHistoryResponse {
  job: {
    _id: string;
    jobNumber?: string | null;
    title?: string | null;
  };
  history: SupervisorJobHistoryEntry[];
}

export interface SupervisorJobPhoto {
  _id: string;
  photoType: "before" | "after" | "other";
  url?: string | null;
  thumbnailUrl?: string | null;
  uploadedAt?: string | null;
}

export interface SupervisorJobPhotosResponse {
  photos: SupervisorJobPhoto[];
}

export interface SupervisorAMCRecord {
  _id: string;
  amcId?: string | null;
  atmId?:
    | string
    | {
        _id?: string;
        atmId?: string | null;
        locationName?: string | null;
        address?: string | null;
      }
    | null;
  employeeId?:
    | string
    | {
      _id?: string;
      firstName?: string | null;
      lastName?: string | null;
    }
    | null;
  month: number;
  year: number;
  status: SupervisorAmcStatus;
  deadlineDate?: string | null;
  visitDate?: string | null;
  completedAt?: string | null;
  checklist?: Array<{
    item?: string;
    response?: string;
    remarks?: string;
  }> | null;
  checklistCompleted?: boolean | null;
  employeeRemarks?: string | null;
  photoCount?: number | null;
  generatedAt?: string | null;
  createdAt?: string | null;
}

export interface SupervisorAMCListQuery {
  page: number;
  limit: number;
  month?: number;
  year?: number;
  status?: SupervisorAmcStatus;
  search?: string;
}

export interface SupervisorAMCsResponse {
  amcs: SupervisorAMCRecord[];
  pagination: SupervisorPagination;
}

export interface SupervisorAMCDetailsResponse
  extends Omit<SupervisorAMCRecord, "atmId"> {
  atmId?:
    | string
    | {
        _id?: string;
        atmId?: string | null;
        locationName?: string | null;
        address?: string | null;
      }
    | null;
}

export interface SupervisorAMCPhotosResponse {
  photos: Array<{
    _id: string;
    url?: string | null;
    thumbnailUrl?: string | null;
    uploadedAt?: string | null;
  }>;
}

export const getSupervisorDashboard =
  async (): Promise<SupervisorDashboard> => {
    const response = await api.get<{ data: SupervisorDashboard }>(
      "/supervisor/dashboard",
    );
    return response.data.data;
  };

export const getSupervisorEmployees = async (
  params: SupervisorEmployeeListQuery,
): Promise<SupervisorEmployeesResponse> => {
  const response = await api.get<{ data: SupervisorEmployeesResponse }>(
    "/supervisor/employees",
    { params },
  );
  return response.data.data;
};

export const getSupervisorEmployee = async (
  employeeId: string,
): Promise<SupervisorEmployeeDetailsResponse> => {
  const response = await api.get<{
    data: SupervisorEmployeeDetailsResponse;
  }>(`/supervisor/employees/${employeeId}`);
  return response.data.data;
};

export const getSupervisorEmployeeAttendance = async ({
  employeeId,
  page,
  limit,
}: SupervisorEmployeeHistoryQuery): Promise<SupervisorAttendanceResponse> => {
  const response = await api.get<{ data: SupervisorAttendanceResponse }>(
    `/supervisor/employees/${employeeId}/attendance`,
    { params: { page, limit } },
  );
  return response.data.data;
};

export const getSupervisorEmployeeJobs = async ({
  employeeId,
  page,
  limit,
}: SupervisorEmployeeHistoryQuery): Promise<SupervisorEmployeeJobsResponse> => {
  const response = await api.get<{ data: SupervisorEmployeeJobsResponse }>(
    `/supervisor/employees/${employeeId}/jobs`,
    { params: { page, limit } },
  );
  return response.data.data;
};

export const getSupervisorEmployeeAMC = async ({
  employeeId,
  page,
  limit,
  month,
  year,
}: SupervisorEmployeeAMCQuery): Promise<SupervisorEmployeeAMCResponse> => {
  const response = await api.get<{ data: SupervisorEmployeeAMCResponse }>(
    `/supervisor/employees/${employeeId}/amc`,
    { params: { page, limit, month, year } },
  );
  return response.data.data;
};

export const getSupervisorJobs = async (
  params: SupervisorJobListQuery,
): Promise<SupervisorJobsResponse> => {
  const response = await api.get<{ data: SupervisorJobsResponse }>(
    "/supervisor/jobs",
    { params },
  );
  return response.data.data;
};

export const getSupervisorJob = async (
  jobId: string,
): Promise<SupervisorEmployeeJob> => {
  const response = await api.get<{ data: SupervisorEmployeeJob }>(
    `/supervisor/jobs/${jobId}`,
  );
  return response.data.data;
};

export const getSupervisorJobHistory = async (
  jobId: string,
): Promise<SupervisorJobHistoryResponse> => {
  const response = await api.get<{ data: SupervisorJobHistoryResponse }>(
    `/supervisor/jobs/${jobId}/history`,
  );
  return response.data.data;
};

export const getSupervisorJobPhotos = async (
  jobId: string,
): Promise<SupervisorJobPhotosResponse> => {
  const response = await api.get<{ data: SupervisorJobPhotosResponse }>(
    `/photos/job/${jobId}`,
  );
  return response.data.data;
};

export const getSupervisorAMCs = async (
  params: SupervisorAMCListQuery,
): Promise<SupervisorAMCsResponse> => {
  const response = await api.get<{ data: SupervisorAMCsResponse }>("/amc", {
    params,
  });
  return response.data.data;
};

export const getSupervisorAMC = async (
  amcId: string,
): Promise<SupervisorAMCDetailsResponse> => {
  const response = await api.get<{ data: SupervisorAMCDetailsResponse }>(
    `/amc/${amcId}`,
  );
  return response.data.data;
};

export const getSupervisorAMCPhotos = async (
  amcId: string,
): Promise<SupervisorAMCPhotosResponse> => {
  const response = await api.get<{ data: SupervisorAMCPhotosResponse }>(
    `/amc-photos/${amcId}`,
  );
  return response.data.data;
};

export const getSupervisorAMCReport = async (amcId: string) => {
  const response = await api.get<Blob>(`/amc/${amcId}/report`, {
    responseType: "blob",
  });
  return response.data;
};
