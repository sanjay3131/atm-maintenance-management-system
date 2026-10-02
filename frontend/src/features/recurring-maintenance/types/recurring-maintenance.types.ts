export type RecurringMaintenanceType =
  | "DAILY_CLEANING"
  | "WEEKLY_MOPPING";

export interface RecurringMaintenanceATM {
  _id: string;
  atmId: string;
  locationName: string;
  status: "ACTIVE" | "INACTIVE" | "UNDER_MAINTENANCE" | "REMOVED";
}

export interface RecurringMaintenancePlan {
  _id: string;
  atmId: string | RecurringMaintenanceATM;
  maintenanceType: RecurringMaintenanceType;
  dayOfWeek?: number | null;
  startDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecurringMaintenancePlanData {
  atmId: string;
  maintenanceType: RecurringMaintenanceType;
  startDate: string;
  dayOfWeek?: number;
}

export interface UpdateRecurringMaintenancePlanData {
  startDate?: string;
  dayOfWeek?: number;
  isActive?: boolean;
}
