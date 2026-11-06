import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import Employee from "../employees/employee.model.js";
import User from "../users/user.model.js";
import Vehicle from "./vehicle.model.js";
import VehicleAssignment from "./vehicleAssignment.model.js";
import VehicleUsageSession from "./vehicleUsageSession.model.js";
import VehicleService from "./vehicleService.model.js";
import VehicleServicePolicy from "./vehicleServicePolicy.model.js";
import VehicleServiceReminder from "./vehicleServiceReminder.model.js";
import VehicleOdometerCorrection from "./vehicleOdometerCorrection.model.js";
import {
  getLatestOilService,
  getServiceStatus,
  isFutureAsiaKolkataDate,
  normalizeRegistrationNumber,
  requireWholeKilometres,
  toAsiaKolkataDateKey,
} from "./vehicle.utils.js";
import { vehicleError } from "./vehicle.errors.js";

export const DEFAULT_OIL_SERVICE_INTERVAL_KM = 3000;
export const MAX_VEHICLE_PAGE_SIZE = 100;

const idString = (value) => String(value?._id ?? value);
const isDuplicate = (error) => error?.code === 11000;
const cycleKeyFor = (vehicleId, baselineServiceId) =>
  `${vehicleId}:OIL_CHANGE:${baselineServiceId ? idString(baselineServiceId) : "INITIAL"}`;

const withTransaction = async (operation) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const casVehicle = async (vehicle, expectedRevision, session, set = {}) => {
  if (vehicle.serviceStateRevision !== expectedRevision) {
    throw vehicleError(
      409,
      "REVISION_CONFLICT",
      "Vehicle state changed. Refresh and retry.",
    );
  }
  const result = await Vehicle.updateOne(
    { _id: vehicle._id, serviceStateRevision: expectedRevision },
    { $set: set, $inc: { serviceStateRevision: 1 } },
    { session, runValidators: true },
  );
  if (result.matchedCount !== 1) {
    throw vehicleError(
      409,
      "REVISION_CONFLICT",
      "Vehicle state changed. Refresh and retry.",
    );
  }
};

const getVehicle = async (vehicleId, session) => {
  if (!mongoose.isValidObjectId(vehicleId)) {
    throw vehicleError(400, "VALIDATION_ERROR", "Invalid vehicle ID");
  }
  const query = Vehicle.findById(vehicleId);
  if (session) query.session(session);
  const vehicle = await query;
  if (!vehicle)
    throw vehicleError(404, "RESOURCE_NOT_FOUND", "Vehicle not found");
  return vehicle;
};

const getActiveEmployeeByUser = async (user, session) => {
  const query = Employee.findOne({ userId: user._id }).populate(
    "userId",
    "firstName lastName userType status",
  );
  if (session) query.session(session);
  const employee = await query;
  if (
    !employee ||
    employee.status !== "active" ||
    employee.userId?.status !== "active" ||
    employee.userId?.userType !== "employee"
  ) {
    throw vehicleError(
      403,
      "PERMISSION_DENIED",
      "An active employee profile is required",
    );
  }
  return employee;
};

const getActiveEmployeeById = async (employeeId, session) => {
  if (!mongoose.isValidObjectId(employeeId)) {
    throw vehicleError(400, "VALIDATION_ERROR", "Invalid employee ID");
  }
  const query = Employee.findById(employeeId).populate(
    "userId",
    "firstName lastName userType status",
  );
  if (session) query.session(session);
  const employee = await query;
  if (!employee)
    throw vehicleError(404, "RESOURCE_NOT_FOUND", "Employee not found");
  if (
    employee.status !== "active" ||
    employee.userId?.status !== "active" ||
    employee.userId?.userType !== "employee"
  ) {
    throw vehicleError(409, "EMPLOYEE_NOT_ACTIVE", "Employee is not active");
  }
  return employee;
};

const hasActiveSession = async (vehicleId, employeeId, session) => {
  const query = VehicleUsageSession.exists({
    status: "IN_PROGRESS",
    $or: [
      ...(vehicleId ? [{ vehicleId }] : []),
      ...(employeeId ? [{ employeeId }] : []),
    ],
  });
  if (session) query.session(session);
  return Boolean(await query);
};

const getPolicy = async (session) => {
  const query = VehicleServicePolicy.findOne({
    serviceType: "OIL_CHANGE",
    isActive: true,
  });
  if (session) query.session(session);
  return query;
};

const getBaseline = async (vehicle, session) => {
  const query = VehicleService.find({
    vehicleId: vehicle._id,
    serviceType: "OIL_CHANGE",
  }).sort({ serviceOdometerKm: -1, serviceDate: -1, createdAt: -1, _id: -1 });
  if (session) query.session(session);
  const service = getLatestOilService(await query);
  return {
    service,
    serviceId: service?._id ?? null,
    odometerKm: service?.serviceOdometerKm ?? vehicle.initialOdometerKm,
  };
};

const attachServiceSummary = async (vehicles, policy) => {
  if (!vehicles.length) return [];
  const vehicleIds = vehicles.map((vehicle) => vehicle._id);
  const services = await VehicleService.find({
    vehicleId: { $in: vehicleIds },
    serviceType: "OIL_CHANGE",
  }).sort({
    vehicleId: 1,
    serviceOdometerKm: -1,
    serviceDate: -1,
    createdAt: -1,
    _id: -1,
  });
  const serviceReviewVehicleIds = new Set(
    services
      .filter((service) => service.timelineReviewRequired)
      .map((service) => idString(service.vehicleId)),
  );
  const baselineByVehicle = new Map();
  for (const service of services) {
    const key = idString(service.vehicleId);
    if (!baselineByVehicle.has(key)) baselineByVehicle.set(key, service);
  }
  return vehicles.map((vehicle) => {
    const baseline = baselineByVehicle.get(idString(vehicle._id));
    const service = getServiceStatus({
      currentOdometerKm: vehicle.currentOdometerKm,
      baselineOdometerKm:
        baseline?.serviceOdometerKm ?? vehicle.initialOdometerKm,
      intervalKm: policy?.intervalKm,
    });
    return {
      ...vehicle.toObject(),
      serviceStatus: service.status,
      nextServiceOdometerKm: service.nextServiceOdometerKm,
      latestService: baseline ?? null,
      serviceBaselineReviewRequired: serviceReviewVehicleIds.has(idString(vehicle._id)),
    };
  });
};

