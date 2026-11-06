import api from "@/lib/axios";
import type {
  PagedVehicleHistory,
  ServicePolicyResponse,
  Vehicle,
  VehicleDetails,
  VehicleListResponse,
  VehicleServiceRecord,
  VehicleServiceReviewResult,
  VehicleUsageSession,
} from "@/features/vehicles/types/vehicle.types";

export interface VehicleListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: "ACTIVE" | "INACTIVE";
}

export interface VehicleInput {
  registrationNumber: string;
  make: string;
  model: string;
  initialOdometerKm: number;
  purchaseDate?: string;
  notes?: string;
}

export interface VehicleOdometerCorrectionResult {
  previousOdometerKm: number;
  correctedOdometerKm: number;
  timelineReviewRequired: boolean;
  serviceBaselineReviewRequired: boolean;
}

export const getVehicles = async (params: VehicleListParams = {}) => {
  const response = await api.get<{ data: VehicleListResponse }>(
    "/vehicles/admin",
    { params },
  );
  return response.data.data;
};

export const getVehicle = async (vehicleId: string) => {
  const response = await api.get<{ data: VehicleDetails }>(
    `/vehicles/admin/${vehicleId}`,
  );
  return response.data.data;
};

export const createVehicle = async (payload: VehicleInput) => {
  const response = await api.post<{ data: Vehicle }>(
    "/vehicles/admin",
    payload,
  );
  return response.data.data;
};

export const updateVehicle = async ({
  vehicleId,
  payload,
}: {
  vehicleId: string;
  payload: Partial<VehicleInput>;
}) => {
  const response = await api.patch<{ data: Vehicle }>(
    `/vehicles/admin/${vehicleId}`,
    payload,
  );
  return response.data.data;
};

export const updateVehicleStatus = async ({
  vehicleId,
  status,
  expectedVehicleRevision,
}: {
  vehicleId: string;
  status: Vehicle["status"];
  expectedVehicleRevision: number;
}) => {
  const response = await api.patch<{ data: Vehicle }>(
    `/vehicles/admin/${vehicleId}/status`,
    {
      status,
      expectedVehicleRevision,
    },
  );
  return response.data.data;
};

export const assignVehicle = async ({
  vehicleId,
  employeeId,
  expectedVehicleRevision,
  reason = "",
}: {
  vehicleId: string;
  employeeId: string;
  expectedVehicleRevision: number;
  reason?: string;
}) => {
  const response = await api.post<{ data: Record<string, unknown> }>(
    `/vehicles/admin/${vehicleId}/assignments`,
    { employeeId, expectedVehicleRevision, reason },
  );
  return response.data.data;
};

export const unassignVehicle = async ({
  vehicleId,
  expectedVehicleRevision,
  reason = "",
}: {
  vehicleId: string;
  expectedVehicleRevision: number;
  reason?: string;
}) => {
  const response = await api.post<{ data: Record<string, unknown> }>(
    `/vehicles/admin/${vehicleId}/unassign`,
    { expectedVehicleRevision, reason },
  );
  return response.data.data;
};

export const transferVehicleAssignment = async (payload: {
  employeeId: string;
  sourceVehicleId: string;
  targetVehicleId: string;
  expectedSourceRevision: number;
  expectedTargetRevision: number;
  reason?: string;
}) => {
  const response = await api.post<{ data: Record<string, unknown> }>(
    "/vehicles/admin/assignments/transfer",
    payload,
  );
  return response.data.data;
};

export const correctVehicleOdometer = async ({
  vehicleId,
  correctedOdometerKm,
  expectedVehicleRevision,
  reason,
  usageSessionId,
  correctedField,
}: {
  vehicleId: string;
  correctedOdometerKm: number;
  expectedVehicleRevision: number;
  reason: string;
  usageSessionId?: string;
  correctedField?: "START" | "END";
}) => {
  const response = await api.post<{ data: VehicleOdometerCorrectionResult }>(
    `/vehicles/admin/${vehicleId}/odometer-corrections`,
    {
      correctedOdometerKm,
      expectedVehicleRevision,
      reason,
      ...(usageSessionId ? { usageSessionId, correctedField } : {}),
    },
  );
  return response.data.data;
};

export const getVehicleOdometerCorrections = async (vehicleId: string) => {
  const response = await api.get<{
    data: PagedVehicleHistory<Record<string, unknown>>;
  }>(`/vehicles/admin/${vehicleId}/odometer-corrections`, {
    params: { page: 1, limit: 50 },
  });
  return response.data.data;
};

export const recoverVehicleSession = async ({
  sessionId,
  action,
  verifiedEndOdometerKm,
  expectedVehicleRevision,
  reason,
}: {
  sessionId: string;
  action: "RECOVERED_COMPLETED" | "CANCELLED";
  verifiedEndOdometerKm: number;
  expectedVehicleRevision: number;
  reason: string;
}) => {
  const response = await api.post<{ data: VehicleUsageSession }>(
    `/vehicles/admin/usage/${sessionId}/recover`,
    { action, verifiedEndOdometerKm, expectedVehicleRevision, reason },
  );
  return response.data.data;
};

export const getEligibleVehicles = async () => {
  const response = await api.get<{ data: Vehicle[] }>(
    "/vehicles/employee/usage/available-vehicles",
  );
  return response.data.data;
};

