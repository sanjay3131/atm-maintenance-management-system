import type { VehicleReminder } from "./types/vehicle.types";
import type { Vehicle } from "./types/vehicle.types";

export const getEmployeeDefaultVehicleId = (vehicles: Vehicle[]) =>
  vehicles.find((vehicle) => vehicle.primaryAssignedToMe)?._id ?? "";

export const getPrefilledStartingOdometer = (vehicle?: Vehicle) =>
  vehicle ? String(vehicle.currentOdometerKm) : "";

export const getStartingOdometerForVehicleSelection = (
  vehicleId: string,
  vehicles: Array<
    Pick<Vehicle, "_id" | "currentOdometerKm"> & {
      usageState: "AVAILABLE" | "HANDOVER" | "IN_USE" | "CLOSED" | "ROLLOVER_PENDING";
    }
  >,
) => {
  const vehicle = vehicles.find((item) => item._id === vehicleId);
  return vehicle?.usageState === "AVAILABLE"
    ? String(vehicle.currentOdometerKm)
    : "";
};

export const parseStartingOdometer = (
  value: string,
  currentOdometerKm: number,
) => {
  if (!/^\d+$/.test(value)) return null;
  const reading = Number(value);
  return Number.isSafeInteger(reading) && reading >= currentOdometerKm
    ? reading
    : null;
};

export const getOdometerCorrectionSuccessMessage = ({
  historical,
  timelineReviewRequired,
}: {
  historical: boolean;
  timelineReviewRequired: boolean;
}) => {
  if (!historical) return "Odometer correction recorded.";
  return timelineReviewRequired
    ? "Historical reading corrected. Conflicting records still require review; reminders remain paused."
    : "Historical reading corrected. No timeline review conflicts remain.";
};

export interface VehicleEditDraft {
  vehicleId: string;
  registrationNumber: string;
  make: string;
  model: string;
  notes: string;
}

export const resolveVehicleEditDraft = (
  vehicle: Pick<Vehicle, "_id" | "registrationNumber" | "make" | "model" | "notes">,
  draft: VehicleEditDraft | null,
): VehicleEditDraft => draft?.vehicleId === vehicle._id
  ? draft
  : {
      vehicleId: vehicle._id,
      registrationNumber: vehicle.registrationNumber,
      make: vehicle.make,
      model: vehicle.model,
      notes: vehicle.notes ?? "",
    };

export const normalizeVehicleReference = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "_id" in value) {
    return normalizeVehicleReference(value._id);
  }
  return null;
};

export const findReminderForVehicle = (
  reminders: VehicleReminder[],
  vehicleId: string,
) =>
  reminders.find(
    (reminder) => normalizeVehicleReference(reminder.vehicleId) === vehicleId,
  );