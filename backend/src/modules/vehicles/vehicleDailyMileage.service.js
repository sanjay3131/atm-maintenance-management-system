import mongoose from "mongoose";
import Employee from "../employees/employee.model.js";
import Vehicle from "./vehicle.model.js";
import VehicleDailyMileage from "./vehicleDailyMileage.model.js";
import VehicleUsageSession from "./vehicleUsageSession.model.js";
import { publishVehicleEventSafely } from "../../realtime/domain-events.js";
import {
  casVehicle,
  getVehicle,
  hasActiveSession,
  resolveActiveEmployeeById,
  resolveActiveEmployeeByUser,
  withVehicleTransaction,
} from "./vehicle.service.js";
import { vehicleError } from "./vehicle.errors.js";
import { requireWholeKilometres, toAsiaKolkataDateKey } from "./vehicle.utils.js";

const idString = (value) => String(value?._id ?? value);
const isDuplicate = (error) => error?.code === 11000;
const employeeSnapshot = (employee) => ({
  employeeId: employee._id,
  employeeNameSnapshot: [employee.userId.firstName, employee.userId.lastName]
    .filter(Boolean)
    .join(" "),
  employeeCodeSnapshot: employee.employeeCode,
});

const requireRevision = (actual, expected, label) => {
  if (actual !== expected) {
    throw vehicleError(
      409,
      "REVISION_CONFLICT",
      `${label} changed. Refresh and retry.`,
    );
  }
};

const normalizeReadingRequestId = (requestId) => {
  if (
    typeof requestId !== "string" ||
    !requestId.trim() ||
    requestId.trim().length > 128
  ) {
    throw vehicleError(
      400,
      "VALIDATION_ERROR",
      "A non-empty reading request ID of at most 128 characters is required",
    );
  }
  return requestId.trim();
};

const findReadingRequest = (record, employeeId, requestId) => {
  for (const segment of record.segments) {
    for (const reading of segment.odometerReadings ?? []) {
      if (
        reading.requestId === requestId &&
        idString(reading.employeeId) === idString(employeeId)
      ) {
        return reading;
      }
    }
  }
  return null;
};

const findUsageSessionRequest = (record, employeeId, requestId, field) => {
  for (const segment of record.segments) {
    if (idString(segment.employeeId) !== idString(employeeId)) continue;
    const usageSession = (segment.usageSessions ?? []).find(
      (item) => item[field] === requestId,
    );
    if (usageSession) return usageSession;
  }
  return null;
};

const usageSessionStartReplayResult = (record, usageSession) => ({
  dailyMileageId: record._id,
  vehicleId: record.vehicleId,
  usageSession: {
    startRequestId: usageSession.startRequestId,
    startOdometerKm: usageSession.startOdometerKm,
    startedAt: usageSession.startedAt,
    status: usageSession.status,
  },
  replayed: true,
});

const usageSessionCompletionReplayResult = (record, employeeId) => {
  const result = record.toObject();
  return {
    ...result,
    activeEmployeeId:
      idString(record.activeEmployeeId) === idString(employeeId)
        ? record.activeEmployeeId
        : null,
    segments: record.segments
      .filter((segment) => idString(segment.employeeId) === idString(employeeId))
      .map(toPlainSegment),
    auditHistory: record.auditHistory
      .filter((entry) => idString(entry.employeeId) === idString(employeeId))
      .map((entry) => entry.toObject?.() ?? entry),
    replayed: true,
  };
};

const readingSubmissionResult = (record, reading) => ({
  dailyMileageId: record._id,
  vehicleId: record.vehicleId,
  reading: {
    requestId: reading.requestId,
    odometerKm: reading.odometerKm,
    distanceKm: reading.distanceKm,
    occurredAt: reading.occurredAt,
    employeeId: reading.employeeId,
    employeeNameSnapshot: reading.employeeNameSnapshot,
    employeeCodeSnapshot: reading.employeeCodeSnapshot,
    source: reading.source,
  },
  latestOdometerKm: reading.odometerKm,
  dailyDistanceKm: reading.idempotencyResult.dailyDistanceKm,
  dailyMileageRevision: reading.idempotencyResult.dailyMileageRevision,
  vehicleRevision: reading.idempotencyResult.vehicleRevision,
});

const assertNoEmployeeDailyUsage = async (employeeId, session) => {
  const active = await VehicleDailyMileage.exists({
    status: { $in: ["OPEN", "ROLLOVER_PENDING"] },
    activeEmployeeId: employeeId,
  }).session(session);
  if (active) {
    throw vehicleError(
      409,
      "DAILY_MILEAGE_SEGMENT_EXISTS",
      "Finish or hand over your current bike segment first",
    );
  }
};

const fenceEmployeeUsage = async (employeeId, session) => {
  const result = await Employee.updateOne(
    { _id: employeeId, status: "active" },
    { $inc: { vehicleUsageRevision: 1 } },
    { session },
  );
  if (result.matchedCount !== 1) {
    throw vehicleError(
      409,
      "EMPLOYEE_NOT_ACTIVE",
      "The employee is no longer active; refresh and sign in again",
    );
  }
};

const assertNoLegacySession = async (vehicleId, employeeId, session) => {
  if (await hasActiveSession(vehicleId, employeeId, session)) {
    throw vehicleError(
      409,
      "LEGACY_MILEAGE_SESSION_EXISTS",
      "Resolve the existing mileage session before using daily mileage",
    );
  }
};

const assertOpenRecord = (record) => {
  if (record?.status === "ROLLOVER_PENDING") {
    throw vehicleError(
      409,
      "ROLLOVER_RECOVERY_REQUIRED",
      "This bike crossed midnight and must be recovered by an administrator before it can be used",
    );
  }
  if (!record || record.status !== "OPEN") {
    throw vehicleError(
      409,
      "DAILY_MILEAGE_NOT_OPEN",
      "This daily mileage record is no longer open",
    );
  }
};

const assertCurrentBusinessDate = (record, now = new Date()) => {
  if (record.businessDate !== toAsiaKolkataDateKey(now)) {
    throw vehicleError(
      409,
      "DAILY_MILEAGE_DATE_CLOSED",
      "This daily mileage record crossed a business-date boundary and requires administrative review",
    );
  }
};

const assertSegmentContinuity = (segments, startOdometerKm) => {
  let precedingOdometerKm = startOdometerKm;
  for (const segment of segments) {
    if (segment.startOdometerKm !== precedingOdometerKm) {
      throw vehicleError(
        409,
        "ODOMETER_CONFLICT",
        "Employee usage segments are not continuous",
      );
    }
    if (segment.endOdometerKm === null || segment.endOdometerKm === undefined) {
      if (segment !== segments.at(-1)) {
        throw vehicleError(
          409,
          "ODOMETER_CONFLICT",
          "Only the latest employee usage segment may remain open",
        );
      }
      return;
    }
    if (segment.endOdometerKm < segment.startOdometerKm) {
      throw vehicleError(
        409,
        "ODOMETER_CONFLICT",
        "An employee segment cannot end below its starting reading",
      );
    }
    precedingOdometerKm = segment.endOdometerKm;
  }
};

const toPlainSegment = (segment) => segment.toObject?.() ?? segment;

const appendSegmentReading = (
  segment,
  { previousOdometerKm, odometerKm, occurredAt, source, requestId = null },
) => {
  if (odometerKm <= previousOdometerKm) return segment;
  const reading = {
    ...(requestId ? { requestId } : {}),
    odometerKm,
    distanceKm: odometerKm - previousOdometerKm,
    occurredAt,
    employeeId: segment.employeeId,
    employeeNameSnapshot: segment.employeeNameSnapshot,
    employeeCodeSnapshot: segment.employeeCodeSnapshot,
    source,
  };
  return {
    ...segment,
    odometerReadings: [
      ...(segment.odometerReadings ?? []).map(
        (item) => item.toObject?.() ?? item,
      ),
      reading,
    ],
  };
};