export const getCurrentVehicleSession = async () => {
  const response = await api.get<{ data: VehicleUsageSession | null }>(
    "/vehicles/employee/usage/current",
  );
  return response.data.data;
};

export const startVehicleSession = async ({
  vehicleId,
  startingOdometerKm,
  expectedVehicleRevision,
}: {
  vehicleId: string;
  startingOdometerKm: number;
  expectedVehicleRevision: number;
}) => {
  const response = await api.post<{ data: VehicleUsageSession }>(
    "/vehicles/employee/usage/start",
    {
      vehicleId,
      startingOdometerKm,
      expectedVehicleRevision,
    },
  );
  return response.data.data;
};

export const completeVehicleSession = async ({
  sessionId,
  endingOdometerKm,
  expectedVehicleRevision,
}: {
  sessionId: string;
  endingOdometerKm: number;
  expectedVehicleRevision: number;
}) => {
  const response = await api.post<{ data: VehicleUsageSession }>(
    `/vehicles/employee/usage/${sessionId}/complete`,
    { endingOdometerKm, expectedVehicleRevision },
  );
  return response.data.data;
};

export const getMyVehicleHistory = async (
  params: {
    page?: number;
    limit?: number;
    fromDate?: string;
    toDate?: string;
  } = {},
) => {
  const response = await api.get<{
    data: PagedVehicleHistory<VehicleUsageSession>;
  }>("/vehicles/employee/usage/history", { params });
  return response.data.data;
};

export const getAdminVehicleHistory = async (
  params: {
    page?: number;
    limit?: number;
    fromDate?: string;
    toDate?: string;
    employeeId?: string;
    vehicleId?: string;
  } = {},
) => {
  const response = await api.get<{
    data: PagedVehicleHistory<VehicleUsageSession>;
  }>("/vehicles/admin/usage/history", { params });
  return response.data.data;
};

export const getVehicleServices = async (
  vehicleId: string,
  params = { page: 1, limit: 50 },
) => {
  const response = await api.get<{
    data: PagedVehicleHistory<VehicleServiceRecord>;
  }>(`/vehicles/admin/${vehicleId}/services`, { params });
  return response.data.data;
};

export const createVehicleService = async ({
  vehicleId,
  serviceDate,
  serviceOdometerKm,
  expectedVehicleRevision,
  notes,
}: {
  vehicleId: string;
  serviceDate: string;
  serviceOdometerKm: number;
  expectedVehicleRevision: number;
  notes?: string;
}) => {
  const response = await api.post<{
    data: {
      service: VehicleServiceRecord;
      nextServiceOdometerKm: number | null;
    };
  }>(`/vehicles/admin/${vehicleId}/services`, {
    serviceType: "OIL_CHANGE",
    serviceDate,
    serviceOdometerKm,
    expectedVehicleRevision,
    notes,
  });
  return response.data.data;
};

export const reviewVehicleServiceConflict = async ({
  vehicleId,
  serviceId,
  expectedVehicleRevision,
  reason,
}: {
  vehicleId: string;
  serviceId: string;
  expectedVehicleRevision: number;
  reason: string;
}) => {
  const response = await api.post<{ data: VehicleServiceReviewResult }>(
    `/vehicles/admin/${vehicleId}/services/${serviceId}/review`,
    {
      expectedVehicleRevision,
      confirmReviewed: true,
      reason,
    },
  );
  return response.data.data;
};

export const getVehicleServicePolicy = async () => {
  const response = await api.get<{ data: ServicePolicyResponse }>(
    "/vehicles/admin/service-policy",
  );
  return response.data.data;
};

export const updateVehicleServicePolicy = async ({
  intervalKm,
  expectedVersion,
}: {
  intervalKm: number;
  expectedVersion: number;
}) => {
  const response = await api.patch<{
    data: NonNullable<ServicePolicyResponse["activePolicy"]>;
  }>("/vehicles/admin/service-policy", {
    serviceType: "OIL_CHANGE",
    intervalKm,
    expectedVersion,
  });
  return response.data.data;
};

export const getVehicleReminders = async () => {
  const response = await api.get<{ data: VehicleDetails["reminders"] }>(
    "/vehicles/admin/service-reminders",
  );
  return response.data.data;
};

export const downloadVehicleMileageExport = async ({
  reportType,
  fromDate,
  toDate,
  id,
}: {
  reportType: "vehicle" | "employee";
  fromDate: string;
  toDate: string;
  id?: string;
}) => {
  const isVehicleReport = reportType === "vehicle";
  const url = isVehicleReport
    ? "/vehicles/admin/reports/vehicle-export.xlsx"
    : "/vehicles/admin/reports/employee-export.xlsx";
  const params = {
    fromDate,
    toDate,
    ...(id ? (isVehicleReport ? { vehicleId: id } : { employeeId: id }) : {}),
  };
  const response = await api.get<Blob>(url, { params, responseType: "blob" });
  return {
    blob: response.data,
    filename:
      response.headers["content-disposition"]?.match(
        /filename="([^"]+)"/,
      )?.[1] ?? `${reportType}-mileage-${fromDate}-to-${toDate}.xlsx`,
  };
};
