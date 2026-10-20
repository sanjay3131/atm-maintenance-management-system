import mongoose from "mongoose";
import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";
import ATM from "../atms/atm.model.js";
import Job from "../jobs/jobs.model.js";
import JobPhoto from "../jobPhotos/jobPhotos.model.js";
import Attendance from "../attendance/attendance.model.js";
import AMC from "../amc/amc.model.js";
import { AMC_STATUS } from "../amc/amc.config.js";
import AMCPhoto from "../amcPhotos/amcPhoto.model.js";
import {
  getBusinessDateParts,
  getBusinessDayEnd,
  getBusinessDayStart,
  getRecurringJobDueState,
} from "../jobs/recurringMaintenance.utils.js";
import {
  getCurrentSupervisedEmployees,
  requireCurrentSupervisedEmployee,
  requireCurrentSupervisedJob,
  toIdString,
} from "./supervisor.scope.js";

const safeName = (user) =>
  [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;

const employeeDto = ({ employee, user }) => ({
  _id: toIdString(employee._id),
  userId: toIdString(user._id),
  employeeCode: employee.employeeCode,
  designation: employee.designation,
  department: employee.department,
  status: employee.status,
  joiningDate: employee.joiningDate,
  employmentType: employee.employmentType,
  firstName: user.firstName,
  lastName: user.lastName,
  name: safeName(user),
  email: user.email,
  phoneNumber: user.phoneNumber,
});

const pageOf = (rows, page, limit) => {
  const start = (page - 1) * limit;
  return {
    rows: rows.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total: rows.length,
      totalPages: Math.ceil(rows.length / limit),
    },
  };
};

const getReports = (req) => getCurrentSupervisedEmployees(req.user._id);
const currentMonthYear = () => {
  const { month, year } = getBusinessDateParts();
  return { month, year };
};

const safeAtmDto = (atm) => ({
  _id: toIdString(atm._id),
  atmId: atm.atmId,
  locationName: atm.locationName,
  address: atm.address,
  status: atm.status,
});

const getEmployeeAtms = async (employee) => {
  const employeeId = toIdString(employee._id);
  const assignedIds = [
    ...new Set(
      (employee.assignedAtmIds || [])
        .map(toIdString)
        .filter((id) => id && mongoose.isValidObjectId(id)),
    ),
  ];
  if (assignedIds.length === 0) return [];
  const atms = await ATM.find({
    _id: { $in: assignedIds },
    assignedEmployeeId: employee._id,
    isDeleted: false,
  }).select("_id atmId locationName address status");
  return atms.map((atm) => ({ ...safeAtmDto(atm), employeeId }));
};

const getCurrentJobQuery = (userIds) => ({
  assignedEmployeeId: { $in: userIds },
  isDeleted: false,
});

const getScopedJobs = async (reports, query = {}) => {
  const userIds = reports.map(({ user }) => user._id);
  if (userIds.length === 0) return [];
  const filter = { ...getCurrentJobQuery(userIds) };
  if (query.status) {
    if (!Object.values(JOB_STATUS).includes(query.status)) {
      throw new ApiError(400, "Invalid job status");
    }
    filter.status = query.status;
  }
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { jobId: { $regex: escaped, $options: "i" } },
      { jobNumber: { $regex: escaped, $options: "i" } },
      { title: { $regex: escaped, $options: "i" } },
    ];
  }
  if (query.fromDate || query.toDate) {
    const dateRange = {};
    if (query.fromDate) {
      dateRange.$gte = getBusinessDayStart(query.fromDate);
    }
    if (query.toDate) {
      dateRange.$lte = getBusinessDayEnd(query.toDate);
    }
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { createdAt: dateRange, "recurringMaintenance.source": { $ne: "RECURRING" } },
          { "recurringMaintenance.scheduledDate": dateRange },
        ],
      },
    ];
  }
  const jobs = await Job.find(filter)
    .select(
      "_id jobId jobNumber title description atmId assignedEmployeeId status workType priority recurringMaintenance createdAt assignedAt acceptedAt startedAt completedAt verifiedAt approvedAt closedAt rejectedAt cancelledAt employeeGpsAtCompletion gpsDistance gpsValidated employeeRemarks beforePhotos afterPhotos",
    )
    .sort({ createdAt: -1, _id: -1 });
  return jobs;
};

