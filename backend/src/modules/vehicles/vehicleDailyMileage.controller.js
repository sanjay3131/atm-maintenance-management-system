import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import Vehicle from "./vehicle.model.js";
import {
  closeDailyMileage,
  completeDailyMileageUsageSession,
  getDailyMileageHistory,
  getDailyMileageState,
  handoverDailyMileage,
  listDailyMileageRolloverPending,
  joinDailyMileage,
  recoverDailyMileageRollover,
  reopenDailyMileage,
  startDailyMileage,
  startDailyMileageUsageSession,
} from "./vehicleDailyMileage.service.js";
import { reconcileAndDeliverVehicleReminders } from "./vehicleReminderWorker.js";
import { publishVehicleEventSafely } from "../../realtime/domain-events.js";

const reconcileAfterCommit = async (vehicleId) => {
  try {
    await reconcileAndDeliverVehicleReminders(vehicleId);
  } catch (error) {
    console.error(
      `[Vehicle] Post-daily-mileage reminder reconciliation failed for ${vehicleId}:`,
      error,
    );
  }
};

export const getEmployeeDailyMileage = asyncHandler(async (req, res) => {
  const result = await getDailyMileageState(req.user);
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Daily mileage state fetched"));
});

export const getEmployeeDailyMileageHistory = asyncHandler(
  async (req, res) => {
    const result = await getDailyMileageHistory({
      user: req.user,
      ...req.validatedQuery,
    });
    return res
      .status(200)
      .json(new ApiResponse(200, result, "Daily mileage history fetched"));
  },
);

export const postEmployeeDailyMileageStart = asyncHandler(
  async (req, res) => {
    const record = await startDailyMileage({
      ...req.body,
      user: req.user,
    });
    await reconcileAfterCommit(record.vehicleId);
    await publishVehicleEventSafely({
      vehicleId: record.vehicleId,
      action: "daily-mileage-started",
    });
    const result = {
      ...record.toObject(),
      vehicleRevision: (
        await Vehicle.findById(record.vehicleId).select("serviceStateRevision")
      )?.serviceStateRevision,
    };
    return res
      .status(201)
      .json(new ApiResponse(201, result, "Daily mileage record started"));
  },
);

export const postEmployeeDailyMileageHandover = asyncHandler(
  async (req, res) => {
    const record = await handoverDailyMileage({
      dailyMileageId: req.validatedParams.dailyMileageId,
      ...req.body,
      user: req.user,
    });
    await reconcileAfterCommit(record.vehicleId);
    await publishVehicleEventSafely({
      vehicleId: record.vehicleId,
      action: "daily-mileage-handed-over",
    });
    return res
      .status(200)
      .json(new ApiResponse(200, record, "Vehicle handover recorded"));
  },
);

export const postEmployeeDailyMileageJoin = asyncHandler(
  async (req, res) => {
    const record = await joinDailyMileage({
      dailyMileageId: req.validatedParams.dailyMileageId,
      ...req.body,
      user: req.user,
    });
    await reconcileAfterCommit(record.vehicleId);
    await publishVehicleEventSafely({
      vehicleId: record.vehicleId,
      action: "daily-mileage-joined",
    });
    return res
      .status(200)
      .json(new ApiResponse(200, record, "Daily mileage segment started"));
  },
);

export const postEmployeeDailyMileageUsageSessionStart = asyncHandler(
  async (req, res) => {
    const record = await startDailyMileageUsageSession({
      dailyMileageId: req.validatedParams.dailyMileageId,
      ...req.body,
      user: req.user,
    });
    await reconcileAfterCommit(record.vehicleId);
    await publishVehicleEventSafely({
      vehicleId: record.vehicleId,
      action: "daily-mileage-session-started",
    });
    return res
      .status(201)
      .json(new ApiResponse(201, record, "Usage session started"));
  },
);

export const postEmployeeDailyMileageUsageSessionComplete = asyncHandler(
  async (req, res) => {
    const record = await completeDailyMileageUsageSession({
      dailyMileageId: req.validatedParams.dailyMileageId,
      ...req.body,
      user: req.user,
    });
    await reconcileAfterCommit(record.vehicleId);
    await publishVehicleEventSafely({
      vehicleId: record.vehicleId,
      action: "daily-mileage-session-completed",
    });
    return res
      .status(200)
      .json(new ApiResponse(200, record, "Usage session completed"));
  },
);

export const postEmployeeDailyMileageClose = asyncHandler(
  async (req, res) => {
    const record = await closeDailyMileage({
      dailyMileageId: req.validatedParams.dailyMileageId,
      ...req.body,
      user: req.user,
    });
    await reconcileAfterCommit(record.vehicleId);
    await publishVehicleEventSafely({
      vehicleId: record.vehicleId,
      action: "daily-mileage-closed",
    });
    return res
      .status(200)
      .json(new ApiResponse(200, record, "Daily mileage record closed"));
  },
);

export const postEmployeeDailyMileageReopen = asyncHandler(
  async (req, res) => {
    const record = await reopenDailyMileage({
      dailyMileageId: req.validatedParams.dailyMileageId,
      ...req.body,
      user: req.user,
    });
    await reconcileAfterCommit(record.vehicleId);
    await publishVehicleEventSafely({
      vehicleId: record.vehicleId,
      action: "daily-mileage-reopened",
    });
    return res
      .status(200)
      .json(new ApiResponse(200, record, "Daily mileage record reopened"));
  },
);

export const getAdminDailyMileageRollovers = asyncHandler(async (req, res) => {
  const result = await listDailyMileageRolloverPending(req.user);
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Pending mileage rollovers fetched"));
});

export const postAdminDailyMileageRolloverRecovery = asyncHandler(
  async (req, res) => {
    const result = await recoverDailyMileageRollover({
      dailyMileageId: req.validatedParams.dailyMileageId,
      ...req.body,
      user: req.user,
    });
    await reconcileAfterCommit(result.dailyRecord.vehicleId);
    await publishVehicleEventSafely({
      vehicleId: result.dailyRecord.vehicleId,
      action: "daily-mileage-rollover-recovered",
    });
    return res
      .status(result.replayed ? 200 : 201)
      .json(
        new ApiResponse(
          result.replayed ? 200 : 201,
          result,
          result.replayed
            ? "Rollover recovery already completed"
            : "Mileage rollover recovered",
        ),
      );
  },
);
