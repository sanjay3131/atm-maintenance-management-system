import ApiError from "../../utils/ApiError.js";
import Employee from "../employees/employee.model.js";
import User from "../users/user.model.js";

const toId = (value) => {
  const id = value?._id ?? value;
  return id == null ? null : String(id);
};

export const getCurrentSupervisedEmployees = async (supervisorId) => {
  const employees = await Employee.find({ supervisorId }).select(
    "_id userId employeeCode designation department status joiningDate employmentType districtIds assignedAtmIds regionIds supervisorId",
  );
  const userIds = [
    ...new Set(
      employees
        .map((employee) => toId(employee.userId))
        .filter((id) => id && /^[a-fA-F0-9]{24}$/.test(id)),
    ),
  ];
  if (userIds.length === 0) return [];

  const users = await User.find({
    _id: { $in: userIds },
    userType: "employee",
  }).select("_id firstName lastName email phoneNumber status");
  const usersById = new Map(users.map((user) => [toId(user._id), user]));

  return employees
    .filter((employee) => usersById.has(toId(employee.userId)))
    .map((employee) => ({
      employee,
      user: usersById.get(toId(employee.userId)),
    }));
};

export const requireCurrentSupervisedEmployee = async (
  employeeId,
  supervisorId,
) => {
  const employee = await Employee.findOne({
    _id: employeeId,
    supervisorId,
  }).select(
    "_id userId employeeCode designation department status joiningDate employmentType districtIds assignedAtmIds regionIds supervisorId",
  );
  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  const userId = toId(employee.userId);
  if (!userId || !/^[a-fA-F0-9]{24}$/.test(userId)) {
    throw new ApiError(404, "Employee not found");
  }
  const user = await User.findOne({ _id: userId, userType: "employee" }).select(
    "_id firstName lastName email phoneNumber status",
  );
  if (!user) throw new ApiError(404, "Employee not found");

  return { employee, user };
};

export const requireCurrentSupervisedJob = async (job, supervisorId) => {
  const userId = toId(job.assignedEmployeeId);
  if (!userId || !/^[a-fA-F0-9]{24}$/.test(userId)) {
    throw new ApiError(404, "Job not found");
  }

  const employee = await Employee.findOne({
    userId,
    supervisorId,
  }).select("_id userId employeeCode");
  if (!employee) throw new ApiError(404, "Job not found");

  const user = await User.findOne({ _id: userId, userType: "employee" }).select(
    "_id firstName lastName",
  );
  if (!user) throw new ApiError(404, "Job not found");

  return { employee, user };
};

export const toIdString = toId;
