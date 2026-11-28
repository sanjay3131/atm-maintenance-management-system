import mongoose from "mongoose";
import ATM from "../atms/atm.model.js";
import ApiError from "../../utils/ApiError.js";
import CleaningRecord from "./cleaningRecord.model.js";
import Employee from "../employees/employee.model.js";
import RecurringMaintenancePlan from "../jobs/recurringMaintenancePlan.model.js";
import User from "../users/user.model.js";
import {
  getBusinessDateParts,
  getBusinessDayStart,
} from "../jobs/recurringMaintenance.utils.js";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const NO_HISTORY_GRACE_DAYS = 7;
const MONITORING_QUERY_TIMEOUT_MS = 15_000;
const CLEANING_MAINTENANCE_TYPES = ["DAILY_CLEANING", "WEEKLY_MOPPING"];

const assertMonitoringRequestActive = ({ signal, deadline }) => {
  if (signal?.aborted) {
    throw new ApiError(499, "Cleaning export was cancelled");
  }
  if (deadline !== undefined && Date.now() >= deadline) {
    throw new ApiError(504, "Cleaning export exceeded its time limit");
  }
};

const getMonitoringQueryOptions = ({ signal, deadline }) => {
  assertMonitoringRequestActive({ signal, deadline });
  const options = {};
  if (signal) options.signal = signal;
  if (deadline !== undefined) {
    const remainingMs = deadline - Date.now();
    const maxTimeMS = Math.floor(
      Math.min(MONITORING_QUERY_TIMEOUT_MS, remainingMs),
    );
    if (!Number.isFinite(maxTimeMS) || maxTimeMS < 1) {
      throw new ApiError(504, "Cleaning export exceeded its time limit");
    }
    options.maxTimeMS = maxTimeMS;
  }
  return options;
};

const getReferenceId = (reference) => reference?._id ?? reference ?? null;

const getUniqueReferenceIds = (references) => [
  ...new Map(
    references
      .map(getReferenceId)
      .filter((id) => id != null)
      .map((id) => [String(id), id]),
  ).values(),
];

const findMonitoringDocumentsByIds = async (
  model,
  ids,
  selection,
  requestOptions,
) => {
  assertMonitoringRequestActive(requestOptions);
  if (ids.length === 0) return new Map();

  const query = model
    .find({ _id: { $in: ids } })
    .select(selection);
  const options = getMonitoringQueryOptions(requestOptions);
  if (Object.keys(options).length > 0) {
    query.setOptions(options);
  }
  const documents = await query.lean();
  assertMonitoringRequestActive(requestOptions);
  return new Map(documents.map((document) => [String(document._id), document]));
};

const getAgeInCalendarDays = (cleaningDate, todayDateKey) =>
  Math.round(
    (getBusinessDayStart(todayDateKey).getTime() -
      getBusinessDayStart(cleaningDate).getTime()) /
      DAY_IN_MILLISECONDS,
  );

export const getCleaningMonitoringStatus = (
  plan,
  latestCleaningDate,
  now = new Date(),
) => {
  const ageInCalendarDays = latestCleaningDate
    ? getAgeInCalendarDays(
        latestCleaningDate,
        getBusinessDateParts(now).dateKey,
      )
    : null;

  const activationTime = plan.monitoringActivatedAt
    ? new Date(plan.monitoringActivatedAt).getTime()
    : Number.NaN;
  if (!Number.isFinite(activationTime)) {
    return {
      status: "CONFIGURATION_REQUIRED",
      ageInCalendarDays,
    };
  }

  if (latestCleaningDate) {
    if (plan.maintenanceType === "DAILY_CLEANING") {
      return {
        status: ageInCalendarDays <= 0 ? "GREEN" : "RED",
        ageInCalendarDays,
      };
    }

    return {
      status: ageInCalendarDays <= 2 ? "GREEN" : "RED",
      ageInCalendarDays,
    };
  }

  const gracePeriodEndsAt =
    activationTime + NO_HISTORY_GRACE_DAYS * DAY_IN_MILLISECONDS;
  return {
    status: now.getTime() < gracePeriodEndsAt ? "GRACE_PERIOD" : "NO_HISTORY",
    ageInCalendarDays: null,
  };
};

const getLatestCleaningDatesByPlanIds = async (
  planIds,
  todayDateKey,
  requestOptions = {},
) => {
  assertMonitoringRequestActive(requestOptions);
  if (planIds.length === 0) return new Map();

  const pipeline = [
    {
      $match: {
        recurringPlanId: { $in: planIds },
        validityStatus: "VALID",
        cleaningDate: { $lte: todayDateKey },
      },
    },
    { $sort: { cleaningDate: -1, submittedAt: -1 } },
    {
      $group: {
        _id: "$recurringPlanId",
        cleaningDate: { $first: "$cleaningDate" },
      },
    },
  ];
  const options = getMonitoringQueryOptions(requestOptions);
  const latestRecords = Object.keys(options).length > 0
    ? await CleaningRecord.aggregate(pipeline, options)
    : await CleaningRecord.aggregate(pipeline);
  assertMonitoringRequestActive(requestOptions);
  return new Map(
    latestRecords.map(({ _id, cleaningDate }) => [
      String(_id),
      cleaningDate,
    ]),
  );
};