const finalizeActiveUsageSession = (
  segment,
  { odometerKm, occurredAt, endedBy, status = "COMPLETED" },
) => ({
  ...segment,
  usageSessions: (segment.usageSessions ?? []).map((usageSession) =>
    usageSession.status === "IN_PROGRESS"
      ? {
          ...usageSession,
          endOdometerKm: odometerKm,
          distanceKm: odometerKm - usageSession.startOdometerKm,
          endedAt: occurredAt,
          endedBy,
          status,
        }
      : usageSession,
  ),
});

const toPlainSegments = (segments) => segments.map(toPlainSegment);

const assertEmbeddedReadingReconciliation = (
  segments,
  latestOdometerKm,
  dailyDistanceKm,
  { allowUnattributedDistance = false } = {},
) => {
  let totalSegmentDistanceKm = 0;
  let latestEmbeddedReading = null;
  let allSegmentsComplete = true;
  for (const segment of segments) {
    const readings = segment.odometerReadings ?? [];
    const readingsComplete = segment.odometerReadingsComplete === true;
    allSegmentsComplete &&= readingsComplete;
    if (readingsComplete) {
      const readingDistanceKm = readings.reduce(
        (total, reading) => total + reading.distanceKm,
        0,
      );
      if (segment.distanceKm == null || readingDistanceKm !== segment.distanceKm) {
        throw vehicleError(
          409,
          "ODOMETER_CONFLICT",
          "Embedded reading distances do not reconcile with an employee segment",
        );
      }
    }
    if (readings.length) {
      latestEmbeddedReading = readings.at(-1);
    }
    totalSegmentDistanceKm += segment.distanceKm ?? 0;
  }
  if (
    allSegmentsComplete &&
    !allowUnattributedDistance &&
    latestEmbeddedReading &&
    latestEmbeddedReading.odometerKm !== latestOdometerKm
  ) {
    throw vehicleError(
      409,
      "ODOMETER_CONFLICT",
      "The latest embedded reading does not match the accepted vehicle odometer",
    );
  }
  if (
    dailyDistanceKm != null &&
    (allowUnattributedDistance
      ? totalSegmentDistanceKm > dailyDistanceKm
      : totalSegmentDistanceKm !== dailyDistanceKm)
  ) {
    throw vehicleError(
      409,
      "ODOMETER_CONFLICT",
      "Employee segment distances do not reconcile with the daily distance",
    );
  }
};

const updateRecord = async (
  record,
  expectedRevision,
  update,
  session,
  expectedStatus = "OPEN",
) => {
  requireRevision(record.revision, expectedRevision, "Daily mileage record");
  const result = await VehicleDailyMileage.updateOne(
    {
      _id: record._id,
      status: expectedStatus,
      revision: expectedRevision,
    },
    { $set: update, $inc: { revision: 1 } },
    { session, runValidators: true },
  );
  if (result.matchedCount !== 1) {
    throw vehicleError(
      409,
      "REVISION_CONFLICT",
      "Daily mileage record changed. Refresh and retry.",
    );
  }
};

const markRecordRolloverPending = async ({
  dailyMileageId,
  actorId,
  now,
  businessDate,
}) =>
  withVehicleTransaction(async (session) => {
    const record = await VehicleDailyMileage.findById(dailyMileageId).session(
      session,
    );
    if (
      !record ||
      record.status !== "OPEN" ||
      record.businessDate >= businessDate
    ) {
      return false;
    }

    const vehicle = await getVehicle(record.vehicleId, session);
    await casVehicle(vehicle, vehicle.serviceStateRevision, session, {
      updatedBy: actorId,
    });
    const auditHistory = [
      ...record.auditHistory.map((entry) => entry.toObject?.() ?? entry),
      {
        action: "ROLLOVER_PENDING",
        actorId,
        employeeId: record.activeEmployeeId,
        odometerKm: record.latestOdometerKm,
        occurredAt: now,
        details: `Business date ${record.businessDate} passed in Asia/Kolkata; administrative odometer recovery is required.`,
      },
    ];
    const segments = toPlainSegments(record.segments).map((segment) => ({
      ...segment,
      usageSessions: (segment.usageSessions ?? []).map((usageSession) =>
        usageSession.status === "IN_PROGRESS"
          ? { ...usageSession, status: "RECOVERY_REQUIRED" }
          : usageSession,
      ),
    }));
    const result = await VehicleDailyMileage.updateOne(
      {
        _id: record._id,
        status: "OPEN",
        revision: record.revision,
      },
      {
        $set: {
          status: "ROLLOVER_PENDING",
          activeRecordLock: true,
          segments,
          auditHistory,
          updatedBy: actorId,
        },
        $inc: { revision: 1 },
      },
      { session, runValidators: true },
    );
    if (result.matchedCount !== 1) {
      throw vehicleError(
        409,
        "REVISION_CONFLICT",
        "Daily mileage record changed while rollover was being marked",
      );
    }
    return true;
  });

export const markExpiredDailyMileageForRollover = async ({
  actorId,
  now = new Date(),
}) => {
  const businessDate = toAsiaKolkataDateKey(now);
  const expiredRecords = await VehicleDailyMileage.find({
    status: "OPEN",
    businessDate: { $lt: businessDate },
  })
    .select("_id vehicleId")
    .lean();
  for (const record of expiredRecords) {
    const changed = await markRecordRolloverPending({
      dailyMileageId: record._id,
      actorId,
      now,
      businessDate,
    });
    if (changed) {
      await publishVehicleEventSafely({
        vehicleId: record.vehicleId,
        action: "daily-mileage-rollover-pending",
      });
    }
  }
};

const mapDuplicateError = (error) => {
  if (!isDuplicate(error)) throw error;
  const indexName = error.message?.match(/index:\s+([^\s]+)/)?.[1] ?? "";
  if (
    indexName.includes("employee_open_daily_mileage") ||
    indexName.includes("employee_active_daily_mileage")
  ) {
    throw vehicleError(
      409,
      "DAILY_MILEAGE_SEGMENT_EXISTS",
      "This employee already has an open vehicle usage segment",
    );
  }
  throw vehicleError(
    409,
    "DAILY_MILEAGE_EXISTS",
    "A daily mileage record or usage segment already exists; refresh and retry",
  );
};