export const initializeDefaultVehiclePolicy = async () => {
  const active = await VehicleServicePolicy.findOne({
    serviceType: "OIL_CHANGE",
    isActive: true,
  });
  if (active) return active;
  try {
    return await VehicleServicePolicy.create({
      serviceType: "OIL_CHANGE",
      intervalKm: DEFAULT_OIL_SERVICE_INTERVAL_KM,
      version: 1,
      coordinationRevision: 0,
      effectiveFrom: new Date(),
      isActive: true,
      updatedBy: null,
    });
  } catch (error) {
    if (isDuplicate(error)) {
      const current = await VehicleServicePolicy.findOne({
        serviceType: "OIL_CHANGE",
        isActive: true,
      });
      if (current) return current;
    }
    throw error;
  }
};

export const getServicePolicy = async () => {
  const policy = await getPolicy();
  return policy
    ? { configured: true, activePolicy: policy }
    : {
        configured: false,
        status: "POLICY_NOT_CONFIGURED",
        activePolicy: null,
      };
};

export const updateServicePolicy = async ({
  intervalKm,
  expectedVersion,
  updatedBy,
}) => {
  try {
    return await withTransaction(async (session) => {
      const active = await getPolicy(session);
      const actualVersion = active?.version ?? 0;
      if (actualVersion !== expectedVersion) {
        throw vehicleError(
          409,
          "POLICY_VERSION_CONFLICT",
          "Service policy changed. Refresh and retry.",
        );
      }
      if (active) {
        const deactivated = await VehicleServicePolicy.updateOne(
          {
            _id: active._id,
            version: expectedVersion,
            isActive: true,
            coordinationRevision: active.coordinationRevision,
          },
          { $set: { isActive: false } },
          { session },
        );
        if (deactivated.matchedCount !== 1) {
          throw vehicleError(
            409,
            "POLICY_VERSION_CONFLICT",
            "Service policy changed. Refresh and retry.",
          );
        }
      }
      const [policy] = await VehicleServicePolicy.create(
        [
          {
            serviceType: "OIL_CHANGE",
            intervalKm,
            version: expectedVersion + 1,
            coordinationRevision: 0,
            effectiveFrom: new Date(),
            isActive: true,
            updatedBy,
          },
        ],
        { session },
      );
      return policy;
    });
  } catch (error) {
    if (isDuplicate(error)) {
      throw vehicleError(
        409,
        "POLICY_VERSION_CONFLICT",
        "Service policy changed. Refresh and retry.",
      );
    }
    throw error;
  }
};

export const listVehicles = async ({
  page = 1,
  limit = 25,
  search,
  status,
}) => {
  const boundedLimit = Math.min(
    Math.max(1, Number(limit) || 25),
    MAX_VEHICLE_PAGE_SIZE,
  );
  const boundedPage = Math.max(1, Number(page) || 1);
  const filter = {};
  if (status) filter.status = status;
  if (search?.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { registrationNumber: { $regex: escaped, $options: "i" } },
      { make: { $regex: escaped, $options: "i" } },
      { model: { $regex: escaped, $options: "i" } },
    ];
  }
  const [vehicles, total, policy] = await Promise.all([
    Vehicle.find(filter)
      .select("-registrationNumberNormalized")
      .populate({
        path: "primaryAssignedEmployeeId",
        populate: { path: "userId", select: "firstName lastName" },
      })
      .sort({ registrationNumber: 1, _id: 1 })
      .skip((boundedPage - 1) * boundedLimit)
      .limit(boundedLimit),
    Vehicle.countDocuments(filter),
    getPolicy(),
  ]);
  return {
    vehicles: await attachServiceSummary(vehicles, policy),
    pagination: {
      page: boundedPage,
      limit: boundedLimit,
      total,
      totalPages: Math.ceil(total / boundedLimit),
    },
  };
};

export const getVehicleDetails = async (vehicleId) => {
  const [vehicle, assignments, services, sessions, reminders, policy] =
    await Promise.all([
      Vehicle.findById(vehicleId)
        .select("-registrationNumberNormalized")
        .populate({
          path: "primaryAssignedEmployeeId",
          populate: { path: "userId", select: "firstName lastName email" },
        }),
      VehicleAssignment.find({ vehicleId })
        .populate({
          path: "employeeId",
          populate: { path: "userId", select: "firstName lastName email" },
        })
        .populate("assignedBy", "firstName lastName")
        .sort({ assignedAt: -1, _id: -1 }),
      VehicleService.find({ vehicleId })
        .populate("recordedBy", "firstName lastName")
        .populate("timelineReviewedBy", "firstName lastName")
        .populate("timelineReviewHistory.reviewedBy", "firstName lastName")
        .sort({
          serviceOdometerKm: -1,
          serviceDate: -1,
          createdAt: -1,
          _id: -1,
        }),
      VehicleUsageSession.find({ vehicleId })
        .sort({ startedAt: -1, _id: -1 })
        .limit(50),
      VehicleServiceReminder.find({ vehicleId }).sort({
        updatedAt: -1,
        _id: -1,
      }),
      getPolicy(),
    ]);
  if (!vehicle)
    throw vehicleError(404, "RESOURCE_NOT_FOUND", "Vehicle not found");
  const latest = getLatestOilService(services);
  const service = getServiceStatus({
    currentOdometerKm: vehicle.currentOdometerKm,
    baselineOdometerKm: latest?.serviceOdometerKm ?? vehicle.initialOdometerKm,
    intervalKm: policy?.intervalKm,
  });
  const serviceBaselineReviewRequired = services.some(
    (record) => record.timelineReviewRequired,
  );
  return {
    ...vehicle.toObject(),
    serviceStatus: service.status,
    nextServiceOdometerKm: service.nextServiceOdometerKm,
    assignments,
    services,
    mileageHistory: sessions,
    reminders,
    policyConfigured: Boolean(policy),
    serviceBaselineReviewRequired,
  };
};