const safeJobDto = async (job, employeePair) => {
  const atmId = toIdString(job.atmId);
  const atm =
    atmId && mongoose.isValidObjectId(atmId)
      ? await ATM.findOne({ _id: atmId, isDeleted: false }).select(
          "_id atmId locationName address status",
        )
      : null;
  return {
    _id: toIdString(job._id),
    jobId: job.jobId,
    jobNumber: job.jobNumber,
    title: job.title,
    description: job.description,
    status: job.status,
    workType: job.workType,
    priority: job.priority,
    scheduledDate: job.recurringMaintenance?.scheduledDate ?? null,
    dueAt: job.recurringMaintenance?.dueAt ?? null,
    dueState: getRecurringJobDueState(job),
    createdAt: job.createdAt,
    assignedAt: job.assignedAt,
    acceptedAt: job.acceptedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    verifiedAt: job.verifiedAt,
    approvedAt: job.approvedAt,
    closedAt: job.closedAt,
    rejectedAt: job.rejectedAt,
    cancelledAt: job.cancelledAt,
    employee: employeePair
      ? {
          _id: toIdString(employeePair.employee._id),
          userId: toIdString(employeePair.user._id),
          name: safeName(employeePair.user),
        }
      : null,
    atm: atm ? safeAtmDto(atm) : null,
    completionEvidence: {
      employeeRemarks: job.employeeRemarks || "",
      gpsDistance: job.gpsDistance ?? null,
      gpsValidated: Boolean(job.gpsValidated),
      employeeGpsAtCompletion: job.employeeGpsAtCompletion ?? null,
      beforePhotos: job.beforePhotos || [],
      afterPhotos: job.afterPhotos || [],
    },
  };
};

const getScopedAmcs = async (employeeUserId, month, year) =>
  AMC.find({
    employeeId: employeeUserId,
    month,
    year,
    isDeleted: false,
  })
    .select(
      "_id amcId atmId month year status deadlineDate visitDate completedAt visitGps gpsDistance gpsValidated checklist checklistCompleted employeeRemarks photos photoCount",
    )
    .sort({ deadlineDate: 1, _id: 1 });

const safeAmcDto = async (amc) => {
  const atmId = toIdString(amc.atmId);
  const atm =
    atmId && mongoose.isValidObjectId(atmId)
      ? await ATM.findOne({ _id: atmId, isDeleted: false }).select(
          "_id atmId locationName address status",
        )
      : null;
  return {
    _id: toIdString(amc._id),
    amcId: amc.amcId,
    month: amc.month,
    year: amc.year,
    status: amc.status,
    deadlineDate: amc.deadlineDate,
    visitDate: amc.visitDate,
    completedAt: amc.completedAt,
    visitGps: amc.visitGps ?? null,
    gpsDistance: amc.gpsDistance ?? null,
    gpsValidated: Boolean(amc.gpsValidated),
    checklist: amc.checklist || [],
    checklistCompleted: Boolean(amc.checklistCompleted),
    employeeRemarks: amc.employeeRemarks || "",
    photoCount: amc.photoCount || 0,
    photos: amc.photos || [],
    atm: atm ? safeAtmDto(atm) : null,
  };
};

const validateDateRange = (query) => {
  if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
    throw new ApiError(400, "fromDate must be on or before toDate");
  }
};

