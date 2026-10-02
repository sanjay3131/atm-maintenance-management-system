import { randomUUID } from "node:crypto";
import ATM from "../atms/atm.model.js";
import User from "../users/user.model.js";
import Job from "./jobs.model.js";
import JobHistory from "./jobHistory.model.js";
import RecurringMaintenancePlan from "./recurringMaintenancePlan.model.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";
import ApiError from "../../utils/ApiError.js";
import {
  getBusinessDateParts,
  getBusinessDayEnd,
  getBusinessDayStart,
} from "./recurringMaintenance.utils.js";

const SUCCESSFUL_JOB_STATUSES = [
  JOB_STATUS.COMPLETED,
  JOB_STATUS.VERIFIED,
  JOB_STATUS.APPROVED,
  JOB_STATUS.CLOSED,
];

const getTypeDetails = (maintenanceType) => {
  if (maintenanceType === "DAILY_CLEANING") {
    return {
      title: "Daily ATM Cleaning",
      description: "Scheduled daily ATM cleaning.",
    };
  }
  return {
    title: "Weekly ATM Mopping",
    description: "Scheduled weekly ATM mopping.",
  };
};

const isScheduledToday = (plan, businessDate) =>
  plan.maintenanceType === "DAILY_CLEANING" ||
  plan.dayOfWeek === businessDate.weekday;

const occurrenceKeyFor = (plan, dateKey) =>
  `${plan.atmId.toString()}:${plan.maintenanceType}:${dateKey}`;

const createResult = () => ({
  processed: 0,
  created: 0,
  alreadyExists: 0,
  skippedNotScheduled: 0,
  skippedUnassigned: 0,
  skippedInactiveEmployee: 0,
  skippedMultipleAssignments: 0,
  skippedInactiveATM: 0,
  skippedUnsupportedType: 0,
  skippedNoAdmin: 0,
  skippedNotStarted: 0,
  upcoming: 0,
  due: 0,
  overdue: 0,
  skipped: [],
  errors: [],
});

const addSkip = (result, counter, plan, atmId, reason) => {
  result[counter]++;
  result.skipped.push({
    planId: plan._id.toString(),
    atmId: atmId?.toString() || plan.atmId.toString(),
    reason,
  });
};

const addJobHistory = async (job, createdBy, atm, maintenanceType) => {
  await JobHistory.create([
    {
      jobId: job._id,
      action: "created",
      toStatus: JOB_STATUS.PENDING,
      performedBy: createdBy,
      details: {
        title: job.title,
        atmId: atm._id,
        source: "RECURRING",
        maintenanceType,
        occurrenceKey: job.recurringMaintenance.occurrenceKey,
      },
    },
    {
      jobId: job._id,
      action: "assigned",
      fromStatus: JOB_STATUS.PENDING,
      toStatus: JOB_STATUS.ASSIGNED,
      performedBy: createdBy,
      details: {
        assignedTo: job.assignedEmployeeId,
        source: "RECURRING",
      },
    },
  ]);
};