export const createVehicle = async ({ input, actorId }) => {
  const registration = normalizeRegistrationNumber(input.registrationNumber);
  requireWholeKilometres(input.initialOdometerKm, "Initial odometer");
  try {
    return await withTransaction(async (session) => {
      let employee = null;
      if (input.primaryAssignedEmployeeId) {
        employee = await getActiveEmployeeById(
          input.primaryAssignedEmployeeId,
          session,
        );
        const employeeAssignment = await VehicleAssignment.findOne({
          employeeId: employee._id,
          unassignedAt: null,
        }).session(session);
        if (employeeAssignment) {
          throw vehicleError(
            409,
            "EMPLOYEE_ALREADY_ASSIGNED",
            "Employee already has a primary bike assignment",
          );
        }
      }
      const [vehicle] = await Vehicle.create(
        [
          {
            registrationNumber: registration.display,
            registrationNumberNormalized: registration.normalized,
            make: input.make.trim(),
            model: input.model.trim(),
            initialOdometerKm: input.initialOdometerKm,
            currentOdometerKm: input.initialOdometerKm,
            primaryAssignedEmployeeId: null,
            status: "ACTIVE",
            serviceStateRevision: 0,
            purchaseDate: input.purchaseDate
              ? new Date(`${input.purchaseDate}T00:00:00.000Z`)
              : null,
            notes: input.notes ?? "",
            createdBy: actorId,
            updatedBy: actorId,
          },
        ],
        { session },
      );
      if (employee) {
        await casVehicle(vehicle, 0, session, {
          primaryAssignedEmployeeId: employee._id,
          updatedBy: actorId,
        });
        await VehicleAssignment.create(
          [
            {
              vehicleId: vehicle._id,
              employeeId: employee._id,
              assignedBy: actorId,
            },
          ],
          { session },
        );
        return getVehicle(vehicle._id, session);
      }
      return vehicle;
    });
  } catch (error) {
    if (isDuplicate(error)) {
      throw vehicleError(
        409,
        "DUPLICATE_REGISTRATION",
        "A bike with this registration already exists",
      );
    }
    throw error;
  }
};

export const updateVehicle = async ({ vehicleId, input, actorId }) => {
  const vehicle = await getVehicle(vehicleId);
  if (input.registrationNumber !== undefined) {
    const registration = normalizeRegistrationNumber(input.registrationNumber);
    vehicle.registrationNumber = registration.display;
    vehicle.registrationNumberNormalized = registration.normalized;
  }
  for (const key of ["make", "model", "notes"]) {
    if (input[key] !== undefined) vehicle[key] = input[key];
  }
  if (input.purchaseDate !== undefined) {
    vehicle.purchaseDate = input.purchaseDate
      ? new Date(`${input.purchaseDate}T00:00:00.000Z`)
      : null;
  }
  vehicle.updatedBy = actorId;
  try {
    await vehicle.save();
  } catch (error) {
    if (isDuplicate(error)) {
      throw vehicleError(
        409,
        "DUPLICATE_REGISTRATION",
        "A bike with this registration already exists",
      );
    }
    throw error;
  }
  return vehicle;
};

const assertNoActiveSession = async (vehicleId, employeeId, session) => {
  const active = await hasActiveSession(vehicleId, employeeId, session);
  if (active)
    throw vehicleError(
      409,
      "ACTIVE_SESSION_EXISTS",
      "Resolve the active mileage session first",
    );
};

const rebuildVehicleOdometerTimeline = async (
  vehicle,
  session,
  reviewedServiceId = null,
) => {
  const sessions = await VehicleUsageSession.find({
    vehicleId: vehicle._id,
    status: "COMPLETED",
  })
    .sort({ businessDate: 1, startedAt: 1, _id: 1 })
    .session(session);
  const services = await VehicleService.find({
    vehicleId: vehicle._id,
    serviceType: "OIL_CHANGE",
  })
    .sort({ serviceDate: 1, createdAt: 1, _id: 1 })
    .session(session);
  const previousValidSessions = [];
  const verifiedReadings = [vehicle.initialOdometerKm];
  let precedingVerifiedKm = vehicle.initialOdometerKm;
  let hasSessionReviewConflict = false;

  for (const usage of sessions) {
    const precedingServiceReadings = services
      .filter(
        (service) =>
          service.timelineReviewRequired !== true &&
          toAsiaKolkataDateKey(service.serviceDate) < usage.businessDate,
      )
      .map((service) => service.serviceOdometerKm);
    const precedingReadingKm = Math.max(
      precedingVerifiedKm,
      ...precedingServiceReadings,
    );
    const startKm = usage.startOdometerKm;
    const endKm = usage.endOdometerKm;
    let conflictReason = "";
    if (!Number.isSafeInteger(startKm) || !Number.isSafeInteger(endKm)) {
      conflictReason = "Session contains a non-whole-kilometre reading";
    } else if (endKm < startKm) {
      conflictReason = "Session ending reading is below its starting reading";
    } else if (startKm < precedingReadingKm) {
      conflictReason = `Session starting reading ${startKm} KM is below the preceding verified reading ${precedingReadingKm} KM`;
    }
    if (conflictReason) hasSessionReviewConflict = true;

    const update = {
      distanceKm: Number.isSafeInteger(startKm) && Number.isSafeInteger(endKm) && endKm >= startKm
        ? endKm - startKm
        : usage.distanceKm,
      timelineReviewRequired: Boolean(conflictReason),
      timelineReviewReason: conflictReason,
    };
    const changed = await VehicleUsageSession.updateOne(
      { _id: usage._id, vehicleId: vehicle._id, status: "COMPLETED" },
      { $set: update },
      { session, runValidators: true },
    );
    if (changed.matchedCount !== 1) {
      throw vehicleError(409, "REVISION_CONFLICT", "A mileage session changed during odometer reconciliation");
    }

    if (conflictReason) continue;
    previousValidSessions.push({
      ...(usage.toObject?.() ?? usage),
      timelineReviewRequired: false,
    });
    verifiedReadings.push(startKm, endKm);
    precedingVerifiedKm = endKm;
  }

  let precedingServiceKm = vehicle.initialOdometerKm;
  let hasServiceReviewConflict = false;
  const validServiceReadings = [];
  for (const service of services) {
    const serviceDateKey = toAsiaKolkataDateKey(service.serviceDate);
    const chronologicalSessions = sessions.filter(
      (usage) =>
        Number.isSafeInteger(usage.startOdometerKm) &&
        Number.isSafeInteger(usage.endOdometerKm),
    );
    const priorSession = chronologicalSessions
      .filter((usage) => usage.businessDate < serviceDateKey)
      .at(-1);
    const nextSession = chronologicalSessions.find(
      (usage) => usage.businessDate > serviceDateKey,
    );
    const conflictsWithSession =
      (priorSession && service.serviceOdometerKm < priorSession.endOdometerKm) ||
      (nextSession && service.serviceOdometerKm > nextSession.startOdometerKm);
    const conflictsWithService = service.serviceOdometerKm < precedingServiceKm;
    const conflictReason = conflictsWithSession
      ? "Service odometer conflicts with the corrected mileage timeline"
      : conflictsWithService
        ? "Service odometer decreases against a later service event"
        : "";

    const explicitlyReviewed =
      reviewedServiceId && String(service._id) === String(reviewedServiceId);
    if (conflictReason && !explicitlyReviewed) {
      hasServiceReviewConflict = true;
      await VehicleService.updateOne(
        { _id: service._id, vehicleId: vehicle._id },
        { $set: { timelineReviewRequired: true, timelineReviewReason: conflictReason } },
        { session },
      );
      continue;
    }
    if (!service.timelineReviewRequired || explicitlyReviewed) {
      precedingServiceKm = service.serviceOdometerKm;
      validServiceReadings.push(service);
      verifiedReadings.push(service.serviceOdometerKm);
    } else {
      hasServiceReviewConflict = true;
    }
  }

  const currentReadingCorrections = await VehicleOdometerCorrection.find({
    vehicleId: vehicle._id,
    usageSessionId: null,
  }).session(session);
  for (const correction of currentReadingCorrections) {
    verifiedReadings.push(correction.correctedOdometerKm);
  }

  const currentOdometerKm = Math.max(...verifiedReadings);
  return {
    currentOdometerKm,
    hasServiceReviewConflict,
    hasTimelineReviewConflict:
      hasSessionReviewConflict || hasServiceReviewConflict,
    validServiceCount: validServiceReadings.length,
  };
};

