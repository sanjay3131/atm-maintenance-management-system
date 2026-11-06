import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import Vehicle from "./vehicle.model.js";
import VehicleAssignment from "./vehicleAssignment.model.js";
import VehicleOdometerCorrection from "./vehicleOdometerCorrection.model.js";
import VehicleServiceReminder from "./vehicleServiceReminder.model.js";
import {
  assignVehicle,
  changeVehicleStatus,
  completeUsageSession,
  createOdometerCorrection,
  createVehicle,
  getCurrentEmployeeSession,
  getServicePolicy,
  getUsageHistory,
  getVehicleDetails,
  initializeDefaultVehiclePolicy,
  listEligibleVehicles,
  listOdometerCorrections,
  listVehicleServices,
  listVehicles,
  recordVehicleService,
  recoverUsageSession,
  reviewVehicleServiceConflict,
  startUsageSession,
  transferVehicleAssignment,
  unassignVehicle,
  updateServicePolicy,
  updateVehicle,
} from "./vehicle.service.js";
import { createVehicleMileageWorkbook } from "./vehicleReport.service.js";
import {
  processVehicleReminders,
  reconcileAndDeliverVehicleReminders,
} from "./vehicleReminderWorker.js";

const publicVehicle = (vehicle) => {
  if (!vehicle) return vehicle;
  const result = vehicle.toObject ? vehicle.toObject() : { ...vehicle };
  result.revision = result.serviceStateRevision;
  delete result.serviceStateRevision;
  delete result.registrationNumberNormalized;
  return result;
};

const reconcileAfterCommit = async (vehicleId) => {
  try {
    await reconcileAndDeliverVehicleReminders(vehicleId);
  } catch (error) {
    console.error(
      `[Vehicle] Post-commit reminder reconciliation failed for ${vehicleId}:`,
      error,
    );
  }
};

export const getAdminVehicles = asyncHandler(async (req, res) => {
  const result = await listVehicles(req.validatedQuery);
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...result,
        vehicles: result.vehicles.map(publicVehicle),
      },
      "Vehicles fetched",
    ),
  );
});

export const postVehicle = asyncHandler(async (req, res) => {
  const vehicle = await createVehicle({
    input: req.body,
    actorId: req.user._id,
  });
  return res
    .status(201)
    .json(new ApiResponse(201, publicVehicle(vehicle), "Vehicle created"));
});

export const getAdminVehicle = asyncHandler(async (req, res) => {
  const vehicle = await getVehicleDetails(req.validatedParams.vehicleId);
  const result = publicVehicle(vehicle);
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Vehicle details fetched"));
});

export const patchVehicle = asyncHandler(async (req, res) => {
  const vehicle = await updateVehicle({
    vehicleId: req.validatedParams.vehicleId,
    input: req.body,
    actorId: req.user._id,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, publicVehicle(vehicle), "Vehicle updated"));
});

export const patchVehicleStatus = asyncHandler(async (req, res) => {
  const vehicle = await changeVehicleStatus({
    vehicleId: req.validatedParams.vehicleId,
    status: req.body.status,
    expectedRevision: req.body.expectedVehicleRevision,
    actorId: req.user._id,
  });
  await reconcileAfterCommit(vehicle._id);
  return res
    .status(200)
    .json(
      new ApiResponse(200, publicVehicle(vehicle), "Vehicle status updated"),
    );
});

export const getVehicleAssignments = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findById(req.validatedParams.vehicleId).select(
    "_id serviceStateRevision",
  );
  if (!vehicle) throw new ApiError(404, "Vehicle not found");
  const assignments = await VehicleAssignment.find({ vehicleId: vehicle._id })
    .populate({
      path: "employeeId",
      populate: { path: "userId", select: "firstName lastName email" },
    })
    .populate("assignedBy", "firstName lastName")
    .sort({ assignedAt: -1, _id: -1 });
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        revision: vehicle.serviceStateRevision,
        assignments,
      },
      "Vehicle assignments fetched",
    ),
  );
});

export const postVehicleAssignment = asyncHandler(async (req, res) => {
  const assignment = await assignVehicle({
    vehicleId: req.validatedParams.vehicleId,
    employeeId: req.body.employeeId,
    expectedRevision: req.body.expectedVehicleRevision,
    reason: req.body.reason,
    actorId: req.user._id,
  });
  return res
    .status(201)
    .json(new ApiResponse(201, assignment, "Vehicle assigned"));
});

export const postVehicleUnassignment = asyncHandler(async (req, res) => {
  const assignment = await unassignVehicle({
    vehicleId: req.validatedParams.vehicleId,
    expectedRevision: req.body.expectedVehicleRevision,
    reason: req.body.reason,
    actorId: req.user._id,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, assignment, "Vehicle unassigned"));
});

export const postVehicleTransfer = asyncHandler(async (req, res) => {
  const assignment = await transferVehicleAssignment({
    ...req.body,
    actorId: req.user._id,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, assignment, "Vehicle assignment transferred"));
});

export const getEligibleVehicles = asyncHandler(async (req, res) => {
  const vehicles = await listEligibleVehicles(req.user);
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        vehicles.map(publicVehicle),
        "Eligible vehicles fetched",
      ),
    );
});

