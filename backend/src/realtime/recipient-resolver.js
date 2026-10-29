import Customer from "../modules/customers/customer.model.js";
import { isCustomerVisibleJob } from "../modules/customers/customerAccess.js";
import Employee from "../modules/employees/employee.model.js";
import User from "../modules/users/user.model.js";

const asId = (value) => String(value?._id ?? value ?? "");

const activeUserIds = async (ids) => {
  const candidates = [...new Set(ids.map(asId).filter(Boolean))];
  if (!candidates.length) return [];

  const users = await User.find({
    _id: { $in: candidates },
    status: "active",
  })
    .select("_id")
    .lean();
  return users.map((user) => asId(user._id));
};

const activeAdminIds = async () => {
  const users = await User.find({
    userType: { $in: ["admin", "superAdmin"] },
    status: "active",
  })
    .select("_id")
    .lean();
  return users.map((user) => asId(user._id));
};

const employeeRelationshipUserIds = async (employeeIds) => {
  const ids = [...new Set(employeeIds.map(asId).filter(Boolean))];
  if (!ids.length) return [];

  const employees = await Employee.find({
    $or: [{ _id: { $in: ids } }, { userId: { $in: ids } }],
    status: "active",
  })
    .select("userId supervisorId")
    .lean();

  return employees.flatMap((employee) => [
    employee.userId,
    employee.supervisorId,
  ]);
};

const customerUserId = async (customerId) => {
  if (!customerId) return null;
  const customer = await Customer.findOne({
    _id: customerId,
    isActive: true,
    isDeleted: false,
  })
    .select("userId")
    .lean();
  return customer?.userId ?? null;
};

export const resolveJobRecipients = async (
  job,
  { previousEmployeeId } = {},
) => {
  const [relationshipIds, customerId, adminIds] = await Promise.all([
    employeeRelationshipUserIds([job.assignedEmployeeId, previousEmployeeId]),
    isCustomerVisibleJob(job) ? customerUserId(job.customerId) : null,
    activeAdminIds(),
  ]);

  return activeUserIds([
    ...adminIds,
    job.createdBy,
    job.updatedBy,
    job.assignedEmployeeId,
    previousEmployeeId,
    ...relationshipIds,
    customerId,
  ]);
};

export const resolveLocationTaskRecipients = async (task) => {
  const historyEmployeeIds = (task.assignmentHistory ?? []).flatMap(
    ({ previousEmployeeId, newEmployeeId }) => [
      previousEmployeeId,
      newEmployeeId,
    ],
  );
  const relationshipIds = await employeeRelationshipUserIds([
    task.assignedEmployeeId,
    ...historyEmployeeIds,
  ]);

  return activeUserIds([
    ...(await activeAdminIds()),
    task.createdBy,
    task.updatedBy,
    task.assignedEmployeeId,
    ...relationshipIds,
  ]);
};

export const resolveLocationRequestRecipients = async (request) => {
  const relationshipIds = await employeeRelationshipUserIds([
    request.requesterEmployeeId,
  ]);

  return activeUserIds([
    ...(await activeAdminIds()),
    request.requestedBy,
    request.reviewedBy,
    ...relationshipIds,
  ]);
};

export const resolveATMRecipients = async (atm) => {
  const relationshipIds = await employeeRelationshipUserIds(
    atm.assignedEmployeeId ?? [],
  );
  return activeUserIds([
    ...(await activeAdminIds()),
    ...relationshipIds,
  ]);
};