export const changeVehicleStatus = async ({
  vehicleId,
  status,
  expectedRevision,
  actorId,
}) =>
  withTransaction(async (session) => {
    const vehicle = await getVehicle(vehicleId, session);
    if (vehicle.status === status) return vehicle;
    if (status === "INACTIVE") {
      await assertNoActiveSession(vehicle._id, null, session);
      const assignment = await VehicleAssignment.findOne({
        vehicleId: vehicle._id,
        unassignedAt: null,
      }).session(session);
      await casVehicle(vehicle, expectedRevision, session, {
        status,
        primaryAssignedEmployeeId: null,
        updatedBy: actorId,
      });
      if (assignment) {
        assignment.unassignedAt = new Date();
        assignment.reason = assignment.reason || "Vehicle deactivated";
        await assignment.save({ session });
      }
    } else {
      await casVehicle(vehicle, expectedRevision, session, {
        status,
        updatedBy: actorId,
      });
    }
    return getVehicle(vehicleId, session);
  });

export const assignVehicle = async ({
  vehicleId,
  employeeId,
  expectedRevision,
  reason = "",
  actorId,
}) => {
  try {
    return await withTransaction(async (session) => {
      const vehicle = await getVehicle(vehicleId, session);
      if (vehicle.status !== "ACTIVE")
        throw vehicleError(
          409,
          "VEHICLE_NOT_ACTIVE",
          "Only active bikes can be assigned",
        );
      const employee = await getActiveEmployeeById(employeeId, session);
      await assertNoActiveSession(vehicle._id, null, session);
      const vehicleAssignment = await VehicleAssignment.findOne({
        vehicleId: vehicle._id,
        unassignedAt: null,
      }).session(session);
      const employeeAssignment = await VehicleAssignment.findOne({
        employeeId: employee._id,
        unassignedAt: null,
      }).session(session);
      if (vehicleAssignment)
        throw vehicleError(
          409,
          "VEHICLE_ALREADY_ASSIGNED",
          "Bike must be unassigned before assigning another employee",
        );
      if (employeeAssignment)
        throw vehicleError(
          409,
          "EMPLOYEE_ALREADY_ASSIGNED",
          "Employee already has a primary bike assignment",
        );
      await casVehicle(vehicle, expectedRevision, session, {
        primaryAssignedEmployeeId: employee._id,
        updatedBy: actorId,
      });
      const [assignment] = await VehicleAssignment.create(
        [
          {
            vehicleId: vehicle._id,
            employeeId: employee._id,
            assignedBy: actorId,
            reason,
          },
        ],
        { session },
      );
      return assignment;
    });
  } catch (error) {
    if (isDuplicate(error))
      throw vehicleError(
        409,
        "ASSIGNMENT_CONFLICT",
        "Bike or employee already has an active assignment",
      );
    throw error;
  }
};

export const unassignVehicle = async ({
  vehicleId,
  expectedRevision,
  reason = "",
  actorId,
}) =>
  withTransaction(async (session) => {
    const vehicle = await getVehicle(vehicleId, session);
    const assignment = await VehicleAssignment.findOne({
      vehicleId: vehicle._id,
      unassignedAt: null,
    }).session(session);
    if (!assignment)
      throw vehicleError(
        404,
        "RESOURCE_NOT_FOUND",
        "Active assignment not found",
      );
    await assertNoActiveSession(vehicle._id, null, session);
    await casVehicle(vehicle, expectedRevision, session, {
      primaryAssignedEmployeeId: null,
      updatedBy: actorId,
    });
    assignment.unassignedAt = new Date();
    assignment.reason = reason;
    await assignment.save({ session });
    return assignment;
  });