export const getDailyMileageState = async (user, now = new Date()) => {
  const employee = await resolveActiveEmployeeByUser(user);
  await markExpiredDailyMileageForRollover({ actorId: user._id, now });
  const businessDate = toAsiaKolkataDateKey(now);
  const [vehicles, vehicleRecords, legacyOpenSessions, current] = await Promise.all([
    Vehicle.find({ status: "ACTIVE" })
      .select("_id registrationNumber make model currentOdometerKm status serviceStateRevision")
      .sort({ registrationNumber: 1, _id: 1 })
      .lean(),
    VehicleDailyMileage.find({
      $or: [
        { status: { $in: ["OPEN", "ROLLOVER_PENDING"] } },
        { businessDate },
      ],
    })
      .select(
        "vehicleId vehicleRegistrationSnapshot businessDate startOdometerKm endOdometerKm dailyDistanceKm latestOdometerKm activeEmployeeId status revision segments auditHistory",
      )
      .sort({ businessDate: -1, createdAt: -1 })
      .lean(),
    VehicleUsageSession.find({ status: "IN_PROGRESS" })
      .select("vehicleId")
      .lean(),
    VehicleDailyMileage.findOne({
      status: "OPEN",
      activeEmployeeId: employee._id,
    }).lean(),
  ]);
  const recordByVehicle = new Map();
  for (const record of vehicleRecords) {
    const key = idString(record.vehicleId);
    const currentRecord = recordByVehicle.get(key);
    if (
      !currentRecord ||
      record.status === "OPEN" ||
      (currentRecord.status !== "OPEN" &&
        record.businessDate > currentRecord.businessDate)
    ) {
      recordByVehicle.set(key, record);
    }
  }
  const legacyOpenVehicleIds = new Set(
    legacyOpenSessions.map((session) => idString(session.vehicleId)),
  );
  const currentVehicle = current
    ? vehicles.find((vehicle) => idString(vehicle._id) === idString(current.vehicleId)) ??
      await Vehicle.findById(current.vehicleId)
        .select("_id registrationNumber make model currentOdometerKm status serviceStateRevision")
        .lean()
    : null;
  const currentVehicleView = currentVehicle
    ? {
        ...currentVehicle,
        revision: currentVehicle.serviceStateRevision,
        serviceStateRevision: undefined,
      }
    : null;
  const reopenableRecords = vehicleRecords.flatMap((record) => {
    if (
      record.status !== "CLOSED" ||
      record.businessDate !== businessDate
    ) {
      return [];
    }
    const lastUsageAction = [...record.auditHistory]
      .reverse()
      .find((event) =>
        ["CLOSED", "REOPENED", "HANDOVER", "JOINED"].includes(event.action),
      );
    if (
      lastUsageAction?.action !== "CLOSED" ||
      idString(lastUsageAction.employeeId) !== idString(employee._id)
    ) {
      return [];
    }
    const vehicle = vehicles.find(
      (item) => idString(item._id) === idString(record.vehicleId),
    );
    const currentClose = [...record.auditHistory]
      .reverse()
      .find((event) => event.action === "CLOSED");
    if (
      !vehicle ||
      vehicle.status !== "ACTIVE" ||
      vehicle.currentOdometerKm !== record.latestOdometerKm ||
      !currentClose
    ) {
      return [];
    }
    return [{
      ...record,
      closedAt: currentClose.occurredAt,
      vehicleRevision: vehicle.serviceStateRevision,
    }];
  });

  return {
    current: current
      ? {
          ...current,
          vehicle: currentVehicleView,
          vehicleRevision: currentVehicle?.serviceStateRevision,
        }
      : null,
    reopenableRecords,
    vehicles: vehicles.map((vehicle) => {
      const dailyRecord = recordByVehicle.get(idString(vehicle._id));
      const hasLegacySession = legacyOpenVehicleIds.has(idString(vehicle._id));
      const canStart = !dailyRecord && !hasLegacySession;
      const canJoin =
        dailyRecord?.status === "OPEN" &&
        dailyRecord.businessDate === businessDate &&
        dailyRecord.activeEmployeeId == null;
      return {
        ...vehicle,
        revision: vehicle.serviceStateRevision,
        serviceStateRevision: undefined,
        dailyMileageId: canJoin ? dailyRecord._id : null,
        dailyMileageRevision: canJoin ? dailyRecord.revision : null,
        latestOdometerKm: canJoin
          ? dailyRecord.latestOdometerKm
          : vehicle.currentOdometerKm,
        usageState: dailyRecord?.status === "ROLLOVER_PENDING"
          ? "ROLLOVER_PENDING"
          : canStart
          ? "AVAILABLE"
          : canJoin
            ? "HANDOVER"
            : hasLegacySession
              ? "IN_USE"
              : dailyRecord.status === "CLOSED"
                ? "CLOSED"
                : "IN_USE",
      };
    }),
  };
};

export const getDailyMileageHistory = async ({
  user,
  fromDate,
  toDate,
  page = 1,
  limit = 25,
}) => {
  const employee = await resolveActiveEmployeeByUser(user);
  const boundedLimit = Math.min(Math.max(1, Number(limit) || 25), 100);
  const boundedPage = Math.max(1, Number(page) || 1);
  const filter = {
    "segments.employeeId": employee._id,
    ...(fromDate && toDate
      ? { businessDate: { $gte: fromDate, $lte: toDate } }
      : {}),
  };
  const [records, total] = await Promise.all([
    VehicleDailyMileage.find(filter)
      .sort({ businessDate: -1, createdAt: -1, _id: -1 })
      .skip((boundedPage - 1) * boundedLimit)
      .limit(boundedLimit)
      .lean(),
    VehicleDailyMileage.countDocuments(filter),
  ]);
  return {
    records: records.map((record) => ({
      ...record,
      activeEmployeeId:
        idString(record.activeEmployeeId) === idString(employee._id)
          ? record.activeEmployeeId
          : null,
      segments: record.segments.filter(
        (segment) => idString(segment.employeeId) === idString(employee._id),
      ),
      auditHistory: (record.auditHistory ?? []).filter(
        (event) =>
          idString(event.employeeId) === idString(employee._id) ||
          idString(event.actorId) === idString(user._id),
      ),
    })),
    pagination: {
      page: boundedPage,
      limit: boundedLimit,
      total,
      totalPages: Math.ceil(total / boundedLimit),
    },
  };
};

export const startDailyMileage = async ({
  user,
  vehicleId,
  startingOdometerKm,
  expectedVehicleRevision,
  now = new Date(),
}) => {
  requireWholeKilometres(startingOdometerKm, "Starting odometer");
  await markExpiredDailyMileageForRollover({ actorId: user._id, now });
  try {
    return await withVehicleTransaction(async (session) => {
      const employee = await resolveActiveEmployeeByUser(user, session);
      const vehicle = await getVehicle(vehicleId, session);
      if (vehicle.status !== "ACTIVE") {
        throw vehicleError(409, "VEHICLE_NOT_ACTIVE", "Bike is not active");
      }
      await assertNoEmployeeDailyUsage(employee._id, session);
      await assertNoLegacySession(vehicle._id, employee._id, session);
      await fenceEmployeeUsage(employee._id, session);
      const existing = await VehicleDailyMileage.findOne({
        vehicleId: vehicle._id,
        status: { $in: ["OPEN", "ROLLOVER_PENDING"] },
      }).session(session);
      if (existing) {
        throw vehicleError(
          409,
          existing.status === "ROLLOVER_PENDING"
            ? "ROLLOVER_RECOVERY_REQUIRED"
            : "DAILY_MILEAGE_EXISTS",
          existing.status === "ROLLOVER_PENDING"
            ? "This bike must be recovered by an administrator before a new daily record can start"
            : "This bike already has an open daily mileage record",
        );
      }
      if (startingOdometerKm < vehicle.currentOdometerKm) {
        throw vehicleError(
          409,
          "ODOMETER_MISMATCH",
          "Starting odometer cannot be below the current verified vehicle reading",
        );
      }
      const actorId = user._id;
      await casVehicle(
        vehicle,
        expectedVehicleRevision,
        session,
        {
          ...(startingOdometerKm > vehicle.currentOdometerKm
            ? { currentOdometerKm: startingOdometerKm }
            : {}),
          updatedBy: actorId,
        },
      );
      const snapshot = employeeSnapshot(employee);
      const [record] = await VehicleDailyMileage.create(
        [
          {
            vehicleId: vehicle._id,
            vehicleRegistrationSnapshot: vehicle.registrationNumber,
            businessDate: toAsiaKolkataDateKey(now),
            startOdometerKm: startingOdometerKm,
            latestOdometerKm: startingOdometerKm,
            activeRecordLock: true,
            activeEmployeeId: employee._id,
            segments: [
              {
                ...snapshot,
                startOdometerKm: startingOdometerKm,
                distanceKm: 0,
                odometerReadingsComplete: true,
                startedAt: now,
                startedBy: actorId,
                odometerReadings: [
                  {
                    odometerKm: startingOdometerKm,
                    distanceKm: 0,
                    occurredAt: now,
                    ...snapshot,
                    source: "BASELINE",
                  },
                ],
              },
            ],
            dailyDistanceKm: 0,
            auditHistory: [
              {
                action: "STARTED",
                actorId,
                employeeId: employee._id,
                odometerKm: startingOdometerKm,
                occurredAt: now,
              },
            ],
            createdBy: actorId,
            updatedBy: actorId,
          },
        ],
        { session },
      );
      return record;
    });
  } catch (error) {
    mapDuplicateError(error);
  }
};

