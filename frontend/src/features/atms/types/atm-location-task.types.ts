import type { ATM } from "./atm.types";
import type { Employee } from "@/services/employee.service";

export type ATMLocationTaskType = "INITIAL_COLLECTION" | "LOCATION_CORRECTION";
export type ATMLocationTaskStatus =
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "PENDING_REVIEW"
  | "REJECTED"
  | "COMPLETED"
  | "CANCELLED";

export interface ATMLocationTaskEmployee {
  _id: string;
  employeeCode?: string;
  userId?: string | Employee["userId"] | null;
}

export interface ATMLocationTaskRequest {
  _id: string;
  locationTaskId?: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  proposedLatitude: number;
  proposedLongitude: number;
  accuracy: number | null;
  inputSource: "GPS" | "MANUAL";
  submittedAt: string;
  rejectionReason: string | null;
}

export interface ATMLocationTask {
  _id: string;
  atmId: string | ATM;
  assignedEmployeeId: string | ATMLocationTaskEmployee;
  taskType: ATMLocationTaskType;
  status: ATMLocationTaskStatus;
  active: boolean;
  createdBy: string | null;
  correctionReason: string | null;
  locationRequestId: string | ATMLocationTaskRequest | null;
  heldAt: string | null;
  heldBy: string | null;
  resumedAt: string | null;
  resumedBy: string | null;
  assignmentHistory: Array<{
    previousEmployeeId: string | null;
    newEmployeeId: string;
    actedBy: string;
    assignedAt: string;
    reason: string | null;
  }>;
  completedAt: string | null;
  completedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ATMLocationTaskListResponse {
  tasks: ATMLocationTask[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ATMLocationTaskFilters {
  status?: ATMLocationTaskStatus;
  taskType?: ATMLocationTaskType;
  assignedEmployeeId?: string;
  page?: number;
  limit?: number;
}

export interface CreateATMLocationTaskItem {
  atmId: string;
  employeeId: string;
  taskType: ATMLocationTaskType;
  correctionReason?: string;
}

export interface CreateATMLocationTasksPayload {
  tasks: CreateATMLocationTaskItem[];
}

export interface ReassignATMLocationTaskPayload {
  employeeId: string;
  reason?: string;
}

export interface ReopenATMLocationTaskPayload {
  employeeId: string;
  reason: string;
}

export interface CancelATMLocationTaskPayload {
  reason: string;
}