export const transferVehicleAssignment = async ({
  employeeId,
  sourceVehicleId,
  targetVehicleId,
  expectedSourceRevision,
  expectedTargetRevision,
  reason = "",
  actorId,
}) => {
  if (idString(sourceVehicleId) === idString(targetVehicleId)) {
    throw vehicleError(
      400,
      "VALIDATION_ERROR",
      "Source and target bikes must differ",
    );
  }
  try {
    return await withTransaction(async (session) => {
      const source = await getVehicle(sourceVehicleId, session);
      const target = await getVehicle(targetVehicleId, session);
      const employee = await getActiveEmployeeById(employeeId, session);
      if (source.status !== "ACTIVE" || target.status !== "ACTIVE") {
        throw vehicleError(
          409,
          "VEHICLE_NOT_ACTIVE",
          "Both bikes must be active",
        );
      }
      await assertNoActiveSession(source._id, null, session);
      await assertNoActiveSession(target._id, null, session);
      const sourceAssignment = await VehicleAssignment.findOne({
        vehicleId: source._id,
        employeeId: employee._id,
        unassignedAt: null,
      }).session(session);
      const targetAssignment = await VehicleAssignment.findOne({
        vehicleId: target._id,
        unassignedAt: null,
      }).session(session);
      const employeeAssignment = await VehicleAssignment.findOne({
        employeeId: employee._id,
        unassignedAt: null,
      }).session(session);
      if (
        !sourceAssignment ||
        !employeeAssignment ||
        idString(employeeAssignment.vehicleId) !== idString(source._id)
      ) {
        throw vehicleError(
          409,
          "ASSIGNMENT_CONFLICT",
          "Employee does not have the expected source-bike assignment",
        );
      }
      if (targetAssignment)
        throw vehicleError(
          409,
          "VEHICLE_ALREADY_ASSIGNED",
          "Target bike is already assigned; unassign it first",
        );

      await casVehicle(source, expectedSourceRevision, session, {
        primaryAssignedEmployeeId: null,
        updatedBy: actorId,
      });
      await casVehicle(target, expectedTargetRevision, session, {
        primaryAssignedEmployeeId: employee._id,
        updatedBy: actorId,
      });
      sourceAssignment.unassignedAt = new Date();
      sourceAssignment.reason = reason || "Transferred to another bike";
      await sourceAssignment.save({ session });
      const [newAssignment] = await VehicleAssignment.create(
        [
          {
            vehicleId: target._id,
            employeeId: employee._id,
            assignedBy: actorId,
            reason,
          },
        ],
        { session },
      );
      return newAssignment;
    });
  } catch (error) {
    if (isDuplicate(error))
      throw vehicleError(
        409,
        "ASSIGNMENT_CONFLICT",
        "Assignment changed concurrently; refresh and retry",
      );
    throw error;
  }
};

export const listEligibleVehicles = async (user) => {
  const employee = await getActiveEmployeeByUser(user);
  if (await hasActiveSession(null, employee._id)) return [];
  const primaryAssignment = await VehicleAssignment.findOne({
    employeeId: employee._id,
    unassignedAt: null,
  }).select("vehicleId");
  const activeVehicleIds = await VehicleUsageSession.distinct("vehicleId", {
    status: "IN_PROGRESS",
  });
  const vehicles = await Vehicle.find({
    status: "ACTIVE",
    _id: { $nin: activeVehicleIds },
  })
    .select("-registrationNumberNormalized")
  const policy = await getPolicy();
  const summarized = await attachServiceSummary(vehicles, policy);
  return summarized.map((vehicle) => ({
    ...vehicle,
    primaryAssignedToMe:
      String(vehicle._id) === String(primaryAssignment?.vehicleId ?? ""),
  })).sort((left, right) =>
    Number(right.primaryAssignedToMe) - Number(left.primaryAssignedToMe) ||
    left.registrationNumber.localeCompare(right.registrationNumber) ||
    String(left._id).localeCompare(String(right._id)),
  );
};

export const getCurrentEmployeeSession = async (user) => {
  const employee = await getActiveEmployeeByUser(user);
  const session = await VehicleUsageSession.findOne({
    employeeId: employee._id,
    status: "IN_PROGRESS",
  }).populate({
    path: "vehicleId",
    select: "registrationNumber currentOdometerKm status serviceStateRevision",
  });
  return session;
};

export const startUsageSession = async ({
  user,
  vehicleId,
  startingOdometerKm,
  expectedVehicleRevision,
}) => {
  requireWholeKilometres(startingOdometerKm, "Starting odometer");
  try {
    return await withTransaction(async (session) => {
      const employee = await getActiveEmployeeByUser(user, session);
      const vehicle = await getVehicle(vehicleId, session);
      if (vehicle.status !== "ACTIVE")
        throw vehicleError(409, "VEHICLE_NOT_ACTIVE", "Bike is not active");
      await assertNoActiveSession(vehicle._id, employee._id, session);
      if (startingOdometerKm < vehicle.currentOdometerKm) {
        throw vehicleError(
          409,
          "ODOMETER_MISMATCH",
          "Starting odometer cannot be below the current verified vehicle odometer",
        );
      }
      await casVehicle(
        vehicle,
        expectedVehicleRevision,
        session,
        startingOdometerKm > vehicle.currentOdometerKm
          ? { currentOdometerKm: startingOdometerKm }
          : {},
      );
      const [usage] = await VehicleUsageSession.create(
        [
          {
            vehicleId: vehicle._id,
            employeeId: employee._id,
            employeeNameSnapshot: [
              employee.userId.firstName,
              employee.userId.lastName,
            ]
              .filter(Boolean)
              .join(" "),
            employeeCodeSnapshot: employee.employeeCode,
            vehicleRegistrationSnapshot: vehicle.registrationNumber,
            businessDate: toAsiaKolkataDateKey(),
            startOdometerKm: startingOdometerKm,
            startedAt: new Date(),
            status: "IN_PROGRESS",
          },
        ],
        { session },
      );
      return usage;
    });
  } catch (error) {
    if (isDuplicate(error))
      throw vehicleError(
        409,
        "ACTIVE_SESSION_EXISTS",
        "Employee or bike already has an active session",
      );
    throw error;
  }
};

