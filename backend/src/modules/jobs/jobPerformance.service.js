import Job from "./jobs.model.js";
import JobHistory from "./jobHistory.model.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";

const PERFORMANCE_TIMEZONE = "Asia/Kolkata";
const PERFORMANCE_TIMEZONE_OFFSET_MINUTES = 330;
const COMPLETED_JOB_STATUSES = [
  JOB_STATUS.COMPLETED,
  JOB_STATUS.VERIFIED,
  JOB_STATUS.APPROVED,
  JOB_STATUS.CLOSED,
];

const getDateKeyInPerformanceTimezone = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PERFORMANCE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

const getUtcMidnightForBusinessDate = (dateKey) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
};

export const getPerformanceDateRange = (query, now = new Date()) => {
  let fromDate = query.fromDate;
  let toDate = query.toDate;

  if (!fromDate) {
    toDate = getDateKeyInPerformanceTimezone(now);
    const [year, month] = toDate.split("-").map(Number);

    if (query.period === "week") {
      const date = new Date(getUtcMidnightForBusinessDate(toDate));
      date.setUTCDate(date.getUTCDate() - date.getUTCDay());
      fromDate = date.toISOString().slice(0, 10);
    } else if (query.period === "year") {
      fromDate = `${year}-01-01`;
    } else {
      fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
    }
  }

  const toExclusive = new Date(
    getUtcMidnightForBusinessDate(toDate) +
      86_400_000 -
      PERFORMANCE_TIMEZONE_OFFSET_MINUTES * 60_000,
  );
  const fromInclusive = new Date(
    getUtcMidnightForBusinessDate(fromDate) -
      PERFORMANCE_TIMEZONE_OFFSET_MINUTES * 60_000,
  );

  return {
    fromDate,
    toDate,
    fromInclusive,
    toExclusive,
    timezone: PERFORMANCE_TIMEZONE,
  };
};

