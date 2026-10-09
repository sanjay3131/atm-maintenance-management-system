export type ComplaintStatus =
  | "OPEN"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "CLOSED"
  | "CANCELLED";

export type ComplaintPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ComplaintATM {
  _id: string;
  atmId?: string;
  locationName?: string;
  address?: string;
  bank?: string | null;
  districtId?: string | null;
  regionId?: string | null;
  location?: {
    type?: "Point";
    coordinates?: [number, number];
  };
  installationType?: "ONSITE" | "OFFSITE";
}

export interface ComplaintCustomer {
  _id: string;
  customerName?: string;
}

export interface ComplaintJob {
  _id: string;
  jobId?: string;
  jobNumber?: string;
  status?: string;
  title?: string;
  assignedEmployeeId?: string | null;
  cancelledAt?: string;
  cancellationReason?: string;
}

export interface ComplaintJobLinkHistory {
  _id?: string;
  jobId: ComplaintJob | string;
  endedAt: string;
  endReason: string;
}

export interface ComplaintUser {
  _id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface Complaint {
  _id: string;
  complaintNumber?: string | null;
  atmId?: ComplaintATM | string | null;
  customerId?: ComplaintCustomer | string | null;
  reportedBy?: string | null;
  reportedVia?: "phone" | "email" | "whatsapp" | "in_person" | "other" | null;
  title?: string | null;
  description?: string | null;
  priority?: ComplaintPriority | null;
  status?: ComplaintStatus | null;
  jobId?: ComplaintJob | string | null;
  jobLinkHistory?: ComplaintJobLinkHistory[];
  resolvedAt?: string;
  resolvedBy?: ComplaintUser | string | null;
  resolutionNotes?: string;
  closedAt?: string;
  closedBy?: ComplaintUser | string | null;
  closureReason?: string;
  reportedAt?: string | null;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: ComplaintUser | string | null;
  createdBy?: ComplaintUser | string | null;
  updatedBy?: ComplaintUser | string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ComplaintStats {
  statusCounts: Partial<Record<ComplaintStatus, number>>;
  priorityCounts: Partial<Record<ComplaintPriority, number>>;
  today: number;
  total: number;
}

export interface ComplaintPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ComplaintListResponse {
  complaints: Complaint[];
  stats: ComplaintStats;
  pagination: ComplaintPagination;
}

export interface ComplaintListParams {
  status?: ComplaintStatus;
  priority?: ComplaintPriority;
  atmId?: string;
  customerId?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page: number;
  limit: number;
}

export interface CreateComplaintData {
  title: string;
  description: string;
  atmId: string;
  customerId?: string;
  reportedBy: string;
  reportedVia: NonNullable<Complaint["reportedVia"]>;
  priority: ComplaintPriority;
}
