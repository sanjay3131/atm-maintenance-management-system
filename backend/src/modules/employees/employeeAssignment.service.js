import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import ATM from "../atms/atm.model.js";
import Employee from "./employee.model.js";
import User from "../users/user.model.js";
import {
  assertATMEmployeeAssignmentsPreserveAMCResponsibility,
  guardEmployeeEligibilityChange,
} from "../amc/amcResponsibility.service.js";

const idValue = (id) => id?._id ?? id;
const idKey = (id) => {
  const value = idValue(id);
  return value == null ? "" : String(value).toLowerCase();
};

const uniqueIds = (ids = []) => [
  ...new Map(
    ids
      .filter(Boolean)
      .map((id) => [idKey(id), idValue(id)])
      .filter(([key]) => key),
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

const loadATM = async (atmId, session) => {
  const atm = await withSession(
    ATM.findOne({ _id: atmId, isDeleted: false }),
    session,
  );
  if (!atm) throw new ApiError(404, "ATM not found");
  return atm;
};

const saveATM = async (atm, updatedBy, session) => {
  atm.updatedBy = updatedBy;
  await atm.save({ session });
  return atm;
};

export const addEmployeeToATMInTransaction = async ({
  atmId,
  employeeId,
  updatedBy,
  session,
}) => {
  const atm = await loadATM(atmId, session);
  const employee = await loadActiveEmployee(employeeId, session);

  atm.assignedEmployeeId = uniqueIds([
    ...(atm.assignedEmployeeId ?? []),
    employee._id,
  ]);
  employee.assignedAtmIds = uniqueIds([
    ...(employee.assignedAtmIds ?? []),
    atm._id,
  ]);
  employee.updatedBy = updatedBy;

  await employee.save({ session });
  await saveATM(atm, updatedBy, session);
  return atm;
};

export const removeEmployeeFromATMInTransaction = async ({
  atmId,
  employeeId,
  updatedBy,
  session,
}) => {
  const atm = await loadATM(atmId, session);
  const employee = await withSession(Employee.findById(employeeId), session);
  if (!employee) throw new ApiError(404, "Employee not found");

  assertATMEmployeeAssignmentsPreserveAMCResponsibility(
    atm,
    (atm.assignedEmployeeId ?? []).filter(
      (id) => idKey(id) !== idKey(employee._id),
    ),
  );
  atm.assignedEmployeeId = uniqueIds(atm.assignedEmployeeId).filter(
    (id) => idKey(id) !== idKey(employee._id),
  );
  employee.assignedAtmIds = uniqueIds(employee.assignedAtmIds).filter(
    (id) => idKey(id) !== idKey(atm._id),
  );
  employee.updatedBy = updatedBy;

  await Promise.all([
    employee.save({ session }),
    saveATM(atm, updatedBy, session),
  ]);
  return atm;
};

export const replaceATMEmployeeAssignmentsInTransaction = async ({
  atmId,
  employeeIds = [],
  updatedBy,
  session,
}) => {
  const atm = await loadATM(atmId, session);
  const desiredEmployeeIds = uniqueIds(employeeIds);
  const employees = await Promise.all(
    desiredEmployeeIds.map((employeeId) =>
      loadActiveEmployee(employeeId, session),
    ),
  );
  const desiredById = new Map(
    employees.map((employee) => [idKey(employee._id), employee]),
  );
  const previousEmployeeIds = uniqueIds(atm.assignedEmployeeId);
  assertATMEmployeeAssignmentsPreserveAMCResponsibility(
    atm,
    desiredEmployeeIds,
  );

  const removedRecords = [];
  for (const id of previousEmployeeIds) {
    if (!desiredById.has(idKey(id))) {
      removedRecords.push(
        await withSession(Employee.findById(id), session),
      );
    }
  }
  for (const employee of removedRecords) {
    if (!employee) continue;
    employee.assignedAtmIds = uniqueIds(employee.assignedAtmIds).filter(
      (id) => idKey(id) !== idKey(atm._id),
    );
    employee.updatedBy = updatedBy;
  }
  for (const employee of employees) {
    employee.assignedAtmIds = uniqueIds([
      ...(employee.assignedAtmIds ?? []),
      atm._id,
    ]);
    employee.updatedBy = updatedBy;
  }

  atm.assignedEmployeeId = employees.map((employee) => employee._id);
  for (const employee of removedRecords.filter(Boolean)) {
    await employee.save({ session });
  }
  for (const employee of employees) {
    await employee.save({ session });
  }
  await saveATM(atm, updatedBy, session);
  return atm;
};

export const replaceATMEmployeeAssignments = async (options) =>
  withEmployeeAssignmentTransaction((session) =>
    replaceATMEmployeeAssignmentsInTransaction({ ...options, session }),
  );

export const addEmployeeToATM = async (options) =>
  withEmployeeAssignmentTransaction((session) =>
    addEmployeeToATMInTransaction({ ...options, session }),
  );

export const removeEmployeeFromATM = async (options) =>
  withEmployeeAssignmentTransaction((session) =>
    removeEmployeeFromATMInTransaction({ ...options, session }),
  );

export const replaceATMEmployeeAssignmentInTransaction = ({
  employeeId,
  ...options
}) =>
  replaceATMEmployeeAssignmentsInTransaction({
    ...options,
    employeeIds: employeeId ? [employeeId] : [],
  });

export const setATMEmployeeAssignment = ({ employeeId, ...options }) =>
  employeeId
    ? addEmployeeToATM({ ...options, employeeId })
    : replaceATMEmployeeAssignments({ ...options, employeeIds: [] });

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

  if (
    employeeUpdates.status !== undefined &&
    employeeUpdates.status !== "active"
  ) {
    await guardEmployeeEligibilityChange({
      employeeId: employee._id,
      session,
      updatedBy,
    });
  }
  Object.assign(employee, employeeUpdates);
  const desiredATMIds = uniqueIds(assignedAtmIds);
  if (desiredATMIds.length > 0) {
    if (employee.status !== "active") {
      throw new ApiError(400, "Employee is inactive");
    }
    await loadActiveEmployee(employee._id, session);
  }

  const previousATMIds = uniqueIds(employee.assignedAtmIds ?? []);
  const affectedATMIds = uniqueIds([...previousATMIds, ...desiredATMIds]);
  const atms = affectedATMIds.length
    ? await withSession(ATM.find({ _id: { $in: affectedATMIds } }), session)
    : [];
  const atmsById = new Map(atms.map((atm) => [idKey(atm._id), atm]));
  if (desiredATMIds.some((id) => !atmsById.has(idKey(id)))) {
    throw new ApiError(404, "One or more ATMs not found");
  }

  const desiredATMKeys = new Set(desiredATMIds.map(idKey));
  for (const atm of atms) {
    const currentEmployeeIds = uniqueIds(atm.assignedEmployeeId ?? []);
    if (!desiredATMKeys.has(idKey(atm._id))) {
      assertATMEmployeeAssignmentsPreserveAMCResponsibility(
        atm,
        currentEmployeeIds.filter(
          (id) => idKey(id) !== idKey(employee._id),
        ),
      );
    }
    atm.assignedEmployeeId = desiredATMKeys.has(idKey(atm._id))
      ? uniqueIds([...currentEmployeeIds, employee._id])
      : currentEmployeeIds.filter(
          (id) => idKey(id) !== idKey(employee._id),
        );
    atm.updatedBy = updatedBy;
  }

  employee.assignedAtmIds = desiredATMIds;
  if (updatedBy) employee.updatedBy = updatedBy;
  await employee.save({ session });
  for (const atm of atms) {
    await atm.save({ session });
  }
  return employee;
};

export const replaceEmployeeATMAssignments = async (options) =>
  withEmployeeAssignmentTransaction((session) =>
    replaceEmployeeATMAssignmentsInTransaction({ ...options, session }),
  );

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