export const completeUsageSession = async ({
  sessionId,
  user,
  endingOdometerKm,
  expectedVehicleRevision,
}) => {
  requireWholeKilometres(endingOdometerKm, "Ending odometer");
  return withTransaction(async (mongoSession) => {
    const employee = await getActiveEmployeeByUser(user, mongoSession);
    const usage =
      await VehicleUsageSession.findById(sessionId).session(mongoSession);
    if (!usage)
      throw vehicleError(
        404,
        "RESOURCE_NOT_FOUND",
        "Mileage session not found",
      );
    if (idString(usage.employeeId) !== idString(employee._id)) {
      throw vehicleError(
        403,
        "PERMISSION_DENIED",
        "Only the employee who started the session can complete it",
      );
    }
    if (usage.status !== "IN_PROGRESS")
      throw vehicleError(
        409,
        "ACTIVE_SESSION_EXISTS",
        "Mileage session is no longer active",
      );
    if (endingOdometerKm < usage.startOdometerKm) {
      throw vehicleError(
        409,
        "ODOMETER_CONFLICT",
        "Ending odometer cannot be below the starting odometer",
      );
    }
    const vehicle = await getVehicle(usage.vehicleId, mongoSession);
    if (vehicle.currentOdometerKm !== usage.startOdometerKm) {
      throw vehicleError(
        409,
        "ODOMETER_CONFLICT",
        "Vehicle odometer changed while the session was active",
      );
    }
    await casVehicle(vehicle, expectedVehicleRevision, mongoSession, {
      currentOdometerKm: endingOdometerKm,
    });
    const completed = await VehicleUsageSession.findOneAndUpdate(
      { _id: usage._id, employeeId: employee._id, status: "IN_PROGRESS" },
      {
        $set: {
          endOdometerKm: endingOdometerKm,
          distanceKm: endingOdometerKm - usage.startOdometerKm,
          endedAt: new Date(),
          status: "COMPLETED",
        },
      },
      { new: true, session: mongoSession, runValidators: true },
    );
    if (!completed)
      throw vehicleError(
        409,
        "ACTIVE_SESSION_EXISTS",
        "Mileage session was completed by another request",
      );
    return completed;
  });
};

export const recoverUsageSession = async ({
  sessionId,
  action,
  verifiedEndOdometerKm,
  expectedVehicleRevision,
  reason,
  actorId,
}) =>
  withTransaction(async (session) => {
    const usage =
      await VehicleUsageSession.findById(sessionId).session(session);
    if (!usage)
      throw vehicleError(
        404,
        "RESOURCE_NOT_FOUND",
        "Mileage session not found",
      );
    if (usage.status !== "IN_PROGRESS")
      throw vehicleError(
        409,
        "ACTIVE_SESSION_EXISTS",
        "Mileage session is no longer active",
      );
    const vehicle = await getVehicle(usage.vehicleId, session);
    if (vehicle.currentOdometerKm !== usage.startOdometerKm) {
      throw vehicleError(
        409,
        "ODOMETER_CONFLICT",
        "Vehicle odometer no longer matches the session opening reading",
      );
    }
    if (
      action === "CANCELLED" &&
      verifiedEndOdometerKm !== usage.startOdometerKm
    ) {
      throw vehicleError(
        409,
        "ODOMETER_CONFLICT",
        "A session can be cancelled only when no movement is verified",
      );
    }
    if (
      action === "RECOVERED_COMPLETED" &&
      verifiedEndOdometerKm < usage.startOdometerKm
    ) {
      throw vehicleError(
        409,
        "ODOMETER_CONFLICT",
        "Verified closing odometer cannot be below the opening reading",
      );
    }
    const vehicleUpdate =
      action === "RECOVERED_COMPLETED"
        ? {
            currentOdometerKm: verifiedEndOdometerKm,
          }
        : {};
    await casVehicle(vehicle, expectedVehicleRevision, session, vehicleUpdate);
    const completed = action === "RECOVERED_COMPLETED";
    const updated = await VehicleUsageSession.findOneAndUpdate(
      { _id: usage._id, status: "IN_PROGRESS" },
      {
        $set: {
          status: completed ? "COMPLETED" : "CANCELLED",
          endOdometerKm: completed ? verifiedEndOdometerKm : null,
          distanceKm: completed
            ? verifiedEndOdometerKm - usage.startOdometerKm
            : null,
          endedAt: new Date(),
          recoveryAction: action,
          recoveryReason: reason,
          recoveredBy: actorId,
          recoveredAt: new Date(),
          verifiedEndOdometerKm,
        },
      },
      { new: true, session, runValidators: true },
    );
    if (!updated)
      throw vehicleError(
        409,
        "ACTIVE_SESSION_EXISTS",
        "Mileage session changed concurrently",
      );
    return updated;
  });

export const getUsageHistory = async ({
  user,
  admin = false,
  employeeId,
  vehicleId,
  fromDate,
  toDate,
  page = 1,
  limit = 25,
}) => {
  const boundedLimit = Math.min(
    Math.max(1, Number(limit) || 25),
    MAX_VEHICLE_PAGE_SIZE,
  );
  const boundedPage = Math.max(1, Number(page) || 1);
  const filter = {};
  if (!admin) {
    const employee = await getActiveEmployeeByUser(user);
    filter.employeeId = employee._id;
  } else {
    if (employeeId) filter.employeeId = employeeId;
    if (vehicleId) filter.vehicleId = vehicleId;
  }
  if (fromDate && toDate) {
    filter.businessDate = { $gte: fromDate, $lte: toDate };
  }
  const [sessions, total] = await Promise.all([
    VehicleUsageSession.find(filter)
      .populate("vehicleId", "registrationNumber status")
      .sort({ businessDate: -1, vehicleId: 1, createdAt: -1, _id: -1 })
      .skip((boundedPage - 1) * boundedLimit)
      .limit(boundedLimit),
    VehicleUsageSession.countDocuments(filter),
  ]);
  return {
    sessions,
    pagination: {
      page: boundedPage,
      limit: boundedLimit,
      total,
      totalPages: Math.ceil(total / boundedLimit),
    },
  };
};

