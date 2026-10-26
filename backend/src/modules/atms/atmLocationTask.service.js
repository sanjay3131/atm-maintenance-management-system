import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import ATM from "./atm.model.js";
import ATMLocationRequest from "./atmLocationRequest.model.js";
import ATMLocationTask from "./atmLocationTask.model.js";
import Employee from "../employees/employee.model.js";

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

const sessionQuery = (query, session) =>
  session ? query.session(session) : query;

const isDuplicateKeyError = (error) => error?.code === 11000;

const isTransientTransactionError = (error) =>
  (typeof error?.hasErrorLabel === "function" &&
    error.hasErrorLabel("TransientTransactionError")) ||
  (Array.isArray(error?.errorLabels) &&
    error.errorLabels.includes("TransientTransactionError"));

const loadEligibleEmployee = async (employeeId, session) => {
  const employee = await sessionQuery(Employee.findById(employeeId), session)
    .populate("userId", "userType status");
  if (!employee) throw new ApiError(404, "Employee not found");
  if (employee.status !== "active") {
    throw new ApiError(400, "Employee is inactive");
  }
  if (
    employee.userId?.userType !== "employee" ||
    employee.userId?.status !== "active"
  ) {
    throw new ApiError(400, "Employee's linked User is not an active employee");
  }
  return employee;
};

const loadATM = async (atmId, session) => {
  const atm = await sessionQuery(
    ATM.findOne({ _id: atmId, isDeleted: false }),
    session,
  );
  if (!atm) throw new ApiError(404, "ATM not found");
  return atm;
};

const assertTaskTypeMatchesATM = (taskType, atm) => {
  if (taskType === "INITIAL_COLLECTION" && atm.locationConfigured === true) {
    throw new ApiError(
      409,
      "Initial collection tasks are only valid for ATMs without a confirmed location",
    );
  }
  if (taskType === "LOCATION_CORRECTION" && atm.locationConfigured !== true) {
    throw new ApiError(
      409,
      "Location correction tasks require an existing confirmed location",
    );
  }
};

const asTaskResult = (task) => ({
  _id: task._id,
  atmId: task.atmId,
  assignedEmployeeId: task.assignedEmployeeId,
  taskType: task.taskType,
  status: task.status,
  active: task.active,
  createdBy: task.createdBy,
  correctionReason: task.correctionReason,
  locationRequestId: task.locationRequestId,
  assignmentHistory: task.assignmentHistory,
  completedAt: task.completedAt,
  completedBy: task.completedBy,
  heldAt: task.heldAt,
  heldBy: task.heldBy,
  resumedAt: task.resumedAt,
  resumedBy: task.resumedBy,
  cancelledAt: task.cancelledAt,
  cancelledBy: task.cancelledBy,
  cancellationReason: task.cancellationReason,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
});

const validateBatch = (tasks) => {
  const seen = new Set();
  const errors = [];
  tasks.forEach((task, index) => {
    const key = String(task.atmId).toLowerCase();
    if (seen.has(key)) {
      errors.push({
        index,
        atmId: task.atmId,
        message: "An ATM may appear only once in a bulk assignment",
      });
    }
    seen.add(key);
  });
  if (errors.length) {
    throw new ApiError(400, "Bulk location task validation failed", errors);
  }
};

