export type JobStatus =
  | "PENDING"
  | "ASSIGNED"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "VERIFIED"
  | "APPROVED"
  | "CLOSED"
  | "REJECTED";

export type JobPriority = "low" | "medium" | "high" | "critical";

export type JobWorkType =
  | "repair"
  | "maintenance"
  | "installation"
  | "inspection"
  | "emergency";

export interface JobATM {
  _id: string;
  atmId?: string;
  locationName?: string;
  address?: string;
  bank?: string;
  districtId?: string;
  regionId?: string;
  locationConfigured?: boolean;
  location?: {
    type?: "Point";
    coordinates?: [number, number];
  };
}

export interface JobUser {
  _id: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  employeeCode?: string;
}

export interface JobComplaint {
  _id: string;
  complaintNumber?: string;
  title?: string;
  description?: string;
  reportedBy?: string;
  reportedVia?: string;
  priority?: string;
  status?: string;
  reportedAt?: string;
}

export interface JobCustomer {
  _id: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  bankName?: string;
}

export interface JobPhoto {
  _id: string;
  url?: string | null;
  thumbnailUrl?: string | null;
  photoType?: "before" | "after" | "other";
  uploadedAt?: string;
}

export interface RecurringMaintenanceJobMetadata {
  source: "RECURRING";
  planId: string;
  maintenanceType: "DAILY_CLEANING" | "WEEKLY_MOPPING";
  occurrenceKey: string;
  scheduledDate: string;
  dueAt: string;
}

export interface JobReassignment {
  fromEmployee?: JobUser | string | null;
  toEmployee?: JobUser | string | null;
  reason?: string;
  reassignedAt?: string;
  reassignedBy?: JobUser | string | null;
}

export interface EmployeeGpsAtCompletion {
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  timestamp?: string;
}

export type JobHistoryAction =
  | "created"
  | "assigned"
  | "status_changed"
  | "photo_uploaded"
  | "gps_validated"
  | "reassigned"
  | "verified"
  | "approved"
  | "rejected"
  | "closed"
  | "note_added";

export interface JobHistoryActor {
  _id: string;
  firstName?: string;
  lastName?: string;
  userType?: string;
}

export interface JobHistoryEntry {
  _id: string;
  jobId: string;
  action: JobHistoryAction;
  fromStatus?: string;
  toStatus?: string;
  performedBy?: JobHistoryActor | null;
  performedAt: string;
  details?: unknown;
  ipAddress?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Job {
  _id: string;
  jobId: string;
  jobNumber?: string;
  title: string;
  description?: string;
  atmId: JobATM | string | null;
  complaintId?: JobComplaint | string | null;
  customerId?: JobCustomer | string | null;
  assignedEmployeeId?: JobUser | string | null;
  assignedBy?: string | JobUser | null;
  workType: JobWorkType;
  priority: JobPriority;
  status: JobStatus;
  recurringMaintenance?: RecurringMaintenanceJobMetadata;
  createdAt: string;
  assignedAt?: string | null;
  acceptedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  verifiedAt?: string | null;
  approvedAt?: string | null;
  closedAt?: string | null;
  rejectedAt?: string | null;
  employeeGpsAtCompletion?: EmployeeGpsAtCompletion;
  gpsDistance?: number;
  gpsValidated?: boolean;
  updatedAt?: string;
  employeeRemarks?: string;
  adminRemarks?: string;
  rejectionReason?: string;
  isReassigned?: boolean;
  reassignmentReason?: string;
  previousJobId?: string | null;
  reassignmentHistory?: JobReassignment[];
  createdBy?: JobUser | string | null;
  updatedBy?: JobUser | string | null;
  beforePhotos?: Array<JobPhoto | null>;
  afterPhotos?: Array<JobPhoto | null>;
}

export interface JobsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface JobsListResponse {
  jobs: Job[];
  pagination: JobsPagination;
  statusCounts?: Partial<Record<JobStatus, number>>;
}

export interface MyJobsListResponse {
  jobs: Job[];
  statusCounts: Partial<Record<JobStatus, number>>;
  pagination: JobsPagination;
}

export interface MyJobsQueryParams {
  page: number;
  limit: number;
  status?: JobStatus;
}

export interface CreateJobData {
  title: string;
  atmId: string;
  description?: string;
  complaintId?: string;
  customerId?: string;
  workType?: JobWorkType;
  priority?: JobPriority;
}

export interface AssignJobData {
  employeeId: string;
}

export interface VerifyJobData {
  action: "verify" | "reject";
  remarks?: string;
}

export interface ApproveJobData {
  action: "approve" | "reject";
  remarks?: string;
}

export interface JobsQueryParams {
  page: number;
  limit: number;
  customerId?: string;
  bankId?: string;
  districtId?: string;
  regionId?: string;
  search?: string;
  status?: JobStatus;
  priority?: JobPriority;
  workType?: JobWorkType;
}
