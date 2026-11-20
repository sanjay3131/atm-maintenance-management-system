import Customer from "../modules/customers/customer.model.js";
import { isCustomerVisibleJob } from "../modules/customers/customerAccess.js";
import ATM from "../modules/atms/atm.model.js";
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

const activeNotificationUserIds = async ({
  userIds,
  userTypes,
  excludeUserId,
}) => {
  const candidates = [...new Set(userIds.map(asId).filter(Boolean))];
  if (!candidates.length) return [];

  const users = await User.find({
    _id: { $in: candidates },
    userType: { $in: userTypes },
    status: "active",
  })
    .select("_id")
    .lean();
  const excludedId = asId(excludeUserId);
  return users
    .map((user) => asId(user._id))
    .filter((userId) => userId && userId !== excludedId);
};

export const resolveActiveNotificationAdminRecipients = async (
  excludeUserId,
) => {
  const users = await User.find({
    userType: { $in: ["admin", "superAdmin"] },
    status: "active",
  })
    .select("_id")
    .lean();
  const excludedId = asId(excludeUserId);
  return users
    .map((user) => asId(user._id))
    .filter((userId) => userId && userId !== excludedId);
};

export const resolveAssignedJobEmployeeNotificationRecipients = async (
  job,
) => {
  const employee = await Employee.findOne({
    userId: asId(job.assignedEmployeeId),
    status: "active",
  })
    .select("userId")
    .lean();
  if (!employee) return [];
  return activeNotificationUserIds({
    userIds: [employee.userId],
    userTypes: ["employee"],
  });
};

export const resolveAssignedLocationTaskEmployeeNotificationRecipients =
  async (task) => {
    const employee = await Employee.findOne({
      _id: asId(task.assignedEmployeeId),
      status: "active",
    })
      .select("userId")
      .lean();
    if (!employee) return [];
    return activeNotificationUserIds({
      userIds: [employee.userId],
      userTypes: ["employee"],
    });
  };

export const resolveLocationRequestEmployeeNotificationRecipients = async (
  request,
  excludeUserId,
) => {
  if (request.requesterRole !== "employee" || !request.requesterEmployeeId) {
    return [];
  }
  const employee = await Employee.findOne({
    _id: asId(request.requesterEmployeeId),
    userId: asId(request.requestedBy),
    status: "active",
  })
    .select("userId")
    .lean();
  if (!employee) return [];
  return activeNotificationUserIds({
    userIds: [employee.userId],
    userTypes: ["employee"],
    excludeUserId,
  });
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

export const resolveDistrictTransferRecipients = async (districtId) => {
  const [atms, adminIds] = await Promise.all([
    ATM.find({ districtId, isDeleted: false })
      .select("assignedEmployeeId")
      .lean(),
    activeAdminIds(),
  ]);
  const relationshipIds = await employeeRelationshipUserIds(
    atms.flatMap((atm) => atm.assignedEmployeeId ?? []),
  );

  return activeUserIds([...adminIds, ...relationshipIds]);
};
