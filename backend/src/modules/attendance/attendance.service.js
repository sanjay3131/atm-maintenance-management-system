import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import Attendance from "./attendance.model.js";
import AttendanceCorrection from "./attendanceCorrection.model.js";
import AttendanceEntryAudit from "./attendanceEntryAudit.model.js";
import Employee from "../employees/employee.model.js";
import {
  attendanceDateOnlySchema,
  attendanceCorrectionSchema,
  onBehalfCheckInSchema,
  onBehalfCheckOutSchema,
} from "./attendance.validation.js";

const ATTENDANCE_TIMEZONE = "Asia/Kolkata";
const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
const ADMIN_ROLES = new Set(["admin", "superAdmin"]);
const ON_BEHALF_ROLES = new Set(["admin", "superAdmin", "supervisor"]);

const toId = (value) => value?._id ?? value;
const sameId = (left, right) =>
  String(toId(left) ?? "").toLowerCase() ===
  String(toId(right) ?? "").toLowerCase();

const getErrorMessage = (error) =>
  error?.issues?.map((issue) => issue.message).join("; ") ||
  "Invalid attendance input";

const requireObjectId = (value, label) => {
  if (typeof value !== "string" || !OBJECT_ID_PATTERN.test(value)) {
    throw new ApiError(400, `Invalid ${label}`);
  }
};

const requireActor = (actor, allowedRoles) => {
  if (!actor?._id || !allowedRoles.has(actor.userType)) {
    throw new ApiError(403, "You do not have permission to perform this action");
  }
};

const isDuplicateKeyError = (error) => error?.code === 11000;
const conflict = (message) => new ApiError(409, message);

const getBusinessDate = (date) => {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new ApiError(400, "Invalid attendance timestamp");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATTENDANCE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

const getActiveEmployeeForUser = async (userId) => {
  if (!userId) throw new ApiError(401, "Authenticated User is required");
  const employee = await Employee.findOne({ userId }).populate(
    "userId",
    "userType status",
  );
  if (!employee) throw new ApiError(404, "Employee not found");
  if (
    employee.status !== "active" ||
    employee.userId?.userType !== "employee" ||
    employee.userId?.status !== "active"
  ) {
    throw new ApiError(403, "Employee and linked User must both be active");
  }
  return employee;
};

const getEmployeeForUser = async (userId) => {
  if (!userId) throw new ApiError(401, "Authenticated User is required");
  const employee = await Employee.findOne({ userId }).populate(
    "userId",
    "userType status",
  );
  if (!employee) throw new ApiError(404, "Employee not found");
  return employee;
};

const getActiveEmployeeById = async (employeeId) => {
  requireObjectId(employeeId, "Employee ID");
  const employee = await Employee.findById(employeeId).populate(
    "userId",
    "userType status",
  );
  if (!employee) throw new ApiError(404, "Employee not found");
  if (
    employee.status !== "active" ||
    employee.userId?.userType !== "employee" ||
    employee.userId?.status !== "active"
  ) {
    throw new ApiError(403, "Employee and linked User must both be active");
  }
  return employee;
};

const requireSupervisorScope = (employee, actor) => {
  if (
    actor.userType === "supervisor" &&
    !sameId(employee.supervisorId, actor._id)
  ) {
    throw new ApiError(403, "Employee is not under your supervision");
  }
};

const parseOptionalTimestamp = (value, schema, field, now) => {
  const parsed = schema.safeParse({ [field]: value });
  if (!parsed.success) {
    throw new ApiError(400, getErrorMessage(parsed.error));
  }
  if (value === undefined) return now;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ApiError(400, `Invalid ${field}`);
  }
  if (date > now) {
    throw new ApiError(400, `${field} cannot be in the future`);
  }
  return date;
};

const requireHistoricalReason = (timestamps, reason, now) => {
  const isHistorical = timestamps.some(
    (timestamp) => timestamp && timestamp < now,
  );
  if (
    isHistorical &&
    (typeof reason !== "string" || reason.trim().length === 0 || reason.trim().length > 1000)
  ) {
    throw new ApiError(
      400,
      "A nonempty reason of at most 1000 characters is required for historical attendance",
    );
  }
  return typeof reason === "string" ? reason.trim() : "";
};

const translateDuplicateKey = (error, message) => {
  if (isDuplicateKeyError(error)) throw conflict(message);
  throw error;
};