export const addDailyMileageReading = async ({
  dailyMileageId,
  user,
  requestId,
  odometerKm,
  expectedVehicleRevision,
  expectedDailyRevision,
  now = new Date(),
}) => {
  requireWholeKilometres(odometerKm, "Odometer reading");
  const normalizedRequestId = normalizeReadingRequestId(requestId);
  await markExpiredDailyMileageForRollover({ actorId: user._id, now });
  try {
    return await withVehicleTransaction(async (session) => {
      const employee = await resolveActiveEmployeeByUser(user, session);
      const record = await VehicleDailyMileage.findById(dailyMileageId).session(
        session,
      );
      if (!record) {
        throw vehicleError(
          409,
          "DAILY_MILEAGE_NOT_OPEN",
          "This daily mileage record is no longer open",
        );
      }
      const previousSubmission = findReadingRequest(
        record,
        employee._id,
        normalizedRequestId,
      );
      if (previousSubmission) {
        if (previousSubmission.odometerKm !== odometerKm) {
          throw vehicleError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "This reading request ID was already used with a different odometer value",
          );
        }
        return readingSubmissionResult(record, previousSubmission);
      }
      assertOpenRecord(record);
      assertCurrentBusinessDate(record, now);
      if (idString(record.activeEmployeeId) !== idString(employee._id)) {
        throw vehicleError(
          403,
          "PERMISSION_DENIED",
          "Only the employee currently using this bike can add an odometer reading",
        );
      }
      requireRevision(record.revision, expectedDailyRevision, "Daily mileage record");

      const vehicle = await getVehicle(record.vehicleId, session);
      if (vehicle.status !== "ACTIVE") {
        throw vehicleError(409, "VEHICLE_NOT_ACTIVE", "Bike is not active");
      }
      await assertNoLegacySession(vehicle._id, employee._id, session);
      await fenceEmployeeUsage(employee._id, session);

      if (
        !Number.isSafeInteger(record.latestOdometerKm) ||
        record.latestOdometerKm !== vehicle.currentOdometerKm ||
        odometerKm <= record.latestOdometerKm
      ) {
        throw vehicleError(
          409,
          "ODOMETER_CONFLICT",
          "Reading must be greater than the latest verified bike odometer",
        );
      }

      const segmentIndex = record.segments.findIndex(
        (segment) =>
          idString(segment.employeeId) === idString(employee._id) &&
          segment.endedAt == null,
      );
      if (segmentIndex < 0) {
        throw vehicleError(
          409,
          "DAILY_MILEAGE_SEGMENT_CONFLICT",
          "The current employee segment is missing or already closed",
        );
      }

      const distanceKm = odometerKm - record.latestOdometerKm;
      const dailyDistanceKm = odometerKm - record.startOdometerKm;
      const dailyMileageRevision = expectedDailyRevision + 1;
      const vehicleRevision = expectedVehicleRevision + 1;
      const segments = toPlainSegments(record.segments);
      const segment = segments[segmentIndex];
      const odometerReadings = (segment.odometerReadings ?? []).map(
        (reading) => reading.toObject?.() ?? reading,
      );
      const snapshot = employeeSnapshot(employee);
      odometerReadings.push({
        requestId: normalizedRequestId,
        odometerKm,
        distanceKm,
        occurredAt: now,
        ...snapshot,
        idempotencyResult: {
          dailyDistanceKm,
          dailyMileageRevision,
          vehicleRevision,
        },
        source: "EMPLOYEE_SUBMISSION",
      });
      segments[segmentIndex] = {
        ...segment,
        distanceKm: odometerKm - segment.startOdometerKm,
        odometerReadings,
      };
      assertEmbeddedReadingReconciliation(
        segments,
        odometerKm,
        dailyDistanceKm,
      );

      const auditHistory = [
        ...record.auditHistory.map((entry) => entry.toObject?.() ?? entry),
        {
          action: "ODOMETER_READING_ADDED",
          actorId: user._id,
          ...snapshot,
          odometerKm,
          occurredAt: now,
        },
      ];

      await casVehicle(vehicle, expectedVehicleRevision, session, {
        currentOdometerKm: odometerKm,
        updatedBy: user._id,
      });
      await updateRecord(
        record,
        expectedDailyRevision,
        {
          latestOdometerKm: odometerKm,
          dailyDistanceKm,
          segments,
          auditHistory,
          updatedBy: user._id,
        },
        session,
      );

      return readingSubmissionResult(record, odometerReadings.at(-1));
    });
  } catch (error) {
    mapDuplicateError(error);
  }
};

export const startDailyMileageUsageSession = async ({
  dailyMileageId,
  user,
  requestId,
  expectedVehicleRevision,
  expectedDailyRevision,
  now = new Date(),
}) => {
  const normalizedRequestId = normalizeReadingRequestId(requestId);
  await markExpiredDailyMileageForRollover({ actorId: user._id, now });
  try {
    return await withVehicleTransaction(async (session) => {
      const employee = await resolveActiveEmployeeByUser(user, session);
      const record = await VehicleDailyMileage.findById(dailyMileageId).session(
        session,
      );
      if (!record) {
        throw vehicleError(404, "RESOURCE_NOT_FOUND", "Daily mileage record not found");
      }
      const previousStart = findUsageSessionRequest(
        record,
        employee._id,
        normalizedRequestId,
        "startRequestId",
      );
      if (previousStart) {
        return usageSessionStartReplayResult(record, previousStart);
      }

      assertOpenRecord(record);
      assertCurrentBusinessDate(record, now);
      if (idString(record.activeEmployeeId) !== idString(employee._id)) {
        throw vehicleError(
          403,
          "PERMISSION_DENIED",
          "Only the employee currently using this bike can start a usage session",
        );
      }
      requireRevision(record.revision, expectedDailyRevision, "Daily mileage record");
      const vehicle = await getVehicle(record.vehicleId, session);
      if (vehicle.status !== "ACTIVE") {
        throw vehicleError(409, "VEHICLE_NOT_ACTIVE", "Bike is not active");
      }
      if (vehicle.currentOdometerKm !== record.latestOdometerKm) {
        throw vehicleError(
          409,
          "ODOMETER_CONFLICT",
          "Vehicle odometer changed; refresh before starting a usage session",
        );
      }
      await assertNoLegacySession(vehicle._id, employee._id, session);
      const segmentIndex = record.segments.findIndex(
        (segment) =>
          idString(segment.employeeId) === idString(employee._id) &&
          segment.endedAt == null,
      );
      if (segmentIndex < 0) {
        throw vehicleError(
          409,
          "DAILY_MILEAGE_SEGMENT_CONFLICT",
          "The current employee segment is missing or already closed",
        );
      }
      const segments = toPlainSegments(record.segments);
      const segment = segments[segmentIndex];
      if (
        segments.some((item) =>
          (item.usageSessions ?? []).some(
            (usageSession) =>
              usageSession.status === "IN_PROGRESS" ||
              usageSession.status === "RECOVERY_REQUIRED",
          ),
        )
      ) {
        throw vehicleError(
          409,
          "USAGE_SESSION_EXISTS",
          "Complete or recover the current usage session before starting another",
        );
      }
      await fenceEmployeeUsage(employee._id, session);
      await casVehicle(vehicle, expectedVehicleRevision, session, {
        updatedBy: user._id,
      });

      const usageSession = {
        startRequestId: normalizedRequestId,
        startOdometerKm: record.latestOdometerKm,
        startedAt: now,
        status: "IN_PROGRESS",
      };
      segments[segmentIndex] = {
        ...segment,
        usageSessions: [...(segment.usageSessions ?? []), usageSession],
      };
      const auditHistory = [
        ...record.auditHistory.map((entry) => entry.toObject?.() ?? entry),
        {
          action: "USAGE_SESSION_STARTED",
          actorId: user._id,
          ...employeeSnapshot(employee),
          odometerKm: record.latestOdometerKm,
          occurredAt: now,
        },
      ];
      await updateRecord(
        record,
        expectedDailyRevision,
        { segments, auditHistory, updatedBy: user._id },
        session,
      );
      return {
        ...record.toObject(),
        segments,
        auditHistory,
        revision: expectedDailyRevision + 1,
      };
    });
  } catch (error) {
    mapDuplicateError(error);
  }
};

