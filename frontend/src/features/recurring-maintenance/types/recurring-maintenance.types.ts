export type RecurringMaintenanceType =
  | "DAILY_CLEANING"
  | "WEEKLY_MOPPING";

export interface RecurringMaintenanceATM {
  _id: string;
  atmId: string;
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