export const getLastSevenDaysRange = (now = new Date()) => {
  const toDate = getDateKeyInPerformanceTimezone(now);
  const fromDateDate = new Date(getUtcMidnightForBusinessDate(toDate));
  fromDateDate.setUTCDate(fromDateDate.getUTCDate() - 6);
  const fromDate = fromDateDate.toISOString().slice(0, 10);
  return {
    ...getPerformanceDateRange({ fromDate, toDate }, now),
    dates: Array.from({ length: 7 }, (_, index) => {
      const date = new Date(getUtcMidnightForBusinessDate(fromDate));
      date.setUTCDate(date.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    }),
  };
};

const getEmployeeLifetimeCompletedJobsPipeline = (userId) => [
  {
    $match: {
      assignedEmployeeId: userId,
      isDeleted: false,
      status: { $in: COMPLETED_JOB_STATUSES },
    },
  },
  { $group: { _id: "$_id" } },
  { $count: "completedJobCount" },
];

const getEmployeeWeeklyActivityPipeline = (userId, range) => {
  const employeeIds = [...new Set([userId, userId.toString()])];
  return [
    {
      $match: {
        $or: [
          { action: "gps_validated", performedBy: userId },
          {
            action: "assigned",
            "details.assignedTo": { $in: employeeIds },
          },
          {
            action: "reassigned",
            "details.toEmployee": { $in: employeeIds },
          },
          {
            action: "status_changed",
            fromStatus: JOB_STATUS.REJECTED,
            toStatus: JOB_STATUS.ASSIGNED,
            "details.assignedTo": { $in: employeeIds },
          },
        ],
      },
    },
    {
      $addFields: {
        activityAt: {
          $cond: [
            { $eq: ["$action", "gps_validated"] },
            { $ifNull: ["$details.completedAt", "$performedAt"] },
            { $ifNull: ["$details.assignedAt", "$performedAt"] },
          ],
        },
        activityType: {
          $cond: [
            { $eq: ["$action", "gps_validated"] },
            "completed",
            "assigned",
          ],
        },
      },
    },
    {
      $match: {
        activityAt: {
          $type: "date",
          $gte: range.fromInclusive,
          $lt: range.toExclusive,
        },
      },
    },
    {
      $lookup: {
        from: Job.collection.name,
        localField: "jobId",
        foreignField: "_id",
        as: "job",
      },
    },
    { $unwind: "$job" },
    {
      $match: {
        "job.isDeleted": false,
        "job.status": { $ne: JOB_STATUS.CANCELLED },
      },
    },
    {
      $group: {
        _id: {
          date: {
            $dateToString: {
              date: "$activityAt",
              format: "%Y-%m-%d",
              timezone: PERFORMANCE_TIMEZONE,
            },
          },
          activity: "$activityType",
          jobId: "$jobId",
        },
      },
    },
    {
      $group: {
        _id: { date: "$_id.date", activity: "$_id.activity" },
        count: { $sum: 1 },
      },
    },
  ];
};

export const getJobPerformanceForUser = async (userId, query) => {
  const now = new Date();
  const range = getPerformanceDateRange(query, now);
  const weeklyRange = getLastSevenDaysRange(now);
  const [
    statusCounts,
    averageResult,
    completionResult,
    eligibleJobResult,
    lifetimeCompletedJobResult,
    weeklyActivityResult,
  ] = await Promise.all([
    Job.aggregate([
      {
        $match: {
          assignedEmployeeId: userId,
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),
    Job.aggregate([
      {
        $match: {
          assignedEmployeeId: userId,
          isDeleted: false,
          status: { $in: COMPLETED_JOB_STATUSES },
          startedAt: { $type: "date" },
          completedAt: { $type: "date" },
        },
      },
      {
        $match: {
          $expr: { $gte: ["$completedAt", "$startedAt"] },
        },
      },
      {
        $group: {
          _id: null,
          averageCompletionTimeMs: {
            $avg: { $subtract: ["$completedAt", "$startedAt"] },
          },
          jobCount: { $sum: 1 },
        },
      },
    ]),
    JobHistory.aggregate([
      {
        $match: {
          action: "gps_validated",
          performedBy: userId,
          performedAt: {
            $type: "date",
            $gte: range.fromInclusive,
            $lt: range.toExclusive,
          },
        },
      },
      {
        $lookup: {
          from: Job.collection.name,
          localField: "jobId",
          foreignField: "_id",
          as: "job",
        },
      },
      { $unwind: "$job" },
      {
        $match: {
          "job.isDeleted": false,
          "job.status": { $ne: JOB_STATUS.CANCELLED },
        },
      },
      { $count: "eventCount" },
    ]),
    Job.aggregate([
      {
        $match: {
          isDeleted: false,
          status: { $ne: JOB_STATUS.CANCELLED },
          $or: [
            { assignedEmployeeId: userId },
            { "reassignmentHistory.fromEmployee": userId },
            { "reassignmentHistory.toEmployee": userId },
          ],
        },
      },
      { $group: { _id: "$_id" } },
      { $count: "eligibleAssignedJobCount" },
    ]),
    Job.aggregate(getEmployeeLifetimeCompletedJobsPipeline(userId)),
    JobHistory.aggregate(getEmployeeWeeklyActivityPipeline(userId, weeklyRange)),
  ]);

  const byStatus = Object.values(JOB_STATUS).reduce((counts, status) => {
    counts[status] = 0;
    return counts;
  }, {});
  for (const entry of statusCounts) {
    if (Object.hasOwn(byStatus, entry._id)) byStatus[entry._id] = entry.count;
  }

  const averageCompletionTimeMs = averageResult[0]?.averageCompletionTimeMs;
  const averageCurrentAttemptCompletionHours =
    Number.isFinite(averageCompletionTimeMs) && averageCompletionTimeMs >= 0
      ? Number((averageCompletionTimeMs / 3_600_000).toFixed(2))
      : null;
  const daysByDate = new Map(
    weeklyRange.dates.map((date) => [date, { date, assigned: 0, completed: 0 }]),
  );
  for (const item of weeklyActivityResult) {
    const day = daysByDate.get(item._id.date);
    if (day && (item._id.activity === "assigned" || item._id.activity === "completed")) {
      day[item._id.activity] = item.count;
    }
  }

  return {
    currentAssignedJobs: {
      total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      byStatus,
    },
    completion: {
      completedEventCount: completionResult[0]?.eventCount ?? 0,
      range: {
        fromDate: range.fromDate,
        toDate: range.toDate,
        timezone: range.timezone,
      },
    },
    averageCurrentAttemptCompletionHours,
    averageCurrentAttemptJobCount: averageResult[0]?.jobCount ?? 0,
    eligibleAssignedJobCount:
      eligibleJobResult[0]?.eligibleAssignedJobCount ?? 0,
    completedJobCount:
      lifetimeCompletedJobResult[0]?.completedJobCount ?? 0,
    lastSevenDays: {
      fromDate: weeklyRange.fromDate,
      toDate: weeklyRange.toDate,
      timezone: weeklyRange.timezone,
      days: [...daysByDate.values()],
    },
  };
};
