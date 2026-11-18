import { randomUUID } from "node:crypto";
import ATM from "../atms/atm.model.js";
import Employee from "../employees/employee.model.js";
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
import { publishDomainEventSafely } from "../../realtime/domain-events.js";
import { resolveJobRecipients } from "../../realtime/recipient-resolver.js";
import { captureATMGeographySnapshot } from "../../utils/geographySnapshot.js";
import { withDistrictGeographyFence } from "../districts/districtGeography.service.js";

const NON_DUE_JOB_STATUSES = [
  JOB_STATUS.COMPLETED,
  JOB_STATUS.VERIFIED,
  JOB_STATUS.APPROVED,
  JOB_STATUS.CLOSED,
  JOB_STATUS.CANCELLED,
];
const REALTIME_PUBLISH_CONCURRENCY = 10;

const publishGeneratedJobEvents = async (jobs, publishEvent) => {
  for (
    let index = 0;
    index < jobs.length;
    index += REALTIME_PUBLISH_CONCURRENCY
  ) {
    await Promise.all(
      jobs
        .slice(index, index + REALTIME_PUBLISH_CONCURRENCY)
        .map((job) =>
          publishEvent({
            event: "domain:job:updated",
            entityType: "job",
            entityId: job._id,
            action: "recurring-generated",
            resolveRecipients: () => resolveJobRecipients(job),
          }),
        ),
    );
  }
};

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
  skippedNoSelectedEmployee: 0,
  skippedEmployeeNotAssignedToATM: 0,
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

const normalizeId = (id) => String(id?._id ?? id ?? "").toLowerCase();

const validatePlanEmployee = async (atmId, employeeId, session) => {
  if (!employeeId) {
    throw new ApiError(400, "An Employee must be selected for the recurring plan");
  }

  const atmQuery = ATM.findOne({
    _id: atmId,
    isDeleted: false,
    status: { $in: ["ACTIVE", "UNDER_MAINTENANCE"] },
  }).select("_id districtId assignedEmployeeId");
  if (session) atmQuery.session(session);
  const atm = await atmQuery;
  if (!atm) throw new ApiError(404, "Active ATM not found");

  const employeeQuery = Employee.findById(employeeId).populate(
    "userId",
    "userType status",
  );
  if (session) employeeQuery.session(session);
  const employee = await employeeQuery;
  if (!employee) throw new ApiError(404, "Employee not found");
  if (employee.status !== "active") {
    throw new ApiError(400, "Employee is inactive");
  }
  if (!employee.userId?._id) {
    throw new ApiError(400, "Employee's linked User was not found");
  }
  if (employee.userId.status !== "active") {
    throw new ApiError(400, "Employee's linked User is inactive");
  }
  if (employee.userId.userType !== "employee") {
    throw new ApiError(400, "Employee's linked User must have employee type");
  }
  if (
    !(atm.assignedEmployeeId ?? []).some(
      (assignedEmployeeId) =>
        normalizeId(assignedEmployeeId) === normalizeId(employee._id),
    )
  ) {
    throw new ApiError(400, "Employee must be assigned to the selected ATM");
  }

  return employee;
};

const validateGeneratedPlanEmployee = async (plan, atm, session) => {
  if (!plan.assignedEmployeeId) {
    return {
      counter: "skippedNoSelectedEmployee",
      reason: "Recurring plan has no Employee selected",
    };
  }
  const employeeQuery = Employee.findById(plan.assignedEmployeeId).populate(
    "userId",
    "userType status",
  );
  if (session) employeeQuery.session(session);
  const employee = await employeeQuery;
  if (!employee) {
    return {
      counter: "skippedInactiveEmployee",
      reason: "Selected Employee no longer exists",
    };
  }
  if (employee.status !== "active") {
    return {
      counter: "skippedInactiveEmployee",
      reason: "Selected Employee is inactive",
    };
  }
  if (!employee.userId?._id) {
    return {
      counter: "skippedInactiveEmployee",
      reason: "Selected Employee's linked User no longer exists",
    };
  }
  if (employee.userId.status !== "active") {
    return {
      counter: "skippedInactiveEmployee",
      reason: "Selected Employee's linked User is inactive",
    };
  }
  if (employee.userId.userType !== "employee") {
    return {
      counter: "skippedInactiveEmployee",
      reason: "Selected Employee's linked User is not an employee",
    };
  }
  if (
    !(atm.assignedEmployeeId ?? []).some(
      (assignedEmployeeId) =>
        normalizeId(assignedEmployeeId) === normalizeId(employee._id),
    )
  ) {
    return {
      counter: "skippedEmployeeNotAssignedToATM",
      reason: "Selected Employee is no longer assigned to the plan's ATM",
    };
  }
  return { employee };
};