export const completeDailyMileageUsageSession = async ({
  dailyMileageId,
  user,
  requestId,
  endingOdometerKm,
  expectedVehicleRevision,
  expectedDailyRevision,
  now = new Date(),
}) => {
  requireWholeKilometres(endingOdometerKm, "Ending odometer");
  const normalizedRequestId = normalizeReadingRequestId(requestId);
  await markExpiredDailyMileageForRollover({ actorId: user._id, now });
  try {
    return await withVehicleTransaction(async (session) => {
      const employee = await resolveActiveEmployeeByUser(user, session);
      const record = await VehicleDailyMileage.findById(dailyMileageId).session(
        session,
      );
      if (!record) {
        throw vehicleError(404, "RESOURCE_NOT_FOUND", "Daily mileage record not found");
      }
      const previousEnd = findUsageSessionRequest(
        record,
        employee._id,
        normalizedRequestId,
        "endRequestId",
      );
      if (previousEnd) {
        if (previousEnd.endOdometerKm !== endingOdometerKm) {
          throw vehicleError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "This session completion request ID was already used with a different odometer",
          );
        }
        return usageSessionCompletionReplayResult(record, employee._id);
      }

      assertOpenRecord(record);
      assertCurrentBusinessDate(record, now);
      if (idString(record.activeEmployeeId) !== idString(employee._id)) {
        throw vehicleError(
          403,
          "PERMISSION_DENIED",
          "Only the employee currently using this bike can complete a usage session",
        );
      }
      requireRevision(record.revision, expectedDailyRevision, "Daily mileage record");
      const vehicle = await getVehicle(record.vehicleId, session);
      if (vehicle.status !== "ACTIVE") {
        throw vehicleError(409, "VEHICLE_NOT_ACTIVE", "Bike is not active");
      }
      if (
        vehicle.currentOdometerKm !== record.latestOdometerKm ||
        endingOdometerKm < record.latestOdometerKm
      ) {
        throw vehicleError(
          409,
          "ODOMETER_CONFLICT",
          "Ending reading cannot be below the latest verified vehicle odometer",
        );
      }
      await assertNoLegacySession(vehicle._id, employee._id, session);
      await fenceEmployeeUsage(employee._id, session);
      const segmentIndex = record.segments.findIndex(
        (segment) =>
          idString(segment.employeeId) === idString(employee._id) &&
          segment.endedAt == null,
      );
      if (segmentIndex < 0) {
        throw vehicleError(
          409,
          "DAILY_MILEAGE_SEGMENT_CONFLICT",
          "The current employee segment is missing or already closed",
        );
      }
      const segments = toPlainSegments(record.segments);
      const segment = segments[segmentIndex];
      const sessionIndex = (segment.usageSessions ?? []).findIndex(
        (usageSession) => usageSession.status === "IN_PROGRESS",
      );
      if (sessionIndex < 0) {
        throw vehicleError(
          409,
          "USAGE_SESSION_NOT_OPEN",
          "There is no active usage session to complete",
        );
      }
      const usageSessions = [...segment.usageSessions];
      const activeSession = usageSessions[sessionIndex];
      usageSessions[sessionIndex] = {
        ...activeSession,
        endRequestId: normalizedRequestId,
        endOdometerKm: endingOdometerKm,
        distanceKm: endingOdometerKm - activeSession.startOdometerKm,
        endedAt: now,
        endedBy: user._id,
        status: "COMPLETED",
      };
      const updatedSegment = appendSegmentReading(segment, {
        previousOdometerKm: record.latestOdometerKm,
        odometerKm: endingOdometerKm,
        occurredAt: now,
        source: "SESSION_END",
        requestId: normalizedRequestId,
      });
      segments[segmentIndex] = {
        ...updatedSegment,
        distanceKm: endingOdometerKm - segment.startOdometerKm,
        usageSessions,
      };
      const dailyDistanceKm = endingOdometerKm - record.startOdometerKm;
      assertEmbeddedReadingReconciliation(
        segments,
        endingOdometerKm,
        dailyDistanceKm,
      );
      const auditHistory = [
        ...record.auditHistory.map((entry) => entry.toObject?.() ?? entry),
        {
          action: "USAGE_SESSION_COMPLETED",
          actorId: user._id,
          ...employeeSnapshot(employee),
          odometerKm: endingOdometerKm,
          occurredAt: now,
        },
      ];
      await casVehicle(vehicle, expectedVehicleRevision, session, {
        currentOdometerKm: endingOdometerKm,
        updatedBy: user._id,
      });
      await updateRecord(
        record,
        expectedDailyRevision,
        {
          latestOdometerKm: endingOdometerKm,
          dailyDistanceKm,
          segments,
          auditHistory,
          updatedBy: user._id,
        },
        session,
      );
      return {
        ...record.toObject(),
        latestOdometerKm: endingOdometerKm,
        dailyDistanceKm,
        segments,
        auditHistory,
        revision: expectedDailyRevision + 1,
      };
    });
  } catch (error) {
    mapDuplicateError(error);
  }
};

export const handoverDailyMileage = async ({
  dailyMileageId,
  user,
  endingOdometerKm,
  expectedVehicleRevision,
  expectedDailyRevision,
  now = new Date(),
}) => {
  requireWholeKilometres(endingOdometerKm, "Handover odometer");
  await markExpiredDailyMileageForRollover({ actorId: user._id, now });
  try {
    return await withVehicleTransaction(async (session) => {
      const employee = await resolveActiveEmployeeByUser(user, session);
      const record = await VehicleDailyMileage.findById(dailyMileageId).session(
        session,
      );
      assertOpenRecord(record);
      assertCurrentBusinessDate(record, now);
      if (idString(record.activeEmployeeId) !== idString(employee._id)) {
        throw vehicleError(
          403,
          "PERMISSION_DENIED",
          "Only the employee currently using this bike can record a handover",
        );
      }
      requireRevision(record.revision, expectedDailyRevision, "Daily mileage record");
      const vehicle = await getVehicle(record.vehicleId, session);
      await assertNoLegacySession(vehicle._id, employee._id, session);
      await fenceEmployeeUsage(employee._id, session);
      const segmentIndex = record.segments.findIndex(
        (segment) =>
          idString(segment.employeeId) === idString(employee._id) &&
          segment.endedAt == null,
      );
      if (segmentIndex < 0) {
        throw vehicleError(
          409,
          "DAILY_MILEAGE_SEGMENT_CONFLICT",
          "The current employee segment is missing or already closed",
        );
      }
      const segment = record.segments[segmentIndex];
      if (
        endingOdometerKm < record.latestOdometerKm ||
        endingOdometerKm < vehicle.currentOdometerKm
      ) {
        throw vehicleError(
          409,
          "ODOMETER_CONFLICT",
          "Handover reading cannot be below the latest verified vehicle reading",
        );
      }
      const segments = toPlainSegments(record.segments);
      let activeSegment = segments[segmentIndex];
      activeSegment = appendSegmentReading(activeSegment, {
        previousOdometerKm: record.latestOdometerKm,
        odometerKm: endingOdometerKm,
        occurredAt: now,
        source: "HANDOVER",
      });
      activeSegment = finalizeActiveUsageSession(activeSegment, {
        odometerKm: endingOdometerKm,
        occurredAt: now,
        endedBy: user._id,
      });
      segments[segmentIndex] = {
        ...activeSegment,
        endOdometerKm: endingOdometerKm,
        distanceKm: endingOdometerKm - activeSegment.startOdometerKm,
        endedAt: now,
        endedBy: user._id,
      };
      assertSegmentContinuity(segments, record.startOdometerKm);
      const dailyDistanceKm = endingOdometerKm - record.startOdometerKm;
      assertEmbeddedReadingReconciliation(
        segments,
        endingOdometerKm,
        dailyDistanceKm,
      );
      const auditHistory = [
        ...record.auditHistory.map((entry) => entry.toObject?.() ?? entry),
        {
          action: "HANDOVER",
          actorId: user._id,
          employeeId: employee._id,
          odometerKm: endingOdometerKm,
          occurredAt: now,
        },
      ];
      await casVehicle(vehicle, expectedVehicleRevision, session, {
        currentOdometerKm: endingOdometerKm,
        updatedBy: user._id,
      });
      await updateRecord(
        record,
        expectedDailyRevision,
        {
          latestOdometerKm: endingOdometerKm,
          dailyDistanceKm,
          activeEmployeeId: null,
          segments,
          auditHistory,
          updatedBy: user._id,
        },
        session,
      );
      return {
        ...record.toObject(),
        latestOdometerKm: endingOdometerKm,
        dailyDistanceKm,
        activeEmployeeId: null,
        segments,
        auditHistory,
        revision: expectedDailyRevision + 1,
      };
    });
  } catch (error) {
    mapDuplicateError(error);
  }
};