// GET SUPERVISED EMPLOYEES
export const getSupervisedEmployees = asyncHandler(async (req, res) => {
  const { page, limit, search } = req.validatedQuery || {
    page: 1,
    limit: 100,
  };
  const reports = await getReports(req);
  const needle = search?.toLocaleLowerCase();
  const matchingReports = needle
    ? reports.filter(({ employee, user }) =>
        [
          employee.employeeCode,
          user.firstName,
          user.lastName,
          user.email,
        ]
          .filter(Boolean)
          .some((value) => value.toLocaleLowerCase().includes(needle)),
      )
    : reports;
  const { rows, pagination } = pageOf(matchingReports, page, limit);
  const employees = await Promise.all(
    rows.map(async (pair) => ({
      ...employeeDto(pair),
      assignedAtms: await getEmployeeAtms(pair.employee),
    })),
  );
  return res.status(200).json(
    new ApiResponse(200, { employees, pagination }, "Supervised employees fetched"),
  );
});

// SUPERVISOR DASHBOARD
export const getSupervisorDashboard = asyncHandler(async (req, res) => {
  const reports = await getReports(req);
  const reportUserIds = reports.map(({ user }) => user._id);
  const employeeIds = reports.map(({ employee }) => employee._id);
  const businessDate = getBusinessDateParts(new Date());
  const today = req.validatedQuery?.date || businessDate.dateKey;
  const businessToday = businessDate.dateKey;
  const todayStart = getBusinessDayStart(businessToday);
  const todayEnd = getBusinessDayEnd(businessToday);
  const { month, year } = businessDate;
  const statuses = Object.values(JOB_STATUS);
  const amcStatuses = Object.values(AMC_STATUS);

  const [
    attendanceRecords,
    jobGroups,
    amcGroups,
    atms,
    recentActivityRows,
    overdueJobs,
    scheduledToday,
  ] = await Promise.all([
    employeeIds.length
      ? Attendance.find({
          employeeId: { $in: employeeIds },
          attendanceDate: today,
        }).select("employeeId attendanceDate checkInAt checkOutAt")
      : [],
    reportUserIds.length
      ? Job.aggregate([
          { $match: { ...getCurrentJobQuery(reportUserIds) } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ])
      : [],
    reportUserIds.length
      ? AMC.aggregate([
          {
            $match: {
              employeeId: { $in: reportUserIds },
              month,
              year,
              isDeleted: false,
            },
          },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ])
      : [],
    Promise.all(
      reports.map(({ employee }) => getEmployeeAtms(employee)),
    ).then((employeeAtms) => [
      ...new Map(employeeAtms.flat().map((atm) => [atm._id, atm])).values(),
    ]),
    reportUserIds.length
      ? Job.aggregate([
          { $match: getCurrentJobQuery(reportUserIds) },
          {
            $lookup: {
              from: "jobhistories",
              localField: "_id",
              foreignField: "jobId",
              as: "history",
            },
          },
          { $unwind: "$history" },
          { $sort: { "history.performedAt": -1, _id: -1 } },
          { $limit: 10 },
          {
            $project: {
              _id: 1,
              jobId: 1,
              jobNumber: 1,
              title: 1,
              action: "$history.action",
              fromStatus: "$history.fromStatus",
              toStatus: "$history.toStatus",
              occurredAt: "$history.performedAt",
            },
          },
        ])
      : [],
    reportUserIds.length
      ? Job.countDocuments({
          ...getCurrentJobQuery(reportUserIds),
          "recurringMaintenance.source": "RECURRING",
          "recurringMaintenance.dueAt": { $lte: new Date() },
          "recurringMaintenance.scheduledDate": { $lte: todayEnd },
          status: {
            $nin: [
              JOB_STATUS.COMPLETED,
              JOB_STATUS.VERIFIED,
              JOB_STATUS.APPROVED,
              JOB_STATUS.CLOSED,
              JOB_STATUS.CANCELLED,
            ],
          },
        })
      : 0,
    reportUserIds.length
      ? Job.countDocuments({
          ...getCurrentJobQuery(reportUserIds),
          "recurringMaintenance.source": "RECURRING",
          "recurringMaintenance.scheduledDate": {
            $gte: todayStart,
            $lte: todayEnd,
          },
        })
      : 0,
  ]);

  const jobCounts = Object.fromEntries(statuses.map((status) => [status, 0]));
  jobGroups.forEach(({ _id, count }) => {
    if (Object.hasOwn(jobCounts, _id)) jobCounts[_id] = count;
  });
  const amcCounts = Object.fromEntries(amcStatuses.map((status) => [status, 0]));
  amcGroups.forEach(({ _id, count }) => {
    if (Object.hasOwn(amcCounts, _id)) amcCounts[_id] = count;
  });

  const attendance = {
    date: today,
    records: attendanceRecords.length,
    checkedIn: attendanceRecords.filter((record) => record.checkInAt).length,
    checkedOut: attendanceRecords.filter((record) => record.checkOutAt).length,
    open: attendanceRecords.filter(
      (record) => record.checkInAt && !record.checkOutAt,
    ).length,
  };
  const recentActivity = recentActivityRows.map((entry) => ({
    jobId: toIdString(entry._id),
    jobNumber: entry.jobNumber || entry.jobId || null,
    title: entry.title || null,
    action: entry.action,
    fromStatus: entry.fromStatus || null,
    toStatus: entry.toStatus || null,
    occurredAt: entry.occurredAt,
  }));
  const monthTotal = Object.values(amcCounts).reduce((total, count) => total + count, 0);
  const completedAmcs = amcCounts[AMC_STATUS.COMPLETED] || 0;

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        employees: { total: reports.length },
        atms: { total: atms.length },
        attendance,
        jobs: {
          total: Object.values(jobCounts).reduce((a, b) => a + b, 0),
          byStatus: jobCounts,
          scheduledToday,
          overdue: overdueJobs,
        },
        amc: {
          month,
          year,
          total: monthTotal,
          byStatus: amcCounts,
          completionRate:
            monthTotal > 0 ? Math.round((completedAmcs / monthTotal) * 100) : 0,
        },
        recentActivity,
      },
      "Supervisor dashboard fetched",
    ),
  );
});