const addJobHistory = async (job, createdBy, atm, maintenanceType, session) => {
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
  ], { session });
};

export const generateRecurringJobs = async ({
  createdBy,
  now = new Date(),
  publishEvent = publishDomainEventSafely,
} = {}) => {
  const result = createResult();
  const generatedJobs = [];
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

      const eligibility = await validateGeneratedPlanEmployee(plan, atm);
      if (!eligibility.employee) {
        addSkip(
          result,
          eligibility.counter,
          plan,
          atm._id,
          eligibility.reason,
        );
        continue;
      }
      const assignedEmployee = eligibility.employee;
      const occurrenceKey = occurrenceKeyFor(plan, businessDate.dateKey);
      const { title, description } = getTypeDetails(plan.maintenanceType);
      const jobNumber = `JOB-${businessDate.dateKey.replaceAll("-", "")}-R-${randomUUID()
        .slice(0, 8)
        .toUpperCase()}`;

      let job;
      try {
        const creation = await withDistrictGeographyFence(
          [atm.districtId],
          async (session) => {
            const currentPlan = await RecurringMaintenancePlan.findOne({
              _id: plan._id,
              isActive: true,
            }).session(session);
            const currentATM = await ATM.findOne({
              _id: atm._id,
              isDeleted: false,
            }).session(session);
            if (!currentPlan || !currentATM) return { skipped: true };
            if (String(currentATM.districtId) !== String(atm.districtId)) {
              throw new ApiError(409, "ATM geography changed during recurring job generation");
            }
            const currentEligibility = await validateGeneratedPlanEmployee(
              currentPlan,
              currentATM,
              session,
            );
            if (!currentEligibility.employee) {
              return {
                skipped: true,
                counter: currentEligibility.counter,
                reason: currentEligibility.reason,
              };
            }
            const currentEmployee = currentEligibility.employee;
            const snapshot = await captureATMGeographySnapshot(currentATM, session);
            const [createdJob] = await Job.create(
              [{
                jobId: jobNumber,
                jobNumber,
                title,
                description: `${description} ATM: ${currentATM.atmId}. Occurrence: ${businessDate.dateKey}.`,
                atmId: currentATM._id,
                customerId: currentATM.customer || undefined,
                geographySnapshot: snapshot,
                workType: "maintenance",
                priority: "medium",
                status: JOB_STATUS.ASSIGNED,
                assignedEmployeeId: currentEmployee.userId._id,
                assignedBy: adminId,
                assignedAt: now,
                createdBy: adminId,
                recurringMaintenance: {
                  source: "RECURRING",
                  planId: currentPlan._id,
                  maintenanceType: currentPlan.maintenanceType,
                  occurrenceKey,
                  scheduledDate: dayStart,
                  dueAt: dayEnd,
                },
              }],
              { session },
            );
            await addJobHistory(
              createdJob,
              adminId,
              currentATM,
              currentPlan.maintenanceType,
              session,
            );
            return { job: createdJob, atm: currentATM };
          },
        );
        if (creation.skipped) {
          if (creation.counter) {
            addSkip(result, creation.counter, plan, atm._id, creation.reason);
          } else {
            result.skippedNotStarted++;
          }
          continue;
        }
        job = creation.job;
        generatedJobs.push(job);
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
      if (generatedJobs.length === REALTIME_PUBLISH_CONCURRENCY) {
        await publishGeneratedJobEvents(
          generatedJobs.splice(0),
          publishEvent,
        );
      }
    } catch (error) {
      result.errors.push({
        planId: plan._id.toString(),
        atmId: plan.atmId.toString(),
        error: error.message,
      });
    }
  }

  if (generatedJobs.length) {
    await publishGeneratedJobEvents(generatedJobs, publishEvent);
  }

  const [due, overdue] = await Promise.all([
    Job.countDocuments({
      "recurringMaintenance.source": "RECURRING",
      "recurringMaintenance.dueAt": { $gte: dayStart, $lte: dayEnd },
      status: { $nin: NON_DUE_JOB_STATUSES },
      isDeleted: false,
    }),
    Job.countDocuments({
      "recurringMaintenance.source": "RECURRING",
      "recurringMaintenance.dueAt": { $lt: now },
      status: { $nin: NON_DUE_JOB_STATUSES },
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
    .populate("atmId", "atmId clientAtmId locationName status")
    .populate({
      path: "assignedEmployeeId",
      select: "employeeCode status userId",
      populate: { path: "userId", select: "firstName lastName status userType" },
    })
    .sort({ createdAt: -1 });

export const createRecurringMaintenancePlan = async (planData, createdBy) => {
  try {
    const atm = await ATM.findOne({
      _id: planData.atmId,
      isDeleted: false,
      status: { $in: ["ACTIVE", "UNDER_MAINTENANCE"] },
    }).select("_id districtId");
    if (!atm) throw new ApiError(404, "Active ATM not found");

    return await withDistrictGeographyFence([atm.districtId], async (session) => {
      const currentATM = await ATM.findOne({
        _id: planData.atmId,
        isDeleted: false,
        status: { $in: ["ACTIVE", "UNDER_MAINTENANCE"] },
      })
        .select("_id districtId")
        .session(session);
      if (!currentATM) throw new ApiError(404, "Active ATM not found");
      if (String(currentATM.districtId) !== String(atm.districtId)) {
        throw new ApiError(409, "ATM geography changed; retry plan creation");
      }

      await validatePlanEmployee(planData.atmId, planData.assignedEmployeeId, session);
      const fullATM = await ATM.findById(planData.atmId).session(session);
      const geographySnapshot = await captureATMGeographySnapshot(fullATM, session);
      const [plan] = await RecurringMaintenancePlan.create(
        [{ ...planData, geographySnapshot, createdBy }],
        { session },
      );
      return plan;
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
  const atm = await ATM.findById(plan.atmId).select("_id districtId");
  if (!atm) throw new ApiError(404, "ATM not found");

  return withDistrictGeographyFence([atm.districtId], async (session) => {
    const currentPlan = await RecurringMaintenancePlan.findById(planId).session(
      session,
    );
    if (!currentPlan) return null;
    const currentATM = await ATM.findById(currentPlan.atmId)
      .select("_id districtId")
      .session(session);
    if (!currentATM) throw new ApiError(404, "ATM not found");
    if (String(currentATM.districtId) !== String(atm.districtId)) {
      throw new ApiError(409, "ATM geography changed; retry plan update");
    }

    const newDayOfWeek = Object.hasOwn(updates, "dayOfWeek")
      ? updates.dayOfWeek
      : currentPlan.dayOfWeek;
    if (
      currentPlan.maintenanceType === "WEEKLY_MOPPING" &&
      (newDayOfWeek == null || newDayOfWeek < 0 || newDayOfWeek > 6)
    ) {
      throw new ApiError(
        400,
        "A weekday between 0 (Sunday) and 6 (Saturday) is required",
      );
    }
    if (currentPlan.maintenanceType === "DAILY_CLEANING" && newDayOfWeek != null) {
      throw new ApiError(400, "Daily cleaning cannot have a weekday");
    }

    if (updates.isActive === true || Object.hasOwn(updates, "assignedEmployeeId")) {
      await validatePlanEmployee(
        currentPlan.atmId,
        updates.assignedEmployeeId ?? currentPlan.assignedEmployeeId,
        session,
      );
    }

    Object.assign(currentPlan, updates, { updatedBy });
    await currentPlan.save({ session });
    return currentPlan;
  });
};