export const joinDailyMileage = async ({
  dailyMileageId,
  user,
  expectedVehicleRevision,
  expectedDailyRevision,
  now = new Date(),
}) => {
  if (!mongoose.isValidObjectId(dailyMileageId)) {
    throw vehicleError(400, "VALIDATION_ERROR", "Invalid daily mileage ID");
  }
  await markExpiredDailyMileageForRollover({ actorId: user._id, now });
  try {
    return await withVehicleTransaction(async (session) => {
      const employee = await resolveActiveEmployeeByUser(user, session);
      await assertNoEmployeeDailyUsage(employee._id, session);
      const record = await VehicleDailyMileage.findById(dailyMileageId).session(
        session,
      );
      assertOpenRecord(record);
      assertCurrentBusinessDate(record, now);
      if (record.activeEmployeeId) {
        throw vehicleError(
          409,
          "DAILY_MILEAGE_SEGMENT_EXISTS",
          "Another employee is currently using this bike",
        );
      }
      requireRevision(record.revision, expectedDailyRevision, "Daily mileage record");
      const vehicle = await getVehicle(record.vehicleId, session);
      if (vehicle.status !== "ACTIVE") {
        throw vehicleError(409, "VEHICLE_NOT_ACTIVE", "Bike is not active");
      }
      await assertNoLegacySession(vehicle._id, employee._id, session);
      await fenceEmployeeUsage(employee._id, session);
      const snapshot = employeeSnapshot(employee);
      const dailyDistanceKm = record.latestOdometerKm - record.startOdometerKm;
      const joiningFreshRolloverRecord = record.segments.length === 0;
      const segments = [
        ...toPlainSegments(record.segments),
        {
          ...snapshot,
          startOdometerKm: record.latestOdometerKm,
          distanceKm: 0,
          odometerReadingsComplete: true,
          startedAt: now,
          startedBy: user._id,
          odometerReadings: joiningFreshRolloverRecord
            ? [
                {
                  odometerKm: record.latestOdometerKm,
                  distanceKm: 0,
                  occurredAt: now,
                  ...snapshot,
                  source: "BASELINE",
                },
              ]
            : [],
        },
      ];
      assertSegmentContinuity(segments, record.startOdometerKm);
      assertEmbeddedReadingReconciliation(
        segments,
        record.latestOdometerKm,
        dailyDistanceKm,
      );
      await casVehicle(vehicle, expectedVehicleRevision, session, {
        updatedBy: user._id,
      });
      const auditHistory = [
        ...record.auditHistory.map((entry) => entry.toObject?.() ?? entry),
        {
          action: "JOINED",
          actorId: user._id,
          employeeId: employee._id,
          odometerKm: record.latestOdometerKm,
          occurredAt: now,
        },
      ];
      await updateRecord(
        record,
        expectedDailyRevision,
        {
          activeEmployeeId: employee._id,
          activeRecordLock: true,
          dailyDistanceKm,
          segments,
          auditHistory,
          updatedBy: user._id,
        },
        session,
      );
      return {
        ...record.toObject(),
        activeEmployeeId: employee._id,
        activeRecordLock: true,
        dailyDistanceKm,
        segments,
        auditHistory,
        revision: expectedDailyRevision + 1,
      };
    });
  } catch (error) {
    mapDuplicateError(error);
  }
};

export const closeDailyMileage = async ({
  dailyMileageId,
  user,
  endingOdometerKm,
  expectedVehicleRevision,
  expectedDailyRevision,
  now = new Date(),
}) => {
  requireWholeKilometres(endingOdometerKm, "Ending odometer");
  await markExpiredDailyMileageForRollover({ actorId: user._id, now });
  try {
    return await withVehicleTransaction(async (session) => {
      const employee = await resolveActiveEmployeeByUser(user, session);
      const record = await VehicleDailyMileage.findById(dailyMileageId).session(
        session,
      );
      assertOpenRecord(record);
      assertCurrentBusinessDate(record, now);
      if (idString(record.activeEmployeeId) !== idString(employee._id)) {
        throw vehicleError(
          403,
          "PERMISSION_DENIED",
          "Only the employee currently using this bike can close today's mileage",
        );
      }
      requireRevision(record.revision, expectedDailyRevision, "Daily mileage record");
      const vehicle = await getVehicle(record.vehicleId, session);
      await assertNoLegacySession(vehicle._id, employee._id, session);
      await fenceEmployeeUsage(employee._id, session);
      const segmentIndex = record.segments.findIndex(
        (segment) =>
          idString(segment.employeeId) === idString(employee._id) &&
          segment.endedAt == null,
      );
      if (segmentIndex < 0) {
        throw vehicleError(
          409,
          "DAILY_MILEAGE_SEGMENT_CONFLICT",
          "The current employee segment is missing or already closed",
        );
      }
      if (
        endingOdometerKm < record.latestOdometerKm ||
        endingOdometerKm < vehicle.currentOdometerKm
      ) {
        throw vehicleError(
          409,
          "ODOMETER_CONFLICT",
          "Ending reading cannot be below the latest verified vehicle reading",
        );
      }
      const segments = toPlainSegments(record.segments);
      let activeSegment = segments[segmentIndex];
      activeSegment = appendSegmentReading(activeSegment, {
        previousOdometerKm: record.latestOdometerKm,
        odometerKm: endingOdometerKm,
        occurredAt: now,
        source: "CLOSE",
      });
      activeSegment = finalizeActiveUsageSession(activeSegment, {
        odometerKm: endingOdometerKm,
        occurredAt: now,
        endedBy: user._id,
      });
      segments[segmentIndex] = {
        ...activeSegment,
        endOdometerKm: endingOdometerKm,
        distanceKm: endingOdometerKm - activeSegment.startOdometerKm,
        endedAt: now,
        endedBy: user._id,
      };
      assertSegmentContinuity(segments, record.startOdometerKm);
      const dailyDistanceKm = endingOdometerKm - record.startOdometerKm;
      assertEmbeddedReadingReconciliation(
        segments,
        endingOdometerKm,
        dailyDistanceKm,
      );
      await casVehicle(vehicle, expectedVehicleRevision, session, {
        currentOdometerKm: endingOdometerKm,
        updatedBy: user._id,
      });
      const auditHistory = [
        ...record.auditHistory.map((entry) => entry.toObject?.() ?? entry),
        {
          action: "CLOSED",
          actorId: user._id,
          employeeId: employee._id,
          ...employeeSnapshot(employee),
          odometerKm: endingOdometerKm,
          occurredAt: now,
        },
      ];
      await updateRecord(
        record,
        expectedDailyRevision,
        {
          endOdometerKm: endingOdometerKm,
          dailyDistanceKm,
          latestOdometerKm: endingOdometerKm,
          status: "CLOSED",
          activeRecordLock: false,
          activeEmployeeId: null,
          segments,
          auditHistory,
          updatedBy: user._id,
        },
        session,
      );
      return {
        ...record.toObject(),
        endOdometerKm: endingOdometerKm,
        dailyDistanceKm,
        latestOdometerKm: endingOdometerKm,
        status: "CLOSED",
        activeEmployeeId: null,
        segments,
        auditHistory,
        revision: expectedDailyRevision + 1,
      };
    });
  } catch (error) {
    mapDuplicateError(error);
  }
};

