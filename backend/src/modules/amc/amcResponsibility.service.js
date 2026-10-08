import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import ATM from "../atms/atm.model.js";
import Employee from "../employees/employee.model.js";
import User from "../users/user.model.js";

const withSession = (query, session) => query.session(session);
const idKey = (value) =>
  String(value?._id ?? value ?? "").toLowerCase();

export const withAMCResponsibilityTransaction = async (operation) => {
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

const loadATM = async (atmId, session) => {
  const atm = await withSession(
    ATM.findOne({ _id: atmId, isDeleted: false }),
    session,
  );
  if (!atm) throw new ApiError(404, "ATM not found");
  return atm;
};

const loadEligibleEmployee = async (employeeId, session) => {
  const employee = await withSession(Employee.findById(employeeId), session);
  if (!employee) throw new ApiError(404, "Employee not found");
  if (employee.status !== "active") {
    throw new ApiError(400, "AMC responsible employee must be active");
  }

  const user = await withSession(
    User.findById(employee.userId).select("userType status"),
    session,
  );
  if (!user) throw new ApiError(404, "Employee's linked User was not found");
  if (user.status !== "active" || user.userType !== "employee") {
    throw new ApiError(
      400,
      "AMC responsible employee's linked User must be active and have employee type",
    );
  }

  return employee;
};

export const setATMAMCResponsibleEmployee = ({
  atmId,
  employeeId,
  updatedBy,
}) =>
  withAMCResponsibilityTransaction(async (session) => {
    const atm = await loadATM(atmId, session);
    if (employeeId !== null) {
      const employee = await loadEligibleEmployee(employeeId, session);
      const isAssigned = (atm.assignedEmployeeId ?? []).some(
        (assignedId) => idKey(assignedId) === idKey(employee._id),
      );
      if (!isAssigned) {
        throw new ApiError(
          400,
          "AMC responsible employee must already be assigned to this ATM",
        );
      }
      atm.amcResponsibleEmployeeId = employee._id;
    } else {
      atm.amcResponsibleEmployeeId = null;
    }
    atm.updatedBy = updatedBy;
    await atm.save({ session });
    return atm;
  });

const assertNoResponsibleEmployeeRemoval = (atm, employeeIdsToKeep) => {
  const responsibleId = idKey(atm.amcResponsibleEmployeeId);
  if (
    responsibleId &&
    !employeeIdsToKeep.some((employeeId) => idKey(employeeId) === responsibleId)
  ) {
    throw new ApiError(
      409,
      "Cannot remove this employee because they are currently responsible for AMC for this ATM. Change or clear AMC responsibility first.",
    );
  }
};

export const assertATMEmployeeAssignmentsPreserveAMCResponsibility = (
  atm,
  employeeIdsToKeep,
) => assertNoResponsibleEmployeeRemoval(atm, employeeIdsToKeep);

export const guardEmployeeEligibilityChange = async ({
  employeeId,
  session,
  updatedBy,
}) => {
  const atms = await withSession(
    ATM.find({
      $or: [
        { assignedEmployeeId: employeeId },
        { amcResponsibleEmployeeId: employeeId },
      ],
      isDeleted: false,
    }),
    session,
  );
  if (
    atms.some(
      (atm) => idKey(atm.amcResponsibleEmployeeId) === idKey(employeeId),
    )
  ) {
    throw new ApiError(
      409,
      "Cannot deactivate this employee while they are responsible for AMC. Change or clear AMC responsibility first.",
    );
  }
  for (const atm of atms) {
    atm.updatedBy = updatedBy;
    await atm.save({ session });
  }
};

export const guardUserEligibilityChange = async ({
  userId,
  session,
  updatedBy,
}) => {
  const employees = await withSession(Employee.find({ userId }), session);
  if (employees.length === 0) return;
  const employeeIds = employees.map((employee) => employee._id);
  const atms = await withSession(
    ATM.find({
      $or: [
        { assignedEmployeeId: { $in: employeeIds } },
        { amcResponsibleEmployeeId: { $in: employeeIds } },
      ],
      isDeleted: false,
    }),
    session,
  );
  if (
    atms.some((atm) =>
      employeeIds.some(
        (employeeId) =>
          idKey(atm.amcResponsibleEmployeeId) === idKey(employeeId),
      ),
    )
  ) {
    throw new ApiError(
      409,
      "Cannot change this User's eligibility while they are responsible for AMC. Change or clear AMC responsibility first.",
    );
  }
  for (const atm of atms) {
    atm.updatedBy = updatedBy;
    await atm.save({ session });
  }
};
