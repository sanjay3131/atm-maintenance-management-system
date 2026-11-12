export type VehicleStatus = "ACTIVE" | "INACTIVE";
export type ServiceStatus =
  | "UPCOMING"
  | "DUE"
  | "OVERDUE"
  | "POLICY_NOT_CONFIGURED";
export type ReminderLifecycle = "ACTIVE" | "RESOLVED" | "SUPERSEDED";
export type DeliveryStatus = "PENDING" | "BLOCKED_NO_RECIPIENTS" | "DELIVERED";

export interface VehicleEmployee {
  _id: string;
  employeeCode: string;
  userId?: { firstName?: string; lastName?: string; email?: string };
}

export interface Vehicle {
  _id: string;
  registrationNumber: string;
  make: string;
  model: string;
  initialOdometerKm: number;
  currentOdometerKm: number;
  primaryAssignedEmployeeId?: VehicleEmployee | null;
  primaryAssignedToMe?: boolean;
  status: VehicleStatus;
  revision: number;
  serviceStatus: ServiceStatus;
  nextServiceOdometerKm: number | null;
  serviceBaselineReviewRequired?: boolean;
  notes?: string;
  timelineReviewRequired?: boolean;
  timelineReviewReason?: string;
  purchaseDate?: string | null;
}

export interface VehicleUsageSession {
  _id: string;
  vehicleId: string | (Partial<Vehicle> & { _id: string });
  employeeId: string;
  employeeNameSnapshot: string;
  employeeCodeSnapshot: string;
  vehicleRegistrationSnapshot: string;
  businessDate: string;
  startOdometerKm: number;
  endOdometerKm: number | null;
  distanceKm: number | null;
  startedAt: string;
  endedAt: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  vehicleRevision?: number;
  timelineReviewRequired?: boolean;
  timelineReviewReason?: string;
}

export interface VehicleDailyMileageSegment {
  _id?: string;
  employeeId: string;
  employeeNameSnapshot: string;
  employeeCodeSnapshot: string;
  startOdometerKm: number;
  endOdometerKm: number | null;
  distanceKm: number | null;
  startedAt: string;
  endedAt: string | null;
  usageSessions?: VehicleDailyMileageUsageSession[];
}

export interface VehicleDailyMileageUsageSession {
  _id?: string;
  startRequestId: string;
  endRequestId: string | null;
  startOdometerKm: number;
  endOdometerKm: number | null;
  distanceKm: number | null;
  startedAt: string;
  endedAt: string | null;
  status:
    | "IN_PROGRESS"
    | "COMPLETED"
    | "RECOVERY_REQUIRED"
    | "RECOVERED_COMPLETED";
}

export interface VehicleDailyMileage {
  _id: string;
  vehicleId: string;
  vehicleRegistrationSnapshot: string;
  businessDate: string;
  startOdometerKm: number;
  endOdometerKm: number | null;
  dailyDistanceKm: number | null;
  latestOdometerKm: number;
  status: "OPEN" | "ROLLOVER_PENDING" | "CLOSED";
  activeEmployeeId: string | null;
  segments: VehicleDailyMileageSegment[];
  auditHistory?: VehicleDailyMileageAuditEvent[];
  revision: number;
  timelineReviewRequired?: boolean;
  timelineReviewReason?: string;
  vehicleRevision?: number;
  vehicle?: Pick<
    Vehicle,
    "_id" | "registrationNumber" | "currentOdometerKm" | "status" | "revision"
  >;
}

export interface VehicleDailyMileageAuditEvent {
  action: string;
  actorId: string;
  employeeId?: string | null;
  employeeNameSnapshot?: string;
  employeeCodeSnapshot?: string;
  odometerKm: number;
  occurredAt: string;
  details?: string;
}

export interface ReopenableDailyMileage extends VehicleDailyMileage {
  endOdometerKm: number;
  closedAt: string;
  vehicleRevision: number;
}

