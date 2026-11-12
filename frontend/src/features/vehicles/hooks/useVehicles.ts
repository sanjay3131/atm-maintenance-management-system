import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  completeVehicleSession,
  completeDailyMileageUsageSession,
  closeDailyMileage,
  reopenDailyMileage,
  assignVehicle,
  correctVehicleOdometer,
  createVehicle,
  createVehicleService,
  getCurrentVehicleSession,
  getDailyMileageHistory,
  getDailyMileageState,
  getPendingDailyMileageRollovers,
  getEligibleVehicles,
  getMyVehicleHistory,
  getVehicle,
  getVehicleOdometerCorrections,
  getVehicleReminders,
  getVehicleServicePolicy,
  getVehicleServices,
  getVehicles,
  recoverVehicleSession,
  recoverDailyMileageRollover,
  handoverDailyMileage,
  joinDailyMileage,
  reviewVehicleServiceConflict,
  startVehicleSession,
  startDailyMileage,
  startDailyMileageUsageSession,
  transferVehicleAssignment,
  unassignVehicle,
  updateVehicle,
  updateVehicleServicePolicy,
  updateVehicleStatus,
} from "@/services/vehicle.service";
import type {
  VehicleListParams,
  VehicleInput,
} from "@/services/vehicle.service";

export const VEHICLES_QUERY_KEY = ["vehicles"] as const;
export const VEHICLE_SESSION_QUERY_KEY = ["vehicle-sessions", "me"] as const;
export const DAILY_MILEAGE_QUERY_KEY = ["daily-mileage", "me"] as const;
export const DAILY_MILEAGE_ROLLOVER_QUERY_KEY = [
  "daily-mileage",
  "rollover-pending",
] as const;

export const useVehicles = (params: VehicleListParams = {}) =>
  useQuery({
    queryKey: [...VEHICLES_QUERY_KEY, "list", params],
    queryFn: () => getVehicles(params),
  });

export const useVehicle = (vehicleId: string | null) =>
  useQuery({
    queryKey: [...VEHICLES_QUERY_KEY, "detail", vehicleId],
    queryFn: () => getVehicle(vehicleId!),
    enabled: Boolean(vehicleId),
  });

export const useVehicleServices = (vehicleId: string | null) =>
  useQuery({
    queryKey: [...VEHICLES_QUERY_KEY, "services", vehicleId],
    queryFn: () => getVehicleServices(vehicleId!),
    enabled: Boolean(vehicleId),
  });

export const useVehicleOdometerCorrections = (vehicleId: string | null) =>
  useQuery({
    queryKey: [...VEHICLES_QUERY_KEY, "corrections", vehicleId],
    queryFn: () => getVehicleOdometerCorrections(vehicleId!),
    enabled: Boolean(vehicleId),
  });

export const useVehicleServicePolicy = () =>
  useQuery({
    queryKey: [...VEHICLES_QUERY_KEY, "service-policy"],
    queryFn: getVehicleServicePolicy,
  });

export const useVehicleReminders = () =>
  useQuery({
    queryKey: [...VEHICLES_QUERY_KEY, "reminders"],
    queryFn: getVehicleReminders,
  });

export const useEligibleVehicles = () =>
  useQuery({
    queryKey: [...VEHICLES_QUERY_KEY, "eligible"],
    queryFn: getEligibleVehicles,
  });

export const useCurrentVehicleSession = () =>
  useQuery({
    queryKey: VEHICLE_SESSION_QUERY_KEY,
    queryFn: getCurrentVehicleSession,
  });

export const useMyVehicleHistory = () =>
  useQuery({
    queryKey: [...VEHICLE_SESSION_QUERY_KEY, "history"],
    queryFn: () => getMyVehicleHistory({ page: 1, limit: 20 }),
  });

export const useDailyMileageState = () =>
  useQuery({
    queryKey: DAILY_MILEAGE_QUERY_KEY,
    queryFn: getDailyMileageState,
  });

export const useDailyMileageHistory = () =>
  useQuery({
    queryKey: [...DAILY_MILEAGE_QUERY_KEY, "history"],
    queryFn: () => getDailyMileageHistory({ page: 1, limit: 50 }),
  });

export const usePendingDailyMileageRollovers = () =>
  useQuery({
    queryKey: DAILY_MILEAGE_ROLLOVER_QUERY_KEY,
    queryFn: getPendingDailyMileageRollovers,
  });

const useVehicleMutation = <TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: VEHICLES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: VEHICLE_SESSION_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DAILY_MILEAGE_QUERY_KEY }),
        queryClient.invalidateQueries({
          queryKey: DAILY_MILEAGE_ROLLOVER_QUERY_KEY,
        }),
      ]);
    },
  });
};

export const useCreateVehicle = () => useVehicleMutation(createVehicle);
export const useUpdateVehicle = () =>
  useVehicleMutation(
    (variables: { vehicleId: string; payload: Partial<VehicleInput> }) =>
      updateVehicle(variables),
  );
export const useUpdateVehicleStatus = () =>
  useVehicleMutation(updateVehicleStatus);
export const useAssignVehicle = () => useVehicleMutation(assignVehicle);
export const useUnassignVehicle = () => useVehicleMutation(unassignVehicle);
export const useTransferVehicleAssignment = () =>
  useVehicleMutation(transferVehicleAssignment);
export const useCorrectVehicleOdometer = () =>
  useVehicleMutation(correctVehicleOdometer);
export const useRecoverVehicleSession = () =>
  useVehicleMutation(recoverVehicleSession);
export const useRecoverDailyMileageRollover = () =>
  useVehicleMutation(recoverDailyMileageRollover);
export const useCreateVehicleService = () =>
  useVehicleMutation(createVehicleService);
export const useReviewVehicleServiceConflict = () =>
  useVehicleMutation(reviewVehicleServiceConflict);
export const useUpdateVehicleServicePolicy = () =>
  useVehicleMutation(updateVehicleServicePolicy);
export const useStartVehicleSession = () =>
  useVehicleMutation(startVehicleSession);
export const useCompleteVehicleSession = () =>
  useVehicleMutation(completeVehicleSession);
export const useStartDailyMileage = () =>
  useVehicleMutation(startDailyMileage);
export const useStartDailyMileageUsageSession = () =>
  useVehicleMutation(startDailyMileageUsageSession);
export const useCompleteDailyMileageUsageSession = () =>
  useVehicleMutation(completeDailyMileageUsageSession);
export const useHandoverDailyMileage = () =>
  useVehicleMutation(handoverDailyMileage);
export const useJoinDailyMileage = () =>
  useVehicleMutation(joinDailyMileage);
export const useCloseDailyMileage = () =>
  useVehicleMutation(closeDailyMileage);
export const useReopenDailyMileage = () =>
  useVehicleMutation(reopenDailyMileage);
