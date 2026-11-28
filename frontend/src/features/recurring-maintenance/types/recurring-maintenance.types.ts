export type RecurringMaintenanceType =
  | "DAILY_CLEANING"
  | "WEEKLY_MOPPING";

export interface RecurringMaintenanceATM {
  _id: string;
  atmId: string;
  clientAtmId?: string | null;
  locationName: string;
  status: "ACTIVE" | "INACTIVE" | "UNDER_MAINTENANCE" | "REMOVED";
}

export interface RecurringMaintenanceEmployee {
  _id: string;
  employeeCode?: string;
  status?: string;
  userId?: {
    _id?: string;
    firstName?: string;
    lastName?: string;
    status?: string;
    userType?: string;
  } | null;
}

export interface RecurringMaintenancePlan {
  _id: string;
  atmId: string | RecurringMaintenanceATM;
  assignedEmployeeId?: string | RecurringMaintenanceEmployee | null;
  maintenanceType: RecurringMaintenanceType;
  dayOfWeek?: number | null;
  startDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CleaningMonitoringStatus =
  | "GREEN"
  | "RED"
  | "GRACE_PERIOD"
  | "NO_HISTORY"
  | "CONFIGURATION_REQUIRED";

export interface CleaningMonitoringATM {
  _id: string;
  atmId?: string;
  clientAtmId?: string | null;
  locationName?: string;
}

export interface CleaningMonitoringEmployee {
  _id: string;
  employeeCode?: string;
  userId?: {
    firstName?: string;
    lastName?: string;
  } | null;
}

export interface CleaningMonitoringRecord {
  planId: string;
  atm: CleaningMonitoringATM | null;
  responsibleEmployee: CleaningMonitoringEmployee | null;
  maintenanceType: RecurringMaintenanceType;
  dayOfWeek: number | null;
  monitoringActivatedAt: string | null;
  latestCleaningDate: string | null;
  ageInCalendarDays: number | null;
  status: CleaningMonitoringStatus;
}

export interface CleaningHistoryPhoto {
  id: string;
  photoType: "before" | "after" | "other";
  url: string | null;
  thumbnailUrl: string | null;
  uploadedAt: string | null;
  available: boolean;
}

export interface CleaningHistoryUser {
  id: string;
  firstName: string;
  lastName: string;
}

export interface CleaningHistoryEmployee {
  id: string;
  employeeCode: string;
  name: string;
}

export interface CleaningHistorySubmission {
  actualCleanerType: "INTERNAL" | "OUTSOURCED";
  actualCleanerEmployee: CleaningHistoryEmployee | null;
  outsourcedCleanerName: string | null;
  actualCleaningDate: string;
  reportingMethod: "EMPLOYEE" | "ADMIN";
  submittedBy: CleaningHistoryUser | null;
  submittedAt: string | null;
  remarks: string;
  evidencePhotos: CleaningHistoryPhoto[];
}

export interface CleaningHistoryCorrection {
  correctedBy: CleaningHistoryUser | null;
  correctedAt: string | null;
  reason: string;
  changes: Array<{
    field: string;
    previousValue: unknown;
    correctedValue: unknown;
  }>;
}

export interface CleaningHistoryRecord {
  id: string;
  actualCleaningDate: string;
  cleanerType: "INTERNAL" | "OUTSOURCED";
  actualCleanerEmployee: CleaningHistoryEmployee | null;
  outsourcedCleanerName: string | null;
  reportingEmployee: CleaningHistoryEmployee | null;
  submittedBy: CleaningHistoryUser | null;
  reportingMethod: "EMPLOYEE" | "ADMIN";
  submittedAt: string | null;
  remarks: string;
  evidencePhotos: CleaningHistoryPhoto[];
  validityStatus: "VALID" | "VOID";
  submissionHistory: CleaningHistorySubmission[];
  correctionHistory: CleaningHistoryCorrection[];
  historyTruncated: {
    submissionHistory: boolean;
    correctionHistory: boolean;
  };
}

export interface RecurringCleaningHistoryEntry {
  scheduledJob: {
    id: string;
    status: string;
    scheduledDate: string | null;
    beforePhotos: CleaningHistoryPhoto[];
    afterPhotos: CleaningHistoryPhoto[];
  } | null;
  cleaningRecord: CleaningHistoryRecord | null;
}

export interface RecurringCleaningPlanHistory {
  plan: {
    planId: string;
    isActive: boolean;
    atm: {
      id: string;
      atmId: string;
      clientAtmId: string | null;
      location: string;
      bank: { id: string | null; name: string | null; code: string | null };
      region: { id: string | null; name: string | null };
      district: { id: string | null; name: string | null };
    } | null;
    assignedEmployee: CleaningHistoryEmployee | null;
    maintenanceType: RecurringMaintenanceType;
    currentMonitoringStatus: CleaningMonitoringStatus | "PLAN INACTIVE";
    lastValidCleaningDate: string | null;
    daysSinceLastValidCleaning: number | null;
    monitoringActivatedAt: string | null;
  };
  history: {
    entries: RecurringCleaningHistoryEntry[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      dateFilterField: string;
    };
  };
}

export interface RecurringCleaningHistoryQuery {
  page: number;
  limit: number;
  fromDate?: string;
  toDate?: string;
}

export interface RecurringCleaningExportQuery {
  fromDate: string;
  toDate: string;
  employeeId?: string;
  bankId?: string;
  regionId?: string;
  districtId?: string;
  maintenanceType?: RecurringMaintenanceType;
  monitoringStatus?: CleaningMonitoringStatus;
}

export interface CreateRecurringMaintenancePlanData {
  atmId: string;
  assignedEmployeeId: string;
  maintenanceType: RecurringMaintenanceType;
  startDate: string;
  dayOfWeek?: number;
}

export interface UpdateRecurringMaintenancePlanData {
  assignedEmployeeId?: string;
  startDate?: string;
  dayOfWeek?: number;
  isActive?: boolean;
}