export const createBulkATMLocationTasks = async ({ tasks, adminId }) => {
  validateBatch(tasks);
  try {
    return await withTransaction(async (session) => {
      const errors = [];
      const validated = [];
      const lockFailures = new Map();

      const atmIds = [...new Set(tasks.map(({ atmId }) => String(atmId)))].sort();
      for (const atmId of atmIds) {
        try {
          const locked = await ATM.bumpLocationWorkflowRevision(atmId, session);
          if (!locked) throw new ApiError(404, "ATM not found");
        } catch (error) {
          if (isTransientTransactionError(error)) throw error;
          lockFailures.set(atmId.toLowerCase(), error);
        }
      }

      for (const [index, taskInput] of tasks.entries()) {
        try {
          const lockFailure = lockFailures.get(
            String(taskInput.atmId).toLowerCase(),
          );
          if (lockFailure) throw lockFailure;
          const atm = await loadATM(taskInput.atmId, session);
          const employee = await loadEligibleEmployee(
            taskInput.employeeId,
            session,
          );
          assertTaskTypeMatchesATM(taskInput.taskType, atm);
          const existing = await sessionQuery(
            ATMLocationTask.findOne({ atmId: atm._id, active: true }),
            session,
          );
          if (existing) {
            throw new ApiError(409, "ATM already has an active location task");
          }
          const pendingRequest = await sessionQuery(
            ATMLocationRequest.findOne({
              atmId: atm._id,
              status: "PENDING",
              locationTaskId: null,
            }),
            session,
          );
          if (pendingRequest) {
            throw new ApiError(
              409,
              "ATM already has a pending location request",
            );
          }
          validated.push({ taskInput, atm, employee });
        } catch (error) {
          if (isTransientTransactionError(error)) throw error;
          errors.push({
            index,
            atmId: taskInput.atmId,
            employeeId: taskInput.employeeId,
            statusCode: error.statusCode ?? 500,
            message: error.message,
          });
        }
      }
      if (errors.length) {
        throw new ApiError(400, "Bulk location task validation failed", errors);
      }

      const created = [];
      for (const { taskInput, atm, employee } of validated) {
        const [task] = await ATMLocationTask.create(
          [
            {
              atmId: atm._id,
              assignedEmployeeId: employee._id,
              taskType: taskInput.taskType,
              status: "ASSIGNED",
              active: true,
              createdBy: adminId,
              correctionReason: taskInput.correctionReason ?? null,
              assignmentHistory: [
                {
                  previousEmployeeId: null,
                  newEmployeeId: employee._id,
                  actedBy: adminId,
                  assignedAt: new Date(),
                  reason: taskInput.assignmentReason ?? null,
                },
              ],
            },
          ],
          { session },
        );
        created.push(asTaskResult(task));
      }
      return created;
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ApiError(
        409,
        "One or more ATMs already have an active location task",
      );
    }
    throw error;
  }
};

export const listATMLocationTasks = async ({
  page,
  limit,
  status,
  taskType,
  atmId,
  assignedEmployeeId,
}) => {
  const filter = {
    ...(status ? { status } : {}),
    ...(taskType ? { taskType } : {}),
    ...(atmId ? { atmId } : {}),
    ...(assignedEmployeeId ? { assignedEmployeeId } : {}),
  };
  const skip = (page - 1) * limit;
  const [tasks, total] = await Promise.all([
    ATMLocationTask.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate("atmId", "atmId locationName address locationConfigured location bankId districtId regionId")
      .populate("atmId.bankId", "bankName")
      .populate("atmId.districtId", "districtName")
      .populate("atmId.regionId", "name")
      .populate("assignedEmployeeId", "employeeCode userId")
      .populate("createdBy", "firstName lastName userType")
      .populate("locationRequestId"),
    ATMLocationTask.countDocuments(filter),
  ]);
  return {
    tasks: tasks.map(asTaskResult),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const listMyATMLocationTasks = async ({ userId, ...options }) => {
  const employee = await Employee.findOne({ userId, status: "active" });
  if (!employee) throw new ApiError(403, "Active employee record not found");
  return listATMLocationTasks({
    ...options,
    assignedEmployeeId: employee._id,
  });
};

export const startATMLocationTask = async ({ taskId, employeeUserId }) => {
  const employee = await Employee.findOne({
    userId: employeeUserId,
    status: "active",
  });
  if (!employee) throw new ApiError(403, "Active employee record not found");
  const task = await ATMLocationTask.findOneAndUpdate(
    {
      _id: taskId,
      assignedEmployeeId: employee._id,
      active: true,
      status: "ASSIGNED",
    },
    { $set: { status: "IN_PROGRESS" } },
    { new: true, runValidators: true },
  );
  if (!task) {
    throw new ApiError(
      409,
      "Location task is unavailable, already started, or not assigned to you",
    );
  }
  return asTaskResult(task);
};

export const holdATMLocationTask = async ({ taskId, employeeUserId }) => {
  const employee = await Employee.findOne({
    userId: employeeUserId,
    status: "active",
  });
  if (!employee) throw new ApiError(403, "Active employee record not found");
  const heldAt = new Date();
  const task = await ATMLocationTask.findOneAndUpdate(
    {
      _id: taskId,
      assignedEmployeeId: employee._id,
      active: true,
      status: "IN_PROGRESS",
      locationRequestId: null,
    },
    {
      $set: {
        status: "ON_HOLD",
        heldAt,
        heldBy: employeeUserId,
        updatedBy: employeeUserId,
      },
    },
    { new: true, runValidators: true },
  );
  if (!task) {
    throw new ApiError(
      409,
      "Location task cannot be held because it is unavailable, has a submitted proposal, or is not assigned to you",
    );
  }
  return asTaskResult(task);
};

export const resumeATMLocationTask = async ({ taskId, employeeUserId }) => {
  const employee = await Employee.findOne({
    userId: employeeUserId,
    status: "active",
  });
  if (!employee) throw new ApiError(403, "Active employee record not found");
  const resumedAt = new Date();
  const task = await ATMLocationTask.findOneAndUpdate(
    {
      _id: taskId,
      assignedEmployeeId: employee._id,
      active: true,
      status: "ON_HOLD",
      locationRequestId: null,
    },
    {
      $set: {
        status: "IN_PROGRESS",
        resumedAt,
        resumedBy: employeeUserId,
        updatedBy: employeeUserId,
      },
    },
    { new: true, runValidators: true },
  );
  if (!task) {
    throw new ApiError(
      409,
      "Location task cannot be resumed because it is unavailable, has a submitted proposal, or is not assigned to you",
    );
  }
  return asTaskResult(task);
};

export const reassignATMLocationTask = async ({
  taskId,
  employeeId,
  adminId,
  reason,
}) => {
  const employee = await loadEligibleEmployee(employeeId, null);
  const current = await ATMLocationTask.findOne({
    _id: taskId,
    active: true,
    status: { $in: ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
  });
  if (!current) {
    throw new ApiError(409, "Location task is not eligible for reassignment");
  }
  if (String(current.assignedEmployeeId) === String(employee._id)) {
    throw new ApiError(
      400,
      "Employee is already assigned to this location task",
    );
  }
  const assignedAt = new Date();
  const task = await ATMLocationTask.findOneAndUpdate(
    {
      _id: taskId,
      assignedEmployeeId: current.assignedEmployeeId,
      active: true,
      status: { $in: ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
    },
    {
      $set: {
        assignedEmployeeId: employee._id,
        status: "ASSIGNED",
        updatedBy: adminId,
      },
      $push: {
        assignmentHistory: {
          previousEmployeeId: current.assignedEmployeeId,
          newEmployeeId: employee._id,
          actedBy: adminId,
          assignedAt,
          reason: reason ?? null,
        },
      },
    },
    { new: true, runValidators: true },
  );
  if (!task) {
    throw new ApiError(409, "Location task changed before reassignment");
  }
  return asTaskResult(task);
};

export const reopenRejectedATMLocationTask = async ({
  taskId,
  employeeId,
  adminId,
  reason,
}) => {
  const employee = await loadEligibleEmployee(employeeId, null);
  const existing = await ATMLocationTask.findOne({
    _id: taskId,
    active: true,
    status: "REJECTED",
  });
  if (!existing) throw new ApiError(409, "Location task is not rejected");
  const reopenedAt = new Date();
  const task = await ATMLocationTask.findOneAndUpdate(
    { _id: taskId, active: true, status: "REJECTED" },
    {
      $set: {
        assignedEmployeeId: employee._id,
        status: "ASSIGNED",
        locationRequestId: null,
        updatedBy: adminId,
      },
      $push: {
        assignmentHistory: {
          previousEmployeeId: existing.assignedEmployeeId,
          newEmployeeId: employee._id,
          actedBy: adminId,
          assignedAt: reopenedAt,
          reason,
        },
      },
    },
    { new: true, runValidators: true },
  );
  if (!task) throw new ApiError(409, "Location task changed before reopening");
  return asTaskResult(task);
};

export const cancelATMLocationTask = async ({
  taskId,
  adminId,
  reason,
}) => {
  const cancelledAt = new Date();
  const task = await ATMLocationTask.findOneAndUpdate(
    {
      _id: taskId,
      active: true,
      status: { $in: ["ASSIGNED", "IN_PROGRESS", "ON_HOLD", "REJECTED"] },
    },
    {
      $set: {
        active: false,
        status: "CANCELLED",
        cancelledAt,
        cancelledBy: adminId,
        cancellationReason: reason,
        updatedBy: adminId,
      },
    },
    { new: true, runValidators: true },
  );
  if (!task) {
    throw new ApiError(
      409,
      "Location task cannot be cancelled while it is pending review or inactive",
    );
  }
  return asTaskResult(task);
};

export const taskRequestSubmissionFilter = ({ taskId, atmId, employeeId }) => ({
  _id: taskId,
  atmId,
  assignedEmployeeId: employeeId,
  active: true,
  status: "IN_PROGRESS",
});
