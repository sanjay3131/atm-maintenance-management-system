import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import Job from "../jobs/jobs.model.js";
import RecurringMaintenancePlan from "../jobs/recurringMaintenancePlan.model.js";
import {
  getBusinessDateParts,
  getBusinessDayStart,
} from "../jobs/recurringMaintenance.utils.js";
import Employee from "../employees/employee.model.js";
import User from "../users/user.model.js";
import JobPhoto from "../jobPhotos/jobPhotos.model.js";
import CleaningRecord from "./cleaningRecord.model.js";
import {
  getCleaningMonitoringRecordForPlan,
  getLatestValidCleaningDateForPlan,
} from "./cleaningMonitoring.service.js";

const HISTORY_LIMIT = 20;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const asId = (value) => (value == null ? null : String(value._id ?? value));

const getHistoryPipeline = ({ planId, fromDate, toDate, page, limit }) => {
  const planObjectId = new mongoose.Types.ObjectId(planId);
  const stages = [
    {
      $match: {
        "recurringMaintenance.source": "RECURRING",
        "recurringMaintenance.planId": planObjectId,
        isDeleted: false,
      },
    },
    {
      $lookup: {
        from: CleaningRecord.collection.name,
        let: { jobId: "$_id", planId: planObjectId },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$recurringJobId", "$$jobId"] },
                  { $eq: ["$recurringPlanId", "$$planId"] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "cleaningRecord",
      },
    },
    {
      $unwind: {
        path: "$cleaningRecord",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        historyDate: {
          $dateToString: {
            date: "$recurringMaintenance.scheduledDate",
            format: "%Y-%m-%d",
            timezone: "Asia/Kolkata",
          },
        },
        activityAt: {
          $ifNull: ["$cleaningRecord.submittedAt", "$createdAt"],
        },
        stableId: { $toString: "$_id" },
        job: {
          _id: "$_id",
          status: "$status",
          scheduledDate: "$recurringMaintenance.scheduledDate",
          beforePhotoIds: { $ifNull: ["$beforePhotos", []] },
          afterPhotoIds: { $ifNull: ["$afterPhotos", []] },
        },
        record: "$cleaningRecord",
      },
    },
    {
      $unionWith: {
        coll: CleaningRecord.collection.name,
        pipeline: [
          { $match: { recurringPlanId: planObjectId } },
          {
            $lookup: {
              from: Job.collection.name,
              let: { jobId: "$recurringJobId", planId: "$recurringPlanId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$_id", "$$jobId"] },
                        { $eq: ["$isDeleted", false] },
                        {
                          $eq: [
                            "$recurringMaintenance.source",
                            "RECURRING",
                          ],
                        },
                        {
                          $eq: [
                            "$recurringMaintenance.planId",
                            "$$planId",
                          ],
                        },
                      ],
                    },
                  },
                },
                { $project: { _id: 1 } },
              ],
              as: "linkedJob",
            },
          },
          {
            $match: {
              $expr: { $eq: [{ $size: "$linkedJob" }, 0] },
            },
          },
          { $unset: "linkedJob" },
          {
            $project: {
              _id: 0,
              historyDate: "$cleaningDate",
              activityAt: "$submittedAt",
              stableId: { $toString: "$_id" },
              job: { $literal: null },
              record: "$$ROOT",
            },
          },
        ],
      },
    },
    {
      $set: {
        record: {
          $cond: [
            { $ne: [{ $ifNull: ["$record", null] }, null] },
            {
              $mergeObjects: [
                "$record",
                {
                  submissionHistory: {
                    $slice: [
                      { $ifNull: ["$record.submissionHistory", []] },
                      -HISTORY_LIMIT,
                    ],
                  },
                  correctionHistory: {
                    $slice: [
                      { $ifNull: ["$record.correctionHistory", []] },
                      -HISTORY_LIMIT,
                    ],
                  },
                },
              ],
            },
            null,
          ],
        },
        historyTruncated: {
          submissionHistory: {
            $gt: [
              { $size: { $ifNull: ["$record.submissionHistory", []] } },
              HISTORY_LIMIT,
            ],
          },
          correctionHistory: {
            $gt: [
              { $size: { $ifNull: ["$record.correctionHistory", []] } },
              HISTORY_LIMIT,
            ],
          },
        },
      },
    },
  ];

  const dateFilter = {};
  if (fromDate) dateFilter.$gte = fromDate;
  if (toDate) dateFilter.$lte = toDate;
  if (Object.keys(dateFilter).length) {
    stages.push({ $match: { historyDate: dateFilter } });
  }

  stages.push({
    $facet: {
      entries: [
        { $sort: { historyDate: -1, activityAt: -1, stableId: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ],
      count: [{ $count: "total" }],
    },
  });

  return stages;
};

const collectValues = (entries, selector) =>
  [...new Set(entries.flatMap(selector).filter(Boolean).map(String))].map(
    (id) => new mongoose.Types.ObjectId(id),
  );

const loadRelatedData = async (entries) => {
  const userIds = collectValues(entries, ({ record }) => [
    record?.submittedBy,
    ...(record?.submissionHistory ?? []).map(({ submittedBy }) => submittedBy),
    ...(record?.correctionHistory ?? []).map(({ correctedBy }) => correctedBy),
  ]);
  const employeeIds = collectValues(entries, ({ record }) => [
    record?.responsibleEmployeeId,
    record?.actualCleanerEmployeeId,
    ...(record?.submissionHistory ?? []).map(
      ({ actualCleanerEmployeeId }) => actualCleanerEmployeeId,
    ),
  ]);
  const photoIds = collectValues(entries, ({ job, record }) => [
    ...(job?.beforePhotoIds ?? []),
    ...(job?.afterPhotoIds ?? []),
    ...(record?.evidencePhotoIds ?? []),
    ...(record?.submissionHistory ?? []).flatMap(
      ({ evidencePhotoIds }) => evidencePhotoIds ?? [],
    ),
  ]);

  const [users, employees, photos] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select("_id firstName lastName")
          .lean()
      : [],
    employeeIds.length
      ? Employee.find({ _id: { $in: employeeIds } })
          .select("_id employeeCode userId")
          .populate({ path: "userId", select: "firstName lastName" })
          .lean()
      : [],
    photoIds.length
      ? JobPhoto.find({ _id: { $in: photoIds } })
          .select("_id photoType url thumbnailUrl uploadedAt isExpired")
          .lean()
      : [],
  ]);

  const userById = new Map(users.map((user) => [String(user._id), user]));
  const employeeById = new Map(
    employees.map((employee) => [String(employee._id), employee]),
  );
  const photoById = new Map(photos.map((photo) => [String(photo._id), photo]));

  const toUser = (id) => {
    const user = userById.get(asId(id));
    if (!user) return null;
    return {
      id: String(user._id),
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
    };
  };
  const toEmployee = (id) => {
    const employee = employeeById.get(asId(id));
    if (!employee) return null;
    return {
      id: String(employee._id),
      employeeCode: employee.employeeCode,
      name: employee.userId
        ? [employee.userId.firstName, employee.userId.lastName]
            .filter(Boolean)
            .join(" ")
        : "",
    };
  };
  const toPhoto = (id) => {
    const photo = photoById.get(asId(id));
    if (!photo) return null;
    return {
      id: String(photo._id),
      photoType: photo.photoType,
      url: photo.isExpired ? null : photo.url ?? null,
      thumbnailUrl: photo.isExpired ? null : photo.thumbnailUrl ?? null,
      uploadedAt: photo.uploadedAt
        ? new Date(photo.uploadedAt).toISOString()
        : null,
      available: !photo.isExpired && Boolean(photo.url),
    };
  };
  const toPhotos = (ids) => (ids ?? []).map(toPhoto).filter(Boolean);

  return {
    toUser,
    toEmployee,
    toPhotos,
  };
};