export const listVehicleServices = async ({
  vehicleId,
  page = 1,
  limit = 25,
  fromDate,
  toDate,
}) => {
  await getVehicle(vehicleId);
  const boundedLimit = Math.min(
    Math.max(1, Number(limit) || 25),
    MAX_VEHICLE_PAGE_SIZE,
  );
  const boundedPage = Math.max(1, Number(page) || 1);
  const filter = {
    vehicleId,
    ...(fromDate && toDate
      ? {
          serviceDate: {
            $gte: new Date(`${fromDate}T00:00:00.000Z`),
            $lte: new Date(`${toDate}T23:59:59.999Z`),
          },
        }
      : {}),
  };
  const [services, total] = await Promise.all([
    VehicleService.find(filter)
      .populate("recordedBy", "firstName lastName")
      .populate("timelineReviewedBy", "firstName lastName")
      .populate("timelineReviewHistory.reviewedBy", "firstName lastName")
      .sort({ serviceOdometerKm: -1, serviceDate: -1, createdAt: -1, _id: -1 })
      .skip((boundedPage - 1) * boundedLimit)
      .limit(boundedLimit),
    VehicleService.countDocuments(filter),
  ]);
  return {
    services,
    pagination: {
      page: boundedPage,
      limit: boundedLimit,
      total,
      totalPages: Math.ceil(total / boundedLimit),
    },
  };
};

export const recordVehicleService = async ({ vehicleId, input, actorId }) => {
  const serviceDate = new Date(`${input.serviceDate}T00:00:00.000Z`);
  if (isFutureAsiaKolkataDate(input.serviceDate)) {
    throw vehicleError(
      400,
      "VALIDATION_ERROR",
      "Service date cannot be in the future",
    );
  }
  requireWholeKilometres(input.serviceOdometerKm, "Service odometer");
  return withTransaction(async (session) => {
    const vehicle = await getVehicle(vehicleId, session);
    const policy = await getPolicy(session);
    if (
      input.serviceOdometerKm < vehicle.initialOdometerKm ||
      input.serviceOdometerKm > vehicle.currentOdometerKm
    ) {
      throw vehicleError(
        409,
        "INVALID_SERVICE_ODOMETER",
        "Service odometer must be between the initial and current verified readings",
      );
    }
    const previousBaseline = await getBaseline(vehicle, session);
    const [service] = await VehicleService.create(
      [
        {
          vehicleId: vehicle._id,
          serviceType: input.serviceType ?? "OIL_CHANGE",
          serviceDate,
          serviceOdometerKm: input.serviceOdometerKm,
          notes: input.notes ?? "",
          recordedBy: actorId,
        },
      ],
      { session },
    );
    await casVehicle(vehicle, input.expectedVehicleRevision, session, {});
    const nextBaseline = await getBaseline(vehicle, session);
    const baselineChanged =
      idString(nextBaseline.serviceId ?? "INITIAL") !==
      idString(previousBaseline.serviceId ?? "INITIAL");
    if (baselineChanged) {
      const oldCycleKey = cycleKeyFor(vehicle._id, previousBaseline.serviceId);
      await VehicleServiceReminder.updateOne(
        {
          vehicleId: vehicle._id,
          cycleKey: oldCycleKey,
          lifecycleStatus: { $in: ["ACTIVE", "SUPERSEDED"] },
        },
        {
          $set: {
            lifecycleStatus: "RESOLVED",
            resolvedByServiceId: service._id,
            resolvedAt: new Date(),
          },
        },
        { session },
      );
    }
    return {
      service,
      baseline: nextBaseline,
      policyConfigured: Boolean(policy),
      nextServiceOdometerKm: policy
        ? nextBaseline.odometerKm + policy.intervalKm
        : null,
    };
  });
};

export const createOdometerCorrection = async ({
  vehicleId,
  correctedOdometerKm,
  expectedVehicleRevision,
  reason,
  actorId,
  usageSessionId,
  correctedField,
}) => {
  requireWholeKilometres(correctedOdometerKm, "Corrected odometer");
  return withTransaction(async (session) => {
    const vehicle = await getVehicle(vehicleId, session);
    await assertNoActiveSession(vehicle._id, null, session);
    let previousOdometerKm = vehicle.currentOdometerKm;
    let timelineResult = null;
    let targetSession = null;
    if (usageSessionId) {
      targetSession = await VehicleUsageSession.findOne({
        _id: usageSessionId,
        vehicleId: vehicle._id,
        status: "COMPLETED",
      }).session(session);
      if (!targetSession) {
        throw vehicleError(404, "RESOURCE_NOT_FOUND", "Completed mileage session not found");
      }
      if (!(["START", "END"].includes(correctedField))) {
        throw vehicleError(400, "VALIDATION_ERROR", "Corrected field must be START or END");
      }
      const field = correctedField === "START" ? "startOdometerKm" : "endOdometerKm";
      previousOdometerKm = targetSession[field];
      if (correctedOdometerKm < vehicle.initialOdometerKm) {
        throw vehicleError(409, "ODOMETER_CONFLICT", "Corrected reading cannot be below the initial verified odometer");
      }
      if (correctedField === "START" && correctedOdometerKm > targetSession.endOdometerKm) {
        throw vehicleError(409, "ODOMETER_CONFLICT", "Corrected starting reading cannot exceed the session ending reading");
      }
      if (correctedField === "END" && correctedOdometerKm < targetSession.startOdometerKm) {
        throw vehicleError(409, "ODOMETER_CONFLICT", "Corrected ending reading cannot be below the session starting reading");
      }
    } else if (correctedOdometerKm < vehicle.currentOdometerKm) {
      throw vehicleError(409, "ODOMETER_CONFLICT", "Current odometer correction cannot decrease the verified reading; select a historical session reading instead");
    }

    const [correction] = await VehicleOdometerCorrection.create(
      [
        {
          vehicleId: vehicle._id,
          usageSessionId: targetSession?._id ?? null,
          correctedField: targetSession ? correctedField : "CURRENT",
          previousOdometerKm,
          correctedOdometerKm,
          reason,
          correctedBy: actorId,
        },
      ],
      { session },
    );
    if (targetSession) {
      const field = correctedField === "START" ? "startOdometerKm" : "endOdometerKm";
      const endOdometerKm = correctedField === "END" ? correctedOdometerKm : targetSession.endOdometerKm;
      const startOdometerKm = correctedField === "START" ? correctedOdometerKm : targetSession.startOdometerKm;
      const changed = await VehicleUsageSession.updateOne(
        { _id: targetSession._id, vehicleId: vehicle._id, status: "COMPLETED", [field]: previousOdometerKm },
        {
          $set: {
            [field]: correctedOdometerKm,
            distanceKm: endOdometerKm - startOdometerKm,
          },
        },
        { session, runValidators: true },
      );
      if (changed.matchedCount !== 1) {
        throw vehicleError(409, "REVISION_CONFLICT", "Mileage session changed during correction");
      }
      timelineResult = await rebuildVehicleOdometerTimeline(vehicle, session);
    }
    await casVehicle(vehicle, expectedVehicleRevision, session, {
      currentOdometerKm: timelineResult?.currentOdometerKm ?? correctedOdometerKm,
      updatedBy: actorId,
    });
    return {
      ...(correction.toObject?.() ?? correction),
      timelineReviewRequired:
        timelineResult?.hasTimelineReviewConflict ?? false,
      serviceBaselineReviewRequired:
        timelineResult?.hasServiceReviewConflict ?? false,
    };
  });
};