export const getLatestValidCleaningDateForPlan = async (
  planId,
  now = new Date(),
) => {
  const todayDateKey = getBusinessDateParts(now).dateKey;
  const planObjectId =
    planId instanceof mongoose.Types.ObjectId
      ? planId
      : new mongoose.Types.ObjectId(planId);
  const latestDateByPlanId = await getLatestCleaningDatesByPlanIds(
    [planObjectId],
    todayDateKey,
  );
  return latestDateByPlanId.get(String(planId)) ?? null;
};

export const getCleaningMonitoringRecordForPlan = async (
  plan,
  now = new Date(),
) => {
  if (
    !plan?.isActive ||
    !CLEANING_MAINTENANCE_TYPES.includes(plan.maintenanceType)
  ) {
    return null;
  }

  const latestCleaningDate = await getLatestValidCleaningDateForPlan(
    plan._id,
    now,
  );
  const { status, ageInCalendarDays } = getCleaningMonitoringStatus(
    plan,
    latestCleaningDate,
    now,
  );
  return {
    planId: String(plan._id),
    latestCleaningDate,
    ageInCalendarDays,
    status,
  };
};

const toMonitoringATM = (atm) => {
  if (!atm || typeof atm !== "object" || !atm._id) return null;
  return {
    _id: String(atm._id),
    atmId: atm.atmId,
    clientAtmId: atm.clientAtmId ?? null,
    locationName: atm.locationName,
  };
};

const toMonitoringEmployee = (employee) => {
  if (!employee || typeof employee !== "object" || !employee._id) return null;
  const user =
    employee.userId && typeof employee.userId === "object"
      ? employee.userId
      : null;
  return {
    _id: String(employee._id),
    employeeCode: employee.employeeCode,
    userId: user
      ? {
          firstName: user.firstName,
          lastName: user.lastName,
        }
      : null,
  };
};

export const getCleaningMonitoringRecords = async (
  now = new Date(),
  requestOptions = {},
) => {
  assertMonitoringRequestActive(requestOptions);
  const planQuery = RecurringMaintenancePlan.find({
    isActive: true,
    maintenanceType: { $in: CLEANING_MAINTENANCE_TYPES },
  })
    .select(
      "_id atmId assignedEmployeeId maintenanceType dayOfWeek monitoringActivatedAt",
    )
    .sort({ createdAt: -1 });
  const planOptions = getMonitoringQueryOptions(requestOptions);
  if (Object.keys(planOptions).length > 0) {
    planQuery.setOptions(planOptions);
  }
  const plans = await planQuery.lean();
  assertMonitoringRequestActive(requestOptions);

  if (plans.length === 0) return [];

  const atmsById = await findMonitoringDocumentsByIds(
    ATM,
    getUniqueReferenceIds(plans.map(({ atmId }) => atmId)),
    "atmId clientAtmId locationName",
    requestOptions,
  );
  const employeesById = await findMonitoringDocumentsByIds(
    Employee,
    getUniqueReferenceIds(
      plans.map(({ assignedEmployeeId }) => assignedEmployeeId),
    ),
    "employeeCode userId",
    requestOptions,
  );
  const usersById = await findMonitoringDocumentsByIds(
    User,
    getUniqueReferenceIds(
      [...employeesById.values()].map(({ userId }) => userId),
    ),
    "firstName lastName",
    requestOptions,
  );
  assertMonitoringRequestActive(requestOptions);

  const todayDateKey = getBusinessDateParts(now).dateKey;
  const latestDateByPlanId = await getLatestCleaningDatesByPlanIds(
    plans.map(({ _id }) => _id),
    todayDateKey,
    requestOptions,
  );
  assertMonitoringRequestActive(requestOptions);

  return plans.map((plan) => {
    const employee = employeesById.get(
      String(getReferenceId(plan.assignedEmployeeId)),
    );
    const latestCleaningDate =
      latestDateByPlanId.get(String(plan._id)) ?? null;
    const planWithRelations = {
      ...plan,
      atmId: atmsById.get(String(getReferenceId(plan.atmId))) ?? null,
      assignedEmployeeId: employee
        ? {
            ...employee,
            userId:
              usersById.get(String(getReferenceId(employee.userId))) ?? null,
          }
        : null,
    };
    const { status, ageInCalendarDays } = getCleaningMonitoringStatus(
      planWithRelations,
      latestCleaningDate,
      now,
    );

    return {
      planId: String(plan._id),
      atm: toMonitoringATM(planWithRelations.atmId),
      responsibleEmployee: toMonitoringEmployee(
        planWithRelations.assignedEmployeeId,
      ),
      maintenanceType: plan.maintenanceType,
      dayOfWeek: plan.dayOfWeek ?? null,
      monitoringActivatedAt: plan.monitoringActivatedAt
        ? new Date(plan.monitoringActivatedAt).toISOString()
        : null,
      latestCleaningDate,
      ageInCalendarDays,
      status,
    };
  });
};