export const getSupervisorEmployeeDetails = asyncHandler(async (req, res) => {
  const { employeeId } = req.validatedParams;
  const { employee, user } = await requireCurrentSupervisedEmployee(
    employeeId,
    req.user._id,
  );
  const assignedAtms = await getEmployeeAtms(employee);
  return res.status(200).json(
    new ApiResponse(
      200,
      { employee: employeeDto({ employee, user }), assignedAtms },
      "Employee details fetched",
    ),
  );
});

export const getSupervisorEmployeeAttendance = asyncHandler(async (req, res) => {
  const { employeeId } = req.validatedParams;
  const { employee } = await requireCurrentSupervisedEmployee(
    employeeId,
    req.user._id,
  );
  const query = req.validatedQuery;
  validateDateRange(query);
  const filter = { employeeId: employee._id };
  if (query.fromDate || query.toDate) {
    filter.attendanceDate = {};
    if (query.fromDate) filter.attendanceDate.$gte = query.fromDate;
    if (query.toDate) filter.attendanceDate.$lte = query.toDate;
  }
  const [records, total] = await Promise.all([
    Attendance.find(filter)
      .select("employeeId attendanceDate checkInAt checkOutAt checkInSource checkOutSource")
      .sort({ attendanceDate: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    Attendance.countDocuments(filter),
  ]);
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        records,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      },
      "Employee attendance fetched",
    ),
  );
});

export const getSupervisorEmployeeJobs = asyncHandler(async (req, res) => {
  const { employeeId } = req.validatedParams;
  const { employee, user } = await requireCurrentSupervisedEmployee(
    employeeId,
    req.user._id,
  );
  const query = req.validatedQuery;
  const jobs = await getScopedJobs([{ employee, user }], query);
  const { rows, pagination } = pageOf(jobs, query.page, query.limit);
  const result = await Promise.all(rows.map((job) => safeJobDto(job, { employee, user })));
  return res.status(200).json(
    new ApiResponse(200, { jobs: result, pagination }, "Employee jobs fetched"),
  );
});

