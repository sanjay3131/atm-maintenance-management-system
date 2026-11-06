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

export interface VehicleDetails extends Vehicle {
  assignments: Array<Record<string, unknown>>;
  services: VehicleServiceRecord[];
  mileageHistory: VehicleUsageSession[];
  reminders: VehicleReminder[];
  policyConfigured: boolean;
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