export interface DailyMileageVehicle extends Vehicle {
  dailyMileageId: string | null;
  dailyMileageRevision: number | null;
  latestOdometerKm: number;
  usageState:
    | "AVAILABLE"
    | "HANDOVER"
    | "IN_USE"
    | "CLOSED"
    | "ROLLOVER_PENDING";
}

export interface DailyMileageRolloverPending
  extends Omit<VehicleDailyMileage, "activeEmployeeId" | "vehicleId"> {
  status: "ROLLOVER_PENDING";
  activeEmployeeId: {
    _id: string;
    employeeCode: string;
    userId?: { firstName?: string; lastName?: string };
  } | null;
  vehicleId: {
    _id: string;
    registrationNumber: string;
    currentOdometerKm: number;
    serviceStateRevision: number;
  };
}

export interface DailyMileageRolloverList {
  records: DailyMileageRolloverPending[];
}

export interface DailyMileageRolloverRecovery {
  previousRecord: VehicleDailyMileage;
  dailyRecord: VehicleDailyMileage;
  replayed: boolean;
}

export interface DailyMileageState {
  current: VehicleDailyMileage | null;
  vehicles: DailyMileageVehicle[];
  reopenableRecords: ReopenableDailyMileage[];
}

export interface PagedDailyMileageHistory {
  records: VehicleDailyMileage[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface VehicleServiceRecord {
  _id: string;
  vehicleId: string;
  serviceType: "OIL_CHANGE";
  serviceDate: string;
  serviceOdometerKm: number;
  notes?: string;
  createdAt: string;
  recordedBy?: { firstName?: string; lastName?: string };
  timelineReviewRequired?: boolean;
  timelineReviewReason?: string;
  timelineReviewedBy?: string | { firstName?: string; lastName?: string } | null;
  timelineReviewedAt?: string | null;
  timelineReviewResolutionReason?: string;
  timelineReviewHistory?: Array<{
    reviewedBy: string | { firstName?: string; lastName?: string };
    reviewedAt: string;
    reason: string;
  }>;
}

export interface VehicleServiceReviewResult {
  service: VehicleServiceRecord;
  currentOdometerKm: number;
  timelineReviewRequired: boolean;
  serviceBaselineReviewRequired: boolean;
}

export interface VehicleReminder {
  _id: string;
  vehicleId: string | { _id: string };
  cycleKey: string;
  serviceStatus: ServiceStatus;
  lifecycleStatus: ReminderLifecycle;
  deliveryStatus: DeliveryStatus;
  baselineOdometerKm: number;
  dueOdometerKm: number;
  activationCount: number;
  lastNotificationActivationCount: number;
}

export interface VehicleListResponse {
  vehicles: Vehicle[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface VehicleDailyMileageStatus {
  businessDate: string;
  dailyRecordStatus: "OPEN" | "CLOSED" | "ROLLOVER_PENDING" | "NONE";
  currentlyUsingEmployee: { id: string; displayName: string } | null;
  unresolvedSession: { id: string | null; displayName: string } | null;
  legacySessionStatus: "IN_PROGRESS" | "NONE";
  rolloverStatus: "PENDING" | "NONE";
}

export interface VehicleDetails extends Vehicle {
  assignments: Array<Record<string, unknown>>;
  services: VehicleServiceRecord[];
  mileageHistory: VehicleUsageSession[];
  dailyMileageHistory: VehicleDailyMileage[];
  reminders: VehicleReminder[];
  policyConfigured: boolean;
  dailyMileageStatus?: VehicleDailyMileageStatus;
}

export interface ServicePolicyResponse {
  configured: boolean;
  status?: "POLICY_NOT_CONFIGURED";
  activePolicy: null | {
    _id: string;
    intervalKm: number;
    version: number;
    coordinationRevision: number;
    effectiveFrom: string;
  };
}

export interface PagedVehicleHistory<T> {
  sessions?: T[];
  services?: T[];
  corrections?: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