export const generateRecurringJobs = async ({
  createdBy,
  now = new Date(),
} = {}) => {
  const result = createResult();
  const businessDate = getBusinessDateParts(now);
  const dayStart = getBusinessDayStart(businessDate.dateKey);
  const dayEnd = getBusinessDayEnd(businessDate.dateKey);

  const adminId =
    createdBy ||
    (
      await User.findOne({
        userType: { $in: ["admin", "superAdmin"] },
        status: "active",
      }).select("_id")
    )?._id;

  const plans = await RecurringMaintenancePlan.find({ isActive: true }).lean();

  const duePlans = [];
  for (const plan of plans) {
    if (
      !["DAILY_CLEANING", "WEEKLY_MOPPING"].includes(plan.maintenanceType)
    ) {
      result.skippedUnsupportedType++;
      result.errors.push({
        planId: plan._id.toString(),
        atmId: plan.atmId.toString(),
        error: `Unsupported recurring maintenance type: ${plan.maintenanceType}`,
      });
      continue;
    }
    if (plan.startDate > dayEnd) {
      result.skippedNotStarted++;
      continue;
    }
    if (!isScheduledToday(plan, businessDate)) {
      result.skippedNotScheduled++;
      continue;
    }

    result.processed++;
    duePlans.push(plan);
  }

  const atms = await ATM.find({
    _id: { $in: [...new Set(duePlans.map((plan) => plan.atmId.toString()))] },
    isDeleted: false,
  })
    .populate({
      path: "assignedEmployeeId",
      select: "status userId employeeCode",
      populate: { path: "userId", select: "userType status" },
    })
    .lean();
  const atmById = new Map(atms.map((atm) => [atm._id.toString(), atm]));

  for (const plan of duePlans) {
    try {
      if (!adminId) {
        addSkip(
          result,
          "skippedNoAdmin",
          plan,
          plan.atmId,
          "No active admin is available to attribute generated jobs",
        );
        result.errors.push({
          planId: plan._id.toString(),
          atmId: plan.atmId.toString(),
          error: "No active admin is available to attribute generated jobs",
        });
        continue;
      }

      const atm = atmById.get(plan.atmId.toString());

      if (!atm || !["ACTIVE", "UNDER_MAINTENANCE"].includes(atm.status)) {
        addSkip(
          result,
          "skippedInactiveATM",
          plan,
          atm?._id || plan.atmId,
          "ATM is missing, deleted, or inactive",
        );
        continue;
      }

      const assignmentEntries = atm.assignedEmployeeId || [];
      if (assignmentEntries.length > 1) {
        addSkip(
          result,
          "skippedMultipleAssignments",
          plan,
          atm._id,
          "ATM has multiple legacy employee assignments; resolve it in ATM management",
        );
        continue;
      }
      const assignedEmployee = assignmentEntries[0];
      if (!assignedEmployee) {
        addSkip(
          result,
          "skippedUnassigned",
          plan,
          atm._id,
          "ATM has no valid assigned employee",
        );
        continue;
      }

      if (
        !assignedEmployee._id ||
        assignedEmployee.status !== "active" ||
        assignedEmployee.userId?.status !== "active" ||
        assignedEmployee.userId?.userType !== "employee"
      ) {
        addSkip(
          result,
          "skippedInactiveEmployee",
          plan,
          atm._id,
          "Assigned employee or linked User is missing, inactive, or not an employee",
        );
        continue;
      }
      const occurrenceKey = occurrenceKeyFor(plan, businessDate.dateKey);
      const { title, description } = getTypeDetails(plan.maintenanceType);
      const jobNumber = `JOB-${businessDate.dateKey.replaceAll("-", "")}-R-${randomUUID()
        .slice(0, 8)
        .toUpperCase()}`;

      let job;
      try {
        job = await Job.create({
          jobId: jobNumber,
          jobNumber,
          title,
          description: `${description} ATM: ${atm.atmId}. Occurrence: ${businessDate.dateKey}.`,
          atmId: atm._id,
          customerId: atm.customer || undefined,
          workType: "maintenance",
          priority: "medium",
          status: JOB_STATUS.ASSIGNED,
          assignedEmployeeId: assignedEmployee.userId._id,
          assignedBy: adminId,
          assignedAt: now,
          createdBy: adminId,
          recurringMaintenance: {
            source: "RECURRING",
            planId: plan._id,
            maintenanceType: plan.maintenanceType,
            occurrenceKey,
            scheduledDate: dayStart,
            dueAt: dayEnd,
          },
        });
      } catch (error) {
        if (
          error.code === 11000 &&
          (await Job.exists({
            "recurringMaintenance.occurrenceKey": occurrenceKey,
          }))
        ) {
          result.alreadyExists++;
          continue;
        }
        throw error;
      }

      result.created++;
      try {
        await addJobHistory(job, adminId, atm, plan.maintenanceType);
      } catch (error) {
        result.errors.push({
          planId: plan._id.toString(),
          atmId: atm.atmId,
          jobId: job._id.toString(),
          error: `Job created but history could not be recorded: ${error.message}`,
        });
      }
    } catch (error) {
      result.errors.push({
        planId: plan._id.toString(),
        atmId: plan.atmId.toString(),
        error: error.message,
      });
    }
  }

  const [due, overdue] = await Promise.all([
    Job.countDocuments({
      "recurringMaintenance.source": "RECURRING",
      "recurringMaintenance.dueAt": { $gte: dayStart, $lte: dayEnd },
      status: { $nin: SUCCESSFUL_JOB_STATUSES },
      isDeleted: false,
    }),
    Job.countDocuments({
      "recurringMaintenance.source": "RECURRING",
      "recurringMaintenance.dueAt": { $lt: now },
      status: { $nin: SUCCESSFUL_JOB_STATUSES },
      isDeleted: false,
    }),
  ]);
  result.due = due;
  result.overdue = overdue;
  const nextBusinessDate = getBusinessDateParts(
    new Date(dayStart.getTime() + 86_400_000),
  );
  const nextDayEnd = getBusinessDayEnd(nextBusinessDate.dateKey);
  result.upcoming = plans.filter(
    (plan) =>
      ["DAILY_CLEANING", "WEEKLY_MOPPING"].includes(plan.maintenanceType) &&
      plan.startDate <= nextDayEnd && isScheduledToday(plan, nextBusinessDate),
  ).length;

  return result;
};

export const getRecurringMaintenancePlans = async () =>
  RecurringMaintenancePlan.find()
    .populate("atmId", "atmId locationName status")
    .sort({ createdAt: -1 });

export const createRecurringMaintenancePlan = async (planData, createdBy) => {
  const atm = await ATM.findOne({
    _id: planData.atmId,
    isDeleted: false,
    status: { $in: ["ACTIVE", "UNDER_MAINTENANCE"] },
  }).select("_id");
  if (!atm) throw new ApiError(404, "Active ATM not found");

  try {
    return await RecurringMaintenancePlan.create({
      ...planData,
      createdBy,
    });
  } catch (error) {
    if (error.code === 11000) {
      throw new ApiError(
        409,
        "A plan for this ATM and maintenance type already exists",
      );
    }
    throw error;
  }
};

export const updateRecurringMaintenancePlan = async (
  planId,
  updates,
  updatedBy,
) => {
  const plan = await RecurringMaintenancePlan.findById(planId);
  if (!plan) return null;

  const newDayOfWeek = Object.hasOwn(updates, "dayOfWeek")
    ? updates.dayOfWeek
    : plan.dayOfWeek;
  if (
    plan.maintenanceType === "WEEKLY_MOPPING" &&
    (newDayOfWeek == null || newDayOfWeek < 0 || newDayOfWeek > 6)
  ) {
    throw new ApiError(
      400,
      "A weekday between 0 (Sunday) and 6 (Saturday) is required",
    );
  }
  if (plan.maintenanceType === "DAILY_CLEANING" && newDayOfWeek != null) {
    throw new ApiError(400, "Daily cleaning cannot have a weekday");
  }

  Object.assign(plan, updates, { updatedBy });
  await plan.save();
  return plan;
};