const toSubmission = (submission, related) => ({
  actualCleanerType: submission.actualCleanerType,
  actualCleanerEmployee: related.toEmployee(
    submission.actualCleanerEmployeeId,
  ),
  outsourcedCleanerName: submission.outsourcedCleanerName ?? null,
  actualCleaningDate: submission.cleaningDate,
  reportingMethod: submission.reportingMethod,
  submittedBy: related.toUser(submission.submittedBy),
  submittedAt: submission.submittedAt
    ? new Date(submission.submittedAt).toISOString()
    : null,
  remarks: submission.remarks ?? "",
  evidencePhotos: related.toPhotos(submission.evidencePhotoIds),
});

const toHistoryEntry = (entry, related) => {
  const { job, record } = entry;
  return {
    scheduledJob: job
      ? {
          id: String(job._id),
          status: job.status,
          scheduledDate: job.scheduledDate
            ? new Date(job.scheduledDate).toISOString()
            : null,
          beforePhotos: related.toPhotos(job.beforePhotoIds),
          afterPhotos: related.toPhotos(job.afterPhotoIds),
        }
      : null,
    cleaningRecord: record
      ? {
          id: String(record._id),
          actualCleaningDate: record.cleaningDate,
          cleanerType: record.actualCleanerType,
          actualCleanerEmployee: related.toEmployee(
            record.actualCleanerEmployeeId,
          ),
          outsourcedCleanerName: record.outsourcedCleanerName ?? null,
          reportingEmployee: related.toEmployee(record.responsibleEmployeeId),
          submittedBy: related.toUser(record.submittedBy),
          reportingMethod: record.reportingMethod,
          submittedAt: record.submittedAt
            ? new Date(record.submittedAt).toISOString()
            : null,
          remarks: record.remarks ?? "",
          evidencePhotos: related.toPhotos(record.evidencePhotoIds),
          validityStatus: record.validityStatus,
          submissionHistory: (record.submissionHistory ?? []).map((submission) =>
            toSubmission(submission, related),
          ),
          correctionHistory: (record.correctionHistory ?? []).map(
            (correction) => ({
              correctedBy: related.toUser(correction.correctedBy),
              correctedAt: correction.correctedAt
                ? new Date(correction.correctedAt).toISOString()
                : null,
              reason: correction.reason,
              changes: (correction.changes ?? []).map((change) => ({
                field: change.field,
                previousValue: change.previousValue ?? null,
                correctedValue: change.correctedValue ?? null,
              })),
            }),
          ),
          historyTruncated: entry.historyTruncated,
        }
      : null,
  };
};