export const getMyCurrentVehicleSession = asyncHandler(async (req, res) => {
  const current = await getCurrentEmployeeSession(req.user);
  const data = current?.toObject() ?? null;
  if (data?.vehicleId) {
    data.vehicleId.revision = data.vehicleId.serviceStateRevision;
    delete data.vehicleId.serviceStateRevision;
  }
  return res
    .status(200)
    .json(new ApiResponse(200, data, "Current vehicle session fetched"));
});

export const postVehicleSessionStart = asyncHandler(async (req, res) => {
  const session = await startUsageSession({ ...req.body, user: req.user });
  await reconcileAfterCommit(session.vehicleId);
  const vehicle = await Vehicle.findById(session.vehicleId).select(
    "serviceStateRevision",
  );
  return res.status(201).json(
    new ApiResponse(
      201,
      {
        ...session.toObject(),
        vehicleRevision: vehicle?.serviceStateRevision,
      },
      "Vehicle session started",
    ),
  );
});

export const postVehicleSessionComplete = asyncHandler(async (req, res) => {
  const session = await completeUsageSession({
    sessionId: req.validatedParams.sessionId,
    user: req.user,
    ...req.body,
  });
  await reconcileAfterCommit(session.vehicleId);
  const vehicle = await Vehicle.findById(session.vehicleId).select(
    "serviceStateRevision",
  );
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...session.toObject(),
        vehicleRevision: vehicle?.serviceStateRevision,
      },
      "Vehicle session completed",
    ),
  );
});

export const getMyVehicleUsageHistory = asyncHandler(async (req, res) => {
  const result = await getUsageHistory({
    user: req.user,
    ...req.validatedQuery,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Mileage history fetched"));
});

export const getAdminVehicleUsageHistory = asyncHandler(async (req, res) => {
  const result = await getUsageHistory({ admin: true, ...req.validatedQuery });
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Mileage history fetched"));
});

export const postVehicleSessionRecovery = asyncHandler(async (req, res) => {
  const session = await recoverUsageSession({
    sessionId: req.validatedParams.sessionId,
    ...req.body,
    actorId: req.user._id,
  });
  await reconcileAfterCommit(session.vehicleId);
  return res
    .status(200)
    .json(new ApiResponse(200, session, "Vehicle session recovered"));
});

export const postVehicleOdometerCorrection = asyncHandler(async (req, res) => {
  const correction = await createOdometerCorrection({
    vehicleId: req.validatedParams.vehicleId,
    ...req.body,
    actorId: req.user._id,
  });
  await reconcileAfterCommit(req.validatedParams.vehicleId);
  return res
    .status(201)
    .json(new ApiResponse(201, correction, "Odometer correction recorded"));
});

export const getVehicleOdometerCorrections = asyncHandler(async (req, res) => {
  const result = await listOdometerCorrections({
    vehicleId: req.validatedParams.vehicleId,
    ...req.validatedQuery,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Odometer corrections fetched"));
});

export const getVehicleServices = asyncHandler(async (req, res) => {
  const result = await listVehicleServices({
    vehicleId: req.validatedParams.vehicleId,
    ...req.validatedQuery,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Service history fetched"));
});

export const postVehicleService = asyncHandler(async (req, res) => {
  const result = await recordVehicleService({
    vehicleId: req.validatedParams.vehicleId,
    input: req.body,
    actorId: req.user._id,
  });
  await reconcileAfterCommit(req.validatedParams.vehicleId);
  return res
    .status(201)
    .json(new ApiResponse(201, result, "Oil service recorded"));
});

export const postVehicleServiceReview = asyncHandler(async (req, res) => {
  const result = await reviewVehicleServiceConflict({
    ...req.validatedParams,
    ...req.body,
    actorId: req.user._id,
  });
  await reconcileAfterCommit(req.validatedParams.vehicleId);
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Service timeline review recorded"));
});

export const getVehicleServicePolicy = asyncHandler(async (req, res) => {
  const policy = await getServicePolicy();
  return res
    .status(200)
    .json(new ApiResponse(200, policy, "Service policy fetched"));
});

export const patchVehicleServicePolicy = asyncHandler(async (req, res) => {
  const policy = await updateServicePolicy({
    ...req.body,
    updatedBy: req.user._id,
  });
  try {
    await processVehicleReminders();
  } catch (error) {
    console.error(
      "[Vehicle] Reminder reconciliation after policy update failed:",
      error,
    );
  }
  return res
    .status(200)
    .json(new ApiResponse(200, policy, "Service policy updated"));
});

export const getVehicleReminders = asyncHandler(async (req, res) => {
  const reminders = await VehicleServiceReminder.find({})
    .populate("vehicleId", "registrationNumber status currentOdometerKm")
    .sort({ updatedAt: -1, _id: -1 });
  return res
    .status(200)
    .json(new ApiResponse(200, reminders, "Service reminders fetched"));
});

const exportReport = (reportType) =>
  asyncHandler(async (req, res) => {
    const result = await createVehicleMileageWorkbook({
      reportType,
      ...req.validatedQuery,
    });
    return res
      .status(200)
      .set("Content-Type", result.contentType)
      .set("Content-Disposition", `attachment; filename="${result.filename}"`)
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .send(result.buffer);
  });

export const exportVehicleMileageReport = exportReport("vehicle");
export const exportEmployeeMileageReport = exportReport("employee");