const withAttendanceTransaction = async (operation) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const resolveOnBehalfEmployee = async (employeeId, actor) => {
  requireActor(actor, ON_BEHALF_ROLES);
  const employee = await getActiveEmployeeById(employeeId);
  requireSupervisorScope(employee, actor);
  return employee;
};

export const resolveEmployeeForAuthenticatedUser = getEmployeeForUser;

const buildAttendanceFilter = ({ employeeId, fromDate, toDate }) => ({
  ...(employeeId ? { employeeId } : {}),
  ...(fromDate || toDate
    ? {
        attendanceDate: {
          ...(fromDate ? { $gte: fromDate } : {}),
          ...(toDate ? { $lte: toDate } : {}),
        },
      }
    : {}),
});

const getPaginatedAttendance = async (filter, { page, limit }) => {
  const skip = (page - 1) * limit;
  const [records, total] = await Promise.all([
    Attendance.find(filter)
      .sort({ attendanceDate: -1, checkInAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit),
    Attendance.countDocuments(filter),
  ]);
  return {
    records,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const listMyAttendance = async (authenticatedUser, filters) => {
  if (authenticatedUser?.userType !== "employee") {
    throw new ApiError(403, "Only employees can access their attendance");
  }
  const employee = await getEmployeeForUser(authenticatedUser._id);
  return getPaginatedAttendance(
    {
      employeeId: employee._id,
      ...buildAttendanceFilter(filters),
    },
    filters,
  );
};

export const listAttendanceRecords = async (actor, filters) => {
  requireActor(actor, ON_BEHALF_ROLES);
  const filter = buildAttendanceFilter(filters);
  if (actor.userType === "supervisor") {
    if (filters.employeeId) {
      requireObjectId(filters.employeeId, "Employee ID");
      const employee = await Employee.findById(filters.employeeId);
      if (!employee) throw new ApiError(404, "Employee not found");
      requireSupervisorScope(employee, actor);
      filter.employeeId = employee._id;
    } else {
      const supervisedEmployees = await Employee.find({
        supervisorId: actor._id,
      }).select("_id");
      const employeeIds = supervisedEmployees.map((employee) => employee._id);
      if (employeeIds.length === 0) {
        return {
          records: [],
          pagination: {
            page: filters.page,
            limit: filters.limit,
            total: 0,
            totalPages: 0,
          },
        };
      }
      filter.employeeId = { $in: employeeIds };
    }
  } else if (filters.employeeId) {
    requireObjectId(filters.employeeId, "Employee ID");
  }
  return getPaginatedAttendance(filter, filters);
};

export const getAttendanceRecord = async (attendanceId, actor) => {
  requireActor(actor, ON_BEHALF_ROLES);
  requireObjectId(attendanceId, "Attendance ID");
  const attendance = await Attendance.findById(attendanceId);
  if (!attendance) throw new ApiError(404, "Attendance not found");

  if (actor.userType === "supervisor") {
    const employee = await Employee.findById(attendance.employeeId);
    if (!employee) throw new ApiError(404, "Employee not found");
    requireSupervisorScope(employee, actor);
  }
  return attendance;
};

export const checkInForEmployee = async (authenticatedUser, now = new Date()) => {
  const employee = await getActiveEmployeeForUser(authenticatedUser?._id);
  const checkInAt = new Date(now);
  const attendanceDate = getBusinessDate(checkInAt);

  try {
    const existing = await Attendance.findOne({
      employeeId: employee._id,
      attendanceDate,
    });
    if (existing) throw conflict("Attendance already exists for this business date");

    return await Attendance.create({
      employeeId: employee._id,
      attendanceDate,
      checkInAt,
      checkOutAt: null,
      checkInRecordedBy: authenticatedUser._id,
      checkOutRecordedBy: null,
      checkInSource: "employee",
      checkOutSource: null,
    });
  } catch (error) {
    translateDuplicateKey(
      error,
      "Attendance already exists for this business date",
    );
  }
};

export const checkOutForEmployee = async (
  authenticatedUser,
  now = new Date(),
) => {
  const employee = await getEmployeeForUser(authenticatedUser?._id);
  const checkOutAt = new Date(now);
  if (!Number.isFinite(checkOutAt.getTime())) {
    throw new ApiError(400, "Invalid attendance timestamp");
  }
  const openRecords = await Attendance.find({
    employeeId: employee._id,
    checkOutAt: null,
  }).limit(2);
  if (openRecords.length === 0) {
    throw conflict("No open attendance record exists for the employee");
  }
  if (openRecords.length > 1) {
    throw conflict("Multiple open attendance records exist for the employee");
  }

  const [openRecord] = openRecords;
  const attendance = await Attendance.findOneAndUpdate(
    {
      _id: openRecord._id,
      employeeId: employee._id,
      checkOutAt: null,
      checkInAt: { $lte: checkOutAt },
    },
    {
      $set: {
        checkOutAt,
        checkOutRecordedBy: authenticatedUser._id,
        checkOutSource: "employee",
      },
    },
    { new: true, runValidators: true },
  );
  if (!attendance) {
    throw conflict("No open attendance record exists for the current business date");
  }
  return attendance;
};

export const recordAttendanceForEmployee = async ({
  employeeId,
  actor,
  checkInAt: requestedCheckInAt,
  checkOutAt: requestedCheckOutAt,
  reason,
  now = new Date(),
}) => {
  const employee = await resolveOnBehalfEmployee(employeeId, actor);
  const parsedCheckIn = onBehalfCheckInSchema.safeParse({
    ...(requestedCheckInAt === undefined
      ? {}
      : { checkInAt: requestedCheckInAt }),
  });
  if (!parsedCheckIn.success) {
    throw new ApiError(400, getErrorMessage(parsedCheckIn.error));
  }
  const parsedCheckOut = onBehalfCheckOutSchema.safeParse({
    ...(requestedCheckOutAt === undefined
      ? {}
      : { checkOutAt: requestedCheckOutAt }),
  });
  if (!parsedCheckOut.success) {
    throw new ApiError(400, getErrorMessage(parsedCheckOut.error));
  }

  const checkInAt = parseOptionalTimestamp(
    requestedCheckInAt,
    onBehalfCheckInSchema,
    "checkInAt",
    now,
  );
  const checkOutAt =
    requestedCheckOutAt === undefined
      ? null
      : parseOptionalTimestamp(
          requestedCheckOutAt,
          onBehalfCheckOutSchema,
          "checkOutAt",
          now,
        );
  if (checkOutAt && checkOutAt < checkInAt) {
    throw new ApiError(400, "Check-out must not be earlier than check-in");
  }
  requireHistoricalReason([checkInAt, checkOutAt], reason, now);
  const attendanceDate = getBusinessDate(checkInAt);

  try {
    return await withAttendanceTransaction(async (session) => {
      const existing = await Attendance.findOne({
        employeeId: employee._id,
        attendanceDate,
      }).session(session);
      if (existing) {
        throw conflict("Attendance already exists for this business date");
      }

      const [attendance] = await Attendance.create(
        [
          {
            employeeId: employee._id,
            attendanceDate,
            checkInAt,
            checkOutAt,
            checkInRecordedBy: actor._id,
            checkOutRecordedBy: checkOutAt ? actor._id : null,
            checkInSource: actor.userType,
            checkOutSource: checkOutAt ? actor.userType : null,
          },
        ],
        { session },
      );
      const [audit] = await AttendanceEntryAudit.create(
        [
          {
            attendanceId: attendance._id,
            employeeId: employee._id,
            actorId: actor._id,
            reason: reason?.trim() || null,
            enteredValues: {
              checkInAt,
              checkOutAt,
              attendanceDate,
            },
            recordedAt: new Date(),
          },
        ],
        { session },
      );
      return { attendance, audit };
    });
  } catch (error) {
    translateDuplicateKey(
      error,
      "Attendance already exists for this business date",
    );
  }
};

export const checkOutAttendanceForEmployee = async ({
  employeeId,
  actor,
  checkOutAt: requestedCheckOutAt,
  attendanceDate: requestedAttendanceDate,
  reason,
  now = new Date(),
}) => {
  const employee = await resolveOnBehalfEmployee(employeeId, actor);
  const checkOutAt = parseOptionalTimestamp(
    requestedCheckOutAt,
    onBehalfCheckOutSchema,
    "checkOutAt",
    now,
  );
  requireHistoricalReason([checkOutAt], reason, now);
  const parsedAttendanceDate =
    requestedAttendanceDate === undefined
      ? undefined
      : attendanceDateOnlySchema.safeParse(requestedAttendanceDate);
  if (parsedAttendanceDate && !parsedAttendanceDate.success) {
    throw new ApiError(400, getErrorMessage(parsedAttendanceDate.error));
  }
  const attendanceDate =
    parsedAttendanceDate?.data ?? getBusinessDate(checkOutAt);

  const attendance = await Attendance.findOneAndUpdate(
    {
      employeeId: employee._id,
      attendanceDate,
      checkOutAt: null,
      checkInAt: { $lte: checkOutAt },
    },
    {
      $set: {
        checkOutAt,
        checkOutRecordedBy: actor._id,
        checkOutSource: actor.userType,
      },
    },
    { new: true, runValidators: true },
  );
  if (!attendance) {
    throw conflict("No eligible open attendance record exists for this business date");
  }
  return attendance;
};

export const correctAttendance = async ({
  attendanceId,
  actor,
  reason,
  checkInAt: requestedCheckInAt,
  checkOutAt: requestedCheckOutAt,
  attendanceDate: requestedAttendanceDate,
}) => {
  requireActor(actor, ADMIN_ROLES);
  requireObjectId(attendanceId, "Attendance ID");

  const parsed = attendanceCorrectionSchema.safeParse({
    reason,
    ...(requestedCheckInAt === undefined
      ? {}
      : { checkInAt: requestedCheckInAt }),
    ...(requestedCheckOutAt === undefined
      ? {}
      : { checkOutAt: requestedCheckOutAt }),
    ...(requestedAttendanceDate === undefined
      ? {}
      : { attendanceDate: requestedAttendanceDate }),
  });
  if (!parsed.success) {
    throw new ApiError(400, getErrorMessage(parsed.error));
  }

  const revisedCheckInAt =
    requestedCheckInAt === undefined
      ? undefined
      : new Date(requestedCheckInAt);
  const revisedCheckOutAt =
    requestedCheckOutAt === undefined
      ? undefined
      : requestedCheckOutAt === null
        ? null
        : new Date(requestedCheckOutAt);

  try {
    return await withAttendanceTransaction(async (session) => {
      const current = await Attendance.findById(attendanceId).session(session);
      if (!current) throw new ApiError(404, "Attendance not found");

      const originalValues = {
        checkInAt: new Date(current.checkInAt),
        checkOutAt: current.checkOutAt ? new Date(current.checkOutAt) : null,
        attendanceDate: current.attendanceDate,
      };
      const revisedValues = {
        checkInAt: revisedCheckInAt ?? originalValues.checkInAt,
        checkOutAt:
          revisedCheckOutAt === undefined
            ? originalValues.checkOutAt
            : revisedCheckOutAt,
        attendanceDate:
          requestedAttendanceDate ?? originalValues.attendanceDate,
      };
      if (
        revisedValues.checkOutAt &&
        revisedValues.checkOutAt < revisedValues.checkInAt
      ) {
        throw new ApiError(400, "Check-out must not be earlier than check-in");
      }

      const revisedAttendance = await Attendance.findOneAndUpdate(
        {
          _id: current._id,
          checkInAt: originalValues.checkInAt,
          checkOutAt: originalValues.checkOutAt,
          attendanceDate: originalValues.attendanceDate,
        },
        {
          $set: {
            checkInAt: revisedValues.checkInAt,
            checkOutAt: revisedValues.checkOutAt,
            attendanceDate: revisedValues.attendanceDate,
            ...(revisedValues.checkOutAt === null
              ? { checkOutRecordedBy: null, checkOutSource: null }
              : originalValues.checkOutAt === null
                ? {
                    checkOutRecordedBy: actor._id,
                    checkOutSource: actor.userType,
                  }
                : {}),
          },
        },
        { new: true, runValidators: true, session },
      );
      if (!revisedAttendance) {
        throw conflict("Attendance changed during correction; reload and retry");
      }

      try {
        const [audit] = await AttendanceCorrection.create(
          [
            {
              attendanceId: current._id,
              employeeId: current.employeeId,
              reason: parsed.data.reason,
              originalValues,
              revisedValues,
              correctedBy: actor._id,
              correctedAt: new Date(),
            },
          ],
          { session },
        );
        return { attendance: revisedAttendance, correction: audit };
      } catch (error) {
        translateDuplicateKey(error, "Attendance correction conflict");
      }
    });
  } catch (error) {
    translateDuplicateKey(error, "Attendance correction conflicts with another business-date record");
  }
};