export const reopenDailyMileage = async ({
  dailyMileageId,
  user,
  expectedVehicleRevision,
  expectedDailyRevision,
  now = new Date(),
}) => {
  if (!mongoose.isValidObjectId(dailyMileageId)) {
    throw vehicleError(400, "VALIDATION_ERROR", "Invalid daily mileage ID");
  }
  await markExpiredDailyMileageForRollover({ actorId: user._id, now });
  try {
    return await withVehicleTransaction(async (session) => {
      const employee = await resolveActiveEmployeeByUser(user, session);
      const record = await VehicleDailyMileage.findById(dailyMileageId).session(
        session,
      );
      if (record?.status === "ROLLOVER_PENDING") {
        throw vehicleError(
          409,
          "ROLLOVER_RECOVERY_REQUIRED",
          "This bike crossed midnight and must be recovered by an administrator before it can be used",
        );
      }
      if (!record || record.status !== "CLOSED") {
        throw vehicleError(
          409,
          "DAILY_MILEAGE_NOT_REOPENABLE",
          "Only a closed daily mileage record can be reopened",
        );
      }
      if (record.businessDate !== toAsiaKolkataDateKey(now)) {
        throw vehicleError(
          409,
          "DAILY_MILEAGE_DATE_CLOSED",
          "Only today's closed mileage record can be reopened",
        );
      }
      const lastUsageAction = [...record.auditHistory]
        .reverse()
        .find((event) =>
          ["CLOSED", "REOPENED", "HANDOVER", "JOINED"].includes(event.action),
        );
      if (
        lastUsageAction?.action !== "CLOSED" ||
        idString(lastUsageAction.employeeId) !== idString(employee._id)
      ) {
        throw vehicleError(
          403,
          "PERMISSION_DENIED",
          "Only the employee who closed this record can reopen it",
        );
      }
      await assertNoEmployeeDailyUsage(employee._id, session);
      requireRevision(
        record.revision,
        expectedDailyRevision,
        "Daily mileage record",
      );
      const vehicle = await getVehicle(record.vehicleId, session);
      if (vehicle.status !== "ACTIVE") {
        throw vehicleError(
          409,
          "VEHICLE_NOT_ACTIVE",
          "Only an active bike's record can be reopened",
        );
      }
      if (vehicle.currentOdometerKm !== record.latestOdometerKm) {
        throw vehicleError(
          409,
          "ODOMETER_CONFLICT",
          "The vehicle odometer changed after this record closed; refresh and resolve the odometer before reopening",
        );
      }
      await assertNoLegacySession(vehicle._id, employee._id, session);
      requireWholeKilometres(record.latestOdometerKm, "Latest odometer");
      await fenceEmployeeUsage(employee._id, session);
      const snapshot = employeeSnapshot(employee);
      const dailyDistanceKm = record.latestOdometerKm - record.startOdometerKm;
      const segments = [
        ...toPlainSegments(record.segments),
        {
          ...snapshot,
          startOdometerKm: record.latestOdometerKm,
          distanceKm: 0,
          odometerReadingsComplete: true,
          startedAt: now,
          startedBy: user._id,
          odometerReadings: [],
        },
      ];
      assertSegmentContinuity(segments, record.startOdometerKm);
      assertEmbeddedReadingReconciliation(
        segments,
        record.latestOdometerKm,
        dailyDistanceKm,
      );
      await casVehicle(vehicle, expectedVehicleRevision, session, {
        updatedBy: user._id,
      });
      const auditHistory = [
        ...record.auditHistory.map((entry) => entry.toObject?.() ?? entry),
        {
          action: "REOPENED",
          actorId: user._id,
          employeeId: employee._id,
          ...snapshot,
          odometerKm: record.latestOdometerKm,
          occurredAt: now,
          details:
            "The same-day record was reopened; its prior closure and reading remain in history.",
        },
      ];
      await updateRecord(
        record,
        expectedDailyRevision,
        {
          status: "OPEN",
          activeRecordLock: true,
          activeEmployeeId: employee._id,
          endOdometerKm: null,
          dailyDistanceKm,
          segments,
          auditHistory,
          updatedBy: user._id,
        },
        session,
        "CLOSED",
      );
      return {
        ...record.toObject(),
        status: "OPEN",
        activeRecordLock: true,
        activeEmployeeId: employee._id,
        endOdometerKm: null,
        dailyDistanceKm,
        segments,
        auditHistory,
        revision: expectedDailyRevision + 1,
      };
    });
  } catch (error) {
    mapDuplicateError(error);
  }
};

export const listDailyMileageRolloverPending = async (user, now = new Date()) => {
  await markExpiredDailyMileageForRollover({ actorId: user._id, now });
  const records = await VehicleDailyMileage.find({
    status: "ROLLOVER_PENDING",
  })
    .sort({ businessDate: 1, vehicleRegistrationSnapshot: 1 })
    .populate(
      "vehicleId",
      "registrationNumber currentOdometerKm serviceStateRevision",
    )
    .populate({
      path: "activeEmployeeId",
      select: "employeeCode userId",
      populate: { path: "userId", select: "firstName lastName" },
    })
    .lean();
  return { records };
};

const rolloverAllocationDetails =
  "Mileage accumulated after midnight through the actual recovery reading is allocated to the previous business date because the interval cannot be split accurately. The next business date starts at the same reading.";