export const reviewVehicleServiceConflict = async ({
  vehicleId,
  serviceId,
  expectedVehicleRevision,
  confirmReviewed,
  reason,
  actorId,
}) => {
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";
  if (confirmReviewed !== true || !normalizedReason) {
    throw vehicleError(
      400,
      "VALIDATION_ERROR",
      "Explicit review confirmation and a reason are required",
    );
  }

  return withTransaction(async (session) => {
    const vehicle = await getVehicle(vehicleId, session);
    const service = await VehicleService.findOne({
      _id: serviceId,
      vehicleId: vehicle._id,
      serviceType: "OIL_CHANGE",
    }).session(session);
    if (!service)
      throw vehicleError(404, "RESOURCE_NOT_FOUND", "Service record not found");
    if (!service.timelineReviewRequired) {
      throw vehicleError(
        409,
        "SERVICE_REVIEW_NOT_REQUIRED",
        "Service record is not awaiting timeline review",
      );
    }

    const reviewedAt = new Date();
    const reviewed = await VehicleService.updateOne(
      { _id: service._id, vehicleId: vehicle._id, timelineReviewRequired: true },
      {
        $set: {
          timelineReviewRequired: false,
          timelineReviewReason: "",
          timelineReviewedBy: actorId,
          timelineReviewedAt: reviewedAt,
          timelineReviewResolutionReason: normalizedReason,
        },
        $push: {
          timelineReviewHistory: {
            reviewedBy: actorId,
            reviewedAt,
            reason: normalizedReason,
          },
        },
      },
      { session, runValidators: true },
    );
    if (reviewed.matchedCount !== 1) {
      throw vehicleError(
        409,
        "REVISION_CONFLICT",
        "Service record changed during review",
      );
    }

    const timelineResult = await rebuildVehicleOdometerTimeline(
      vehicle,
      session,
      service._id,
    );
    await casVehicle(vehicle, expectedVehicleRevision, session, {
      currentOdometerKm: timelineResult.currentOdometerKm,
      updatedBy: actorId,
    });
    const updatedService = await VehicleService.findById(service._id).session(
      session,
    );
    return {
      service: updatedService ?? {
        ...service.toObject?.(),
        timelineReviewRequired: false,
        timelineReviewReason: "",
        timelineReviewedBy: actorId,
        timelineReviewedAt: reviewedAt,
        timelineReviewResolutionReason: normalizedReason,
      },
      currentOdometerKm: timelineResult.currentOdometerKm,
      timelineReviewRequired: timelineResult.hasTimelineReviewConflict,
      serviceBaselineReviewRequired: timelineResult.hasServiceReviewConflict,
    };
  });
};

export const listOdometerCorrections = async ({
  vehicleId,
  page = 1,
  limit = 25,
  fromDate,
  toDate,
}) => {
  const boundedLimit = Math.min(
    Math.max(1, Number(limit) || 25),
    MAX_VEHICLE_PAGE_SIZE,
  );
  const boundedPage = Math.max(1, Number(page) || 1);
  const filter = {
    vehicleId,
    ...(fromDate && toDate
      ? {
          correctedAt: {
            $gte: new Date(`${fromDate}T00:00:00.000Z`),
            $lte: new Date(`${toDate}T23:59:59.999Z`),
          },
        }
      : {}),
  };
  const [corrections, total] = await Promise.all([
    VehicleOdometerCorrection.find(filter)
      .populate("correctedBy", "firstName lastName")
      .sort({ correctedAt: -1, _id: -1 })
      .skip((boundedPage - 1) * boundedLimit)
      .limit(boundedLimit),
    VehicleOdometerCorrection.countDocuments(filter),
  ]);
  return {
    corrections,
    pagination: {
      page: boundedPage,
      limit: boundedLimit,
      total,
      totalPages: Math.ceil(total / boundedLimit),
    },
  };
};

export const buildServiceStatus = async (vehicle, session) => {
  const baseline = await getBaseline(vehicle, session);
  const policy = await getPolicy(session);
  return {
    ...getServiceStatus({
      currentOdometerKm: vehicle.currentOdometerKm,
      baselineOdometerKm: baseline.odometerKm,
      intervalKm: policy?.intervalKm,
    }),
    baseline,
    policy,
  };
};

export const getCycleKey = cycleKeyFor;
export const withVehicleTransaction = withTransaction;
export const resolveActiveEmployeeById = getActiveEmployeeById;
export const resolveActiveEmployeeByUser = getActiveEmployeeByUser;
