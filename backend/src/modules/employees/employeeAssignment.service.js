import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import ATM from "../atms/atm.model.js";
import Employee from "./employee.model.js";
import User from "../users/user.model.js";

const uniqueIds = (ids = []) => [
  ...new Map(
    ids
      .filter(Boolean)
      .map((id) => [String(id?._id ?? id), id?._id ?? id]),
  ).values(),
];

const withSession = (query, session) => query.session(session);

export const withEmployeeAssignmentTransaction = async (operation) => {
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

const loadActiveEmployee = async (employeeId, session) => {
  if (!employeeId) return null;
  const employee = await withSession(Employee.findById(employeeId), session);
  if (!employee) throw new ApiError(404, "Employee not found");
  if (employee.status !== "active") {
    throw new ApiError(400, "Employee is inactive");
  }

  const user = await withSession(
    User.findById(employee.userId).select("userType status"),
    session,
  );
  if (user?.userType !== "employee" || user?.status !== "active") {
    throw new ApiError(400, "Employee is inactive");
  }
  return employee;
};

export const findActiveEmployeeByUserId = async (userId) => {
  const employee = await Employee.findOne({ userId }).populate(
    "userId",
    "userType status",
  );

  if (!employee) throw new ApiError(404, "Employee not found");
  if (
    employee.status !== "active" ||
    employee.userId?.status !== "active" ||
    employee.userId?.userType !== "employee"
  ) {
    throw new ApiError(400, "Employee is inactive");
  }

  return employee;
};

export const replaceATMEmployeeAssignmentInTransaction = async ({
  atmId,
  employeeId,
  updatedBy,
  session,
}) => {
  const atm = await withSession(
    ATM.findOne({ _id: atmId, isDeleted: false }),
    session,
  );
  if (!atm) throw new ApiError(404, "ATM not found");
  const employee = await loadActiveEmployee(employeeId, session);

  const employeeFilter = employee
    ? { _id: { $ne: employee._id }, assignedAtmIds: atm._id }
    : { assignedAtmIds: atm._id };
  await Employee.updateMany(
    employeeFilter,
    { $pull: { assignedAtmIds: atm._id } },
    { session },
  );

  if (employee) {
    employee.assignedAtmIds = uniqueIds([
      ...(employee.assignedAtmIds ?? []),
      atm._id,
    ]);
    employee.updatedBy = updatedBy;
    await employee.save({ session });
  }

  atm.assignedEmployeeId = employee ? [employee._id] : [];
  atm.updatedBy = updatedBy;
  await atm.save({ session });
  return atm;
};

export const setATMEmployeeAssignment = async (options) => {
  return withEmployeeAssignmentTransaction((session) =>
    replaceATMEmployeeAssignmentInTransaction({ ...options, session }),
  );
};

export const replaceEmployeeATMAssignmentsInTransaction = async ({
  employeeId,
  assignedAtmIds,
  updatedBy,
  session,
  employeeToCreate,
  employeeUpdates = {},
}) => {
  const employee = employeeToCreate ??
    (await withSession(Employee.findById(employeeId), session));
  if (!employee) throw new ApiError(404, "Employee not found");

  Object.assign(employee, employeeUpdates);
  const desiredAtmIds = uniqueIds(assignedAtmIds);
  if (desiredAtmIds.length > 0) {
    if (employee.status !== "active") {
      throw new ApiError(400, "Employee is inactive");
    }
    await loadActiveEmployee(employee._id, session);
  }

  const previousAtmIds = uniqueIds(employee.assignedAtmIds ?? []);
  const affectedAtmIds = uniqueIds([...previousAtmIds, ...desiredAtmIds]);
  const atms = affectedAtmIds.length
    ? await withSession(ATM.find({ _id: { $in: affectedAtmIds } }), session)
    : [];
  const atmsById = new Map(atms.map((atm) => [String(atm._id), atm]));
  if (desiredAtmIds.some((id) => !atmsById.has(String(id)))) {
    throw new ApiError(404, "One or more ATMs not found");
  }

  const conflictingATM = desiredAtmIds
    .map((id) => atmsById.get(String(id)))
    .find((atm) =>
      (Array.isArray(atm.assignedEmployeeId)
        ? atm.assignedEmployeeId
        : [])
        .filter(Boolean)
        .some(
          (assignedId) => String(assignedId) !== String(employee._id),
      ),
    );
  if (conflictingATM) {
    throw new ApiError(
      409,
      `ATM ${conflictingATM.atmId} is already assigned to another employee. Reassign it from ATM management.`,
    );
  }

  const removedAtmIds = previousAtmIds.filter(
    (id) => !desiredAtmIds.some((desiredId) => String(desiredId) === String(id)),
  );
  if (removedAtmIds.length > 0) {
    await ATM.updateMany(
      {
        _id: { $in: removedAtmIds },
        assignedEmployeeId: employee._id,
      },
      { $pull: { assignedEmployeeId: employee._id } },
      { session },
    );
  }

  if (desiredAtmIds.length > 0) {
    await Employee.updateMany(
      {
        _id: { $ne: employee._id },
        assignedAtmIds: { $in: desiredAtmIds },
      },
      { $pull: { assignedAtmIds: { $in: desiredAtmIds } } },
      { session },
    );
    await ATM.updateMany(
      { _id: { $in: desiredAtmIds } },
      {
        $set: {
          assignedEmployeeId: [employee._id],
          updatedBy,
        },
      },
      { session },
    );
  }

  employee.assignedAtmIds = desiredAtmIds;
  if (updatedBy) employee.updatedBy = updatedBy;
  await employee.save({ session });
  return employee;
};

export const replaceEmployeeATMAssignments = async (options) => {
  return withEmployeeAssignmentTransaction((session) =>
    replaceEmployeeATMAssignmentsInTransaction({ ...options, session }),
  );
};

export const addEmployeeATMAssignments = async ({
  employeeId,
  assignedAtmIds,
  updatedBy,
}) =>
  withEmployeeAssignmentTransaction(async (session) => {
    const employee = await withSession(Employee.findById(employeeId), session);
    if (!employee) throw new ApiError(404, "Employee not found");
    return replaceEmployeeATMAssignmentsInTransaction({
      employeeId,
      assignedAtmIds: [
        ...(employee.assignedAtmIds ?? []),
        ...assignedAtmIds,
      ],
      updatedBy,
      session,
    });
  });