export const recoverDailyMileageRollover = async ({
  dailyMileageId,
  recoveryOdometerKm,
  expectedVehicleRevision,
  expectedDailyRevision,
  nextEmployeeId,
  user,
  now = new Date(),
}) => {
  requireWholeKilometres(recoveryOdometerKm, "Recovery odometer");
  if (!mongoose.isValidObjectId(dailyMileageId)) {
    throw vehicleError(400, "VALIDATION_ERROR", "Invalid daily mileage ID");
  }
  const businessDate = toAsiaKolkataDateKey(now);

  try {
    return await withVehicleTransaction(async (session) => {
      const record = await VehicleDailyMileage.findById(dailyMileageId).session(
        session,
      );
      if (!record) {
        throw vehicleError(404, "RESOURCE_NOT_FOUND", "Daily mileage record not found");
      }

      const priorRecovery = record.auditHistory.find(
        (entry) => entry.action === "ROLLOVER_RECOVERED",
      );
      if (record.status === "CLOSED" && priorRecovery) {
        const nextRecord = await VehicleDailyMileage.findOne({
          vehicleId: record.vehicleId,
          businessDate: priorRecovery.nextBusinessDate ?? businessDate,
        }).session(session);
        const selectedEmployeeId =
          nextEmployeeId ?? priorRecovery.handoverEmployeeId ?? null;
        if (
          !nextRecord ||
          record.endOdometerKm !== recoveryOdometerKm ||
          idString(priorRecovery.handoverEmployeeId) !==
            idString(selectedEmployeeId)
        ) {
          throw vehicleError(
            409,
            "ROLLOVER_ALREADY_RECOVERED",
            "This rollover was already recovered with different details",
          );
        }
        return {
          previousRecord: record,
          dailyRecord: nextRecord,
          replayed: true,
        };
      }

      if (record.status !== "ROLLOVER_PENDING") {
        throw vehicleError(
          409,
          "ROLLOVER_RECOVERY_REQUIRED",
          "This daily mileage record is not awaiting rollover recovery",
        );
      }
      if (record.businessDate >= businessDate) {
        throw vehicleError(
          409,
          "ROLLOVER_DATE_CONFLICT",
          "Only a record from a previous Asia/Kolkata business date can be recovered",
        );
      }
      requireRevision(
        record.revision,
        expectedDailyRevision,
        "Daily mileage record",
      );

      const vehicle = await getVehicle(record.vehicleId, session);
      const lastVerifiedOdometerKm = Math.max(
        record.latestOdometerKm,
        vehicle.currentOdometerKm,
      );
      if (recoveryOdometerKm < lastVerifiedOdometerKm) {
        throw vehicleError(
          409,
          "ODOMETER_CONFLICT",
          "Recovery reading cannot be below the last verified vehicle odometer",
        );
      }

      let nextEmployee = null;
      const effectiveNextEmployeeId =
        nextEmployeeId ?? record.activeEmployeeId ?? null;
      if (effectiveNextEmployeeId) {
        nextEmployee = await resolveActiveEmployeeById(
          effectiveNextEmployeeId,
          session,
        );
      }

      const segments = toPlainSegments(record.segments);
      if (record.activeEmployeeId) {
        const segmentIndex = segments.findIndex(
          (segment) =>
            idString(segment.employeeId) === idString(record.activeEmployeeId) &&
            segment.endedAt == null,
        );
        if (segmentIndex < 0) {
          throw vehicleError(
            409,
            "DAILY_MILEAGE_SEGMENT_CONFLICT",
            "The active employee segment is missing; rollover recovery cannot continue",
          );
        }
        let segment = segments[segmentIndex];
        segment = appendSegmentReading(segment, {
          previousOdometerKm: record.latestOdometerKm,
          odometerKm: recoveryOdometerKm,
          occurredAt: now,
          source: "ROLLOVER_RECOVERY",
        });
        segment = {
          ...segment,
          usageSessions: (segment.usageSessions ?? []).map((usageSession) =>
            usageSession.status === "RECOVERY_REQUIRED"
              ? {
                  ...usageSession,
                  endOdometerKm: recoveryOdometerKm,
                  distanceKm:
                    recoveryOdometerKm - usageSession.startOdometerKm,
                  endedAt: now,
                  endedBy: user._id,
                  status: "RECOVERED_COMPLETED",
                }
              : usageSession,
          ),
        };
        segments[segmentIndex] = {
          ...segment,
          endOdometerKm: recoveryOdometerKm,
          distanceKm: recoveryOdometerKm - segment.startOdometerKm,
          endedAt: now,
          endedBy: user._id,
        };
      }

      assertSegmentContinuity(segments, record.startOdometerKm);
      const dailyDistanceKm = recoveryOdometerKm - record.startOdometerKm;
      assertEmbeddedReadingReconciliation(
        segments,
        recoveryOdometerKm,
        dailyDistanceKm,
        { allowUnattributedDistance: !record.activeEmployeeId },
      );
      const segmentDistanceKm = segments.reduce(
        (total, segment) => total + (segment.distanceKm ?? 0),
        0,
      );
      if (
        (record.activeEmployeeId && segmentDistanceKm !== dailyDistanceKm) ||
        (!record.activeEmployeeId && segmentDistanceKm > dailyDistanceKm) ||
        segments.some((segment) => segment.endOdometerKm == null)
      ) {
        throw vehicleError(
          409,
          "ODOMETER_CONFLICT",
          "Recovered employee distances must reconcile with the previous day's vehicle distance",
        );
      }

      const previousAudit = [
        ...record.auditHistory.map((entry) => entry.toObject?.() ?? entry),
        {
          action: "ROLLOVER_RECOVERED",
          actorId: user._id,
          employeeId: record.activeEmployeeId,
          handoverEmployeeId: nextEmployee?._id ?? null,
          nextBusinessDate: businessDate,
          odometerKm: recoveryOdometerKm,
          occurredAt: now,
          details: rolloverAllocationDetails,
        },
      ];
      await casVehicle(vehicle, expectedVehicleRevision, session, {
        currentOdometerKm: recoveryOdometerKm,
        updatedBy: user._id,
      });
      const closed = await VehicleDailyMileage.updateOne(
        {
          _id: record._id,
          status: "ROLLOVER_PENDING",
          activeRecordLock: true,
          revision: expectedDailyRevision,
        },
        {
          $set: {
            endOdometerKm: recoveryOdometerKm,
            dailyDistanceKm,
            latestOdometerKm: recoveryOdometerKm,
            status: "CLOSED",
            activeRecordLock: false,
            activeEmployeeId: null,
            segments,
            auditHistory: previousAudit,
            updatedBy: user._id,
          },
          $inc: { revision: 1 },
        },
        { session, runValidators: true },
      );
      if (closed.matchedCount !== 1) {
        throw vehicleError(
          409,
          "REVISION_CONFLICT",
          "Daily mileage record changed during rollover recovery",
        );
      }

      const snapshot = nextEmployee ? employeeSnapshot(nextEmployee) : null;
      const nextAudit = {
        action: "ROLLOVER_STARTED",
        actorId: user._id,
        employeeId: nextEmployee?._id ?? null,
        odometerKm: recoveryOdometerKm,
        occurredAt: now,
        details: rolloverAllocationDetails,
      };
      const [dailyRecord] = await VehicleDailyMileage.create(
        [
          {
            vehicleId: vehicle._id,
            vehicleRegistrationSnapshot: record.vehicleRegistrationSnapshot,
            businessDate,
            startOdometerKm: recoveryOdometerKm,
            latestOdometerKm: recoveryOdometerKm,
            activeRecordLock: Boolean(nextEmployee),
            activeEmployeeId: nextEmployee?._id ?? null,
            segments: snapshot
              ? [
                  {
                    ...snapshot,
                    startOdometerKm: recoveryOdometerKm,
                    distanceKm: 0,
                    odometerReadingsComplete: true,
                    startedAt: now,
                    startedBy: user._id,
                    odometerReadings: [
                      {
                        odometerKm: recoveryOdometerKm,
                        distanceKm: 0,
                        occurredAt: now,
                        ...snapshot,
                        source: "BASELINE",
                      },
                    ],
                  },
                ]
              : [],
            dailyDistanceKm: 0,
            auditHistory: [nextAudit],
            createdBy: user._id,
            updatedBy: user._id,
          },
        ],
        { session },
      );
      return {
        previousRecord: {
          ...record.toObject(),
          endOdometerKm: recoveryOdometerKm,
          dailyDistanceKm,
          latestOdometerKm: recoveryOdometerKm,
          status: "CLOSED",
          activeRecordLock: false,
          activeEmployeeId: null,
          segments,
          auditHistory: previousAudit,
          revision: expectedDailyRevision + 1,
        },
        dailyRecord,
        replayed: false,
      };
    });
  } catch (error) {
    mapDuplicateError(error);
  }
};