const toOverview = (plan) => {
  const atm = plan.atmId;
  const snapshot = plan.geographySnapshot ?? {};
  const bank = atm?.bankId;
  const region = atm?.regionId;
  const district = atm?.districtId;
  const employee = plan.assignedEmployeeId;
  const employeeUser = employee?.userId;

  return {
    planId: String(plan._id),
    isActive: plan.isActive,
    atm: atm
      ? {
          id: String(atm._id),
          atmId: atm.atmId,
          clientAtmId: atm.clientAtmId ?? null,
          location: atm.locationName,
          bank: {
            id: asId(bank) ?? asId(snapshot.bankId),
            name: bank?.bankName ?? snapshot.bankName ?? null,
            code: bank?.bankCode ?? null,
          },
          region: {
            id: asId(region) ?? asId(snapshot.regionId),
            name: region?.name ?? snapshot.regionName ?? null,
          },
          district: {
            id: asId(district) ?? asId(snapshot.districtId),
            name: district?.districtName ?? snapshot.districtName ?? null,
          },
        }
      : null,
    assignedEmployee: employee
      ? {
          id: String(employee._id),
          employeeCode: employee.employeeCode,
          name: employeeUser
            ? [employeeUser.firstName, employeeUser.lastName]
                .filter(Boolean)
                .join(" ")
            : "",
        }
      : null,
    maintenanceType: plan.maintenanceType,
  };
};

const planQuery = (planId) =>
  RecurringMaintenancePlan.findById(planId)
    .select(
      "_id isActive atmId geographySnapshot assignedEmployeeId maintenanceType dayOfWeek monitoringActivatedAt",
    )
    .populate({
      path: "atmId",
      select: "atmId clientAtmId locationName bankId regionId districtId",
      populate: [
        { path: "bankId", select: "bankName bankCode" },
        { path: "regionId", select: "name" },
        { path: "districtId", select: "districtName" },
      ],
    })
    .populate({
      path: "assignedEmployeeId",
      select: "employeeCode userId",
      populate: { path: "userId", select: "firstName lastName" },
    })
    .lean();

const getInactivePlanLatestCleaning = async (planId, now) => {
  const todayDateKey = getBusinessDateParts(now).dateKey;
  const latestCleaningDate = await getLatestValidCleaningDateForPlan(
    planId,
    now,
  );
  if (!latestCleaningDate) {
    return { latestCleaningDate: null, ageInCalendarDays: null };
  }
  const ageInCalendarDays = Math.round(
    (getBusinessDayStart(todayDateKey).getTime() -
      getBusinessDayStart(latestCleaningDate).getTime()) /
      DAY_IN_MILLISECONDS,
  );
  return {
    latestCleaningDate,
    ageInCalendarDays,
  };
};

export const getRecurringCleaningPlanHistory = async ({
  planId,
  page = 1,
  limit = 25,
  fromDate,
  toDate,
  now = new Date(),
}) => {
  const plan = await planQuery(planId);
  if (!plan) throw new ApiError(404, "Recurring maintenance plan not found");

  const [historyResult, activeMonitoring, inactiveLatest] = await Promise.all([
    Job.aggregate(getHistoryPipeline({ planId, fromDate, toDate, page, limit })),
    plan.isActive
      ? getCleaningMonitoringRecordForPlan(plan, now)
      : Promise.resolve(null),
    plan.isActive ? Promise.resolve(null) : getInactivePlanLatestCleaning(planId, now),
  ]);

  let latestCleaningDate;
  let ageInCalendarDays;
  let status;
  if (plan.isActive) {
    const monitoring = activeMonitoring;
    if (!monitoring) {
      throw new ApiError(
        500,
        "Active plan is missing from cleaning monitoring results",
      );
    }
    latestCleaningDate = monitoring.latestCleaningDate;
    ageInCalendarDays = monitoring.ageInCalendarDays;
    status = monitoring.status;
  } else {
    latestCleaningDate = inactiveLatest.latestCleaningDate;
    ageInCalendarDays = inactiveLatest.ageInCalendarDays;
    status = "PLAN INACTIVE";
  }

  const result = historyResult[0] ?? { entries: [], count: [] };
  const entries = result.entries ?? [];
  const total = result.count?.[0]?.total ?? 0;
  const related = await loadRelatedData(entries);

  return {
    plan: {
      ...toOverview(plan),
      currentMonitoringStatus: status,
      lastValidCleaningDate: latestCleaningDate,
      daysSinceLastValidCleaning: ageInCalendarDays,
      monitoringActivatedAt: plan.monitoringActivatedAt
        ? new Date(plan.monitoringActivatedAt).toISOString()
        : null,
    },
    history: {
      entries: entries.map((entry) => toHistoryEntry(entry, related)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1,
        dateFilterField:
          "Scheduled Job date in Asia/Kolkata; CleaningRecord date when the Job is unavailable",
      },
    },
  };
};