export const getSupervisorEmployeeAMC = asyncHandler(async (req, res) => {
  const { employeeId } = req.validatedParams;
  const { employee, user } = await requireCurrentSupervisedEmployee(
    employeeId,
    req.user._id,
  );
  const query = req.validatedQuery;
  const defaults = currentMonthYear();
  const month = query.month ?? defaults.month;
  const year = query.year ?? defaults.year;
  const amcs = await getScopedAmcs(user._id, month, year);
  const counts = Object.fromEntries(Object.values(AMC_STATUS).map((status) => [status, 0]));
  amcs.forEach((amc) => {
    if (Object.hasOwn(counts, amc.status)) counts[amc.status] += 1;
  });
  const { rows, pagination } = pageOf(amcs, query.page, query.limit);
  const results = await Promise.all(rows.map(safeAmcDto));
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        employeeId: toIdString(employee._id),
        amcs: results,
        statusCounts: { total: amcs.length, ...counts },
        month,
        year,
        pagination,
      },
      "Employee AMC progress",
    ),
  );
});

export const getSupervisorJobs = asyncHandler(async (req, res) => {
  const query = req.validatedQuery;
  const reports = await getReports(req);
  const jobs = await getScopedJobs(reports, query);
  const employeeByUserId = new Map(
    reports.map((pair) => [toIdString(pair.user._id), pair]),
  );
  const { rows, pagination } = pageOf(jobs, query.page, query.limit);
  const result = await Promise.all(
    rows.map((job) =>
      safeJobDto(job, employeeByUserId.get(toIdString(job.assignedEmployeeId))),
    ),
  );
  return res.status(200).json(
    new ApiResponse(200, { jobs: result, pagination }, "Supervisor jobs fetched"),
  );
});

export const getSupervisorJobById = asyncHandler(async (req, res) => {
  const { jobId } = req.validatedParams;
  const job = await Job.findOne({ _id: jobId, isDeleted: false }).select(
    "_id jobId jobNumber title description atmId assignedEmployeeId status workType priority recurringMaintenance createdAt assignedAt acceptedAt startedAt completedAt verifiedAt approvedAt closedAt rejectedAt cancelledAt employeeGpsAtCompletion gpsDistance gpsValidated employeeRemarks beforePhotos afterPhotos",
  );
  if (!job) throw new ApiError(404, "Job not found");
  const employeePair = await requireCurrentSupervisedJob(job, req.user._id);
  const result = await safeJobDto(job, employeePair);
  const photos = await JobPhoto.find({
    jobId: job._id,
    isExpired: false,
  })
    .select("_id photoType url thumbnailUrl uploadedAt gpsData")
    .sort({ uploadedAt: -1 });
  result.completionEvidence.photos = photos;
  return res.status(200).json(new ApiResponse(200, result, "Job fetched"));
});

export const getSupervisorJobHistory = asyncHandler(async (req, res) => {
  const { jobId } = req.validatedParams;
  const job = await Job.findOne({ _id: jobId, isDeleted: false }).select(
    "_id jobId jobNumber title assignedEmployeeId",
  );
  if (!job) throw new ApiError(404, "Job not found");
  await requireCurrentSupervisedJob(job, req.user._id);
  const history = await JobHistory.find({ jobId: job._id })
    .select("action fromStatus toStatus performedAt")
    .sort({ performedAt: -1, _id: -1 });
  return res.status(200).json(
    new ApiResponse(
      200,
      {
        job: { _id: toIdString(job._id), jobNumber: job.jobNumber || job.jobId, title: job.title },
        history: history.map((entry) => ({
          action: entry.action,
          fromStatus: entry.fromStatus || null,
          toStatus: entry.toStatus || null,
          occurredAt: entry.performedAt,
        })),
      },
      "Job history fetched",
    ),
  );
});
