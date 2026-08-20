import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import Job from "../jobs/jobs.model.js";
import Employee from "../employees/employee.model.js";
import ATM from "../atms/atm.model.js";
import Complaint from "../complaints/complaints.model.js";
import User from "../users/user.model.js";
import District from "../districts/district.models.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";

// ============================================
// HELPERS
// ============================================

const getTodayRange = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  return { start: today, end: tomorrow };
};

const getWeekRange = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  return { start: weekStart, end: weekEnd };
};

const getMonthRange = () => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start: monthStart, end: monthEnd };
};

const getYearRange = () => {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
  return { start: yearStart, end: yearEnd };
};

// ============================================
// 1. MAIN DASHBOARD STATS
// ============================================
export const getDashboardStats = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const { start: todayStart, end: todayEnd } = getTodayRange();
  const { start: weekStart } = getWeekRange();
  const { start: monthStart } = getMonthRange();

  // ── JOB STATS ──
  const [
    totalJobs,
    todayJobs,
    weekJobs,
    monthJobs,
    pendingJobs,
    assignedJobs,
    inProgressJobs,
    completedJobs,
    verifiedJobs,
    approvedJobs,
    closedJobs,
    rejectedJobs,
    onHoldJobs,
    jobsByPriority,
    jobsByWorkType,
  ] = await Promise.all([
    Job.countDocuments({ isDeleted: false }),
    Job.countDocuments({
      createdAt: { $gte: todayStart, $lt: todayEnd },
      isDeleted: false,
    }),
    Job.countDocuments({ createdAt: { $gte: weekStart }, isDeleted: false }),
    Job.countDocuments({ createdAt: { $gte: monthStart }, isDeleted: false }),
    Job.countDocuments({ status: JOB_STATUS.PENDING, isDeleted: false }),
    Job.countDocuments({ status: JOB_STATUS.ASSIGNED, isDeleted: false }),
    Job.countDocuments({ status: JOB_STATUS.IN_PROGRESS, isDeleted: false }),
    Job.countDocuments({ status: JOB_STATUS.COMPLETED, isDeleted: false }),
    Job.countDocuments({ status: JOB_STATUS.VERIFIED, isDeleted: false }),
    Job.countDocuments({ status: JOB_STATUS.APPROVED, isDeleted: false }),
    Job.countDocuments({ status: JOB_STATUS.CLOSED, isDeleted: false }),
    Job.countDocuments({ status: JOB_STATUS.REJECTED, isDeleted: false }),
    Job.countDocuments({ status: JOB_STATUS.ON_HOLD, isDeleted: false }),
    Job.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]),
    Job.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$workType", count: { $sum: 1 } } },
    ]),
  ]);

  // ── EMPLOYEE STATS ──
  const [
    totalEmployees,
    activeEmployees,
    inactiveEmployees,
    onLeaveEmployees,
    employeesWorkingToday,
    employeesWithPendingJobs,
  ] = await Promise.all([
    Employee.countDocuments(),
    Employee.countDocuments({ status: "active" }),
    Employee.countDocuments({ status: "inactive" }),
    Employee.countDocuments({ status: "on_leave" }),
    Job.distinct("assignedEmployeeId", {
      status: { $in: [JOB_STATUS.IN_PROGRESS, JOB_STATUS.ACCEPTED] },
      isDeleted: false,
    }).then((ids) => ids.length),
    Job.distinct("assignedEmployeeId", {
      status: { $in: [JOB_STATUS.PENDING, JOB_STATUS.ASSIGNED] },
      isDeleted: false,
    }).then((ids) => ids.length),
  ]);

  // ── ATM STATS ──
  const [
    totalATMs,
    activeATMs,
    inactiveATMs,
    underMaintenanceATMs,
    atmsByDistrict,
    atmsByBank,
    atmsByInstallationType,
  ] = await Promise.all([
    ATM.countDocuments({ isDeleted: false }),
    ATM.countDocuments({ status: "ACTIVE", isDeleted: false }),
    ATM.countDocuments({ status: "INACTIVE", isDeleted: false }),
    ATM.countDocuments({ status: "UNDER_MAINTENANCE", isDeleted: false }),
    ATM.aggregate([
      { $match: { isDeleted: false } },
      {
        $lookup: {
          from: "districts",
          localField: "districtId",
          foreignField: "_id",
          as: "district",
        },
      },
      { $unwind: { path: "$district", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$districtId",
          districtName: { $first: "$district.districtName" },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),
    ATM.aggregate([
      { $match: { isDeleted: false } },
      {
        $lookup: {
          from: "banks",
          localField: "bankId",
          foreignField: "_id",
          as: "bank",
        },
      },
      { $unwind: { path: "$bank", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$bankId",
          bankName: { $first: "$bank.bankName" },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),
    ATM.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$installationType", count: { $sum: 1 } } },
    ]),
  ]);

  // ── COMPLAINT STATS ──
  const [
    totalComplaints,
    todayComplaints,
    openComplaints,
    assignedComplaints,
    inProgressComplaints,
    resolvedComplaints,
    closedComplaints,
    criticalComplaints,
    highComplaints,
    complaintsByPriority,
  ] = await Promise.all([
    Complaint.countDocuments({ isDeleted: false }),
    Complaint.countDocuments({
      createdAt: { $gte: todayStart, $lt: todayEnd },
      isDeleted: false,
    }),
    Complaint.countDocuments({ status: "OPEN", isDeleted: false }),
    Complaint.countDocuments({ status: "ASSIGNED", isDeleted: false }),
    Complaint.countDocuments({ status: "IN_PROGRESS", isDeleted: false }),
    Complaint.countDocuments({ status: "RESOLVED", isDeleted: false }),
    Complaint.countDocuments({ status: "CLOSED", isDeleted: false }),
    Complaint.countDocuments({
      priority: "CRITICAL",
      status: { $nin: ["CLOSED", "CANCELLED"] },
      isDeleted: false,
    }),
    Complaint.countDocuments({
      priority: "HIGH",
      status: { $nin: ["CLOSED", "CANCELLED"] },
      isDeleted: false,
    }),
    Complaint.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]),
  ]);

  // ── CUSTOMER STATS ──
  const [totalCustomers, activeCustomers] = await Promise.all([
    User.countDocuments({ userType: "customer" }),
    User.countDocuments({ userType: "customer", status: "active" }),
  ]);

  // ── COMPLETION RATE ──
  const completionRate =
    totalJobs > 0
      ? Math.round(((approvedJobs + closedJobs) / totalJobs) * 100)
      : 0;

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        jobs: {
          total: totalJobs,
          today: todayJobs,
          thisWeek: weekJobs,
          thisMonth: monthJobs,
          pending: pendingJobs,
          assigned: assignedJobs,
          inProgress: inProgressJobs,
          completed: completedJobs,
          verified: verifiedJobs,
          approved: approvedJobs,
          closed: closedJobs,
          rejected: rejectedJobs,
          onHold: onHoldJobs,
          byPriority: jobsByPriority.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
          }, {}),
          byWorkType: jobsByWorkType.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
          }, {}),
          completionRate,
        },
        employees: {
          total: totalEmployees,
          active: activeEmployees,
          inactive: inactiveEmployees,
          onLeave: onLeaveEmployees,
          workingToday: employeesWorkingToday,
          withPendingJobs: employeesWithPendingJobs,
        },
        atms: {
          total: totalATMs,
          active: activeATMs,
          inactive: inactiveATMs,
          underMaintenance: underMaintenanceATMs,
          byDistrict: atmsByDistrict.map((d) => ({
            districtId: d._id,
            districtName: d.districtName || "Unknown",
            count: d.count,
          })),
          byBank: atmsByBank.map((b) => ({
            bankId: b._id,
            bankName: b.bankName || "Unknown",
            count: b.count,
          })),
          byInstallationType: atmsByInstallationType.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
          }, {}),
        },
        complaints: {
          total: totalComplaints,
          today: todayComplaints,
          open: openComplaints,
          assigned: assignedComplaints,
          inProgress: inProgressComplaints,
          resolved: resolvedComplaints,
          closed: closedComplaints,
          criticalOpen: criticalComplaints,
          highOpen: highComplaints,
          byPriority: complaintsByPriority.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
          }, {}),
        },
        customers: {
          total: totalCustomers,
          active: activeCustomers,
        },
      },
      "Dashboard statistics fetched successfully",
    ),
  );
});

// ============================================
// 2. RECENT ACTIVITY
// ============================================
export const getRecentActivity = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const { limit = 20 } = req.query;
  const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

  // Get recent jobs
  const recentJobs = await Job.find({ isDeleted: false })
    .populate("atmId", "atmId locationName")
    .populate("assignedEmployeeId", "firstName lastName")
    .populate("createdBy", "firstName lastName")
    .sort({ updatedAt: -1 })
    .limit(limitNum)
    .lean();

  // Get recent complaints
  const recentComplaints = await Complaint.find({ isDeleted: false })
    .populate("atmId", "atmId locationName")
    .populate("createdBy", "firstName lastName")
    .sort({ updatedAt: -1 })
    .limit(limitNum)
    .lean();

  // Merge and sort by updatedAt
  const activities = [
    ...recentJobs.map((j) => ({
      type: "job",
      id: j._id,
      title: j.title,
      status: j.status,
      identifier: j.jobId,
      atmName: j.atmId?.locationName || "Unknown ATM",
      atmId: j.atmId?.atmId || "",
      employeeName: j.assignedEmployeeId
        ? `${j.assignedEmployeeId.firstName} ${j.assignedEmployeeId.lastName}`
        : null,
      createdBy: j.createdBy
        ? `${j.createdBy.firstName} ${j.createdBy.lastName}`
        : "System",
      timestamp: j.updatedAt,
      priority: j.priority,
    })),
    ...recentComplaints.map((c) => ({
      type: "complaint",
      id: c._id,
      title: c.title,
      status: c.status,
      identifier: c.complaintNumber,
      atmName: c.atmId?.locationName || "Unknown ATM",
      atmId: c.atmId?.atmId || "",
      employeeName: null,
      createdBy: c.createdBy
        ? `${c.createdBy.firstName} ${c.createdBy.lastName}`
        : "System",
      timestamp: c.updatedAt,
      priority: c.priority,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limitNum);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { activities },
        "Recent activity fetched successfully",
      ),
    );
});

// ============================================
// 3. EMPLOYEE PERFORMANCE
// ============================================
export const getEmployeePerformance = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const { period = "month" } = req.query; // "week", "month", "year"

  let dateFilter = {};
  const now = new Date();

  if (period === "week") {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    dateFilter = { createdAt: { $gte: weekStart } };
  } else if (period === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    dateFilter = { createdAt: { $gte: monthStart } };
  } else if (period === "year") {
    const yearStart = new Date(now.getFullYear(), 0, 1);
    dateFilter = { createdAt: { $gte: yearStart } };
  }

  const performance = await Job.aggregate([
    {
      $match: {
        isDeleted: false,
        assignedEmployeeId: { $exists: true, $ne: null },
        ...dateFilter,
      },
    },
    {
      $group: {
        _id: "$assignedEmployeeId",
        totalJobs: { $sum: 1 },
        completedJobs: {
          $sum: {
            $cond: [
              {
                $in: [
                  "$status",
                  ["COMPLETED", "VERIFIED", "APPROVED", "CLOSED"],
                ],
              },
              1,
              0,
            ],
          },
        },
        approvedJobs: {
          $sum: {
            $cond: [{ $eq: ["$status", "APPROVED"] }, 1, 0],
          },
        },
        rejectedJobs: {
          $sum: {
            $cond: [{ $eq: ["$status", "REJECTED"] }, 1, 0],
          },
        },
        avgCompletionTime: {
          $avg: {
            $cond: [
              {
                $and: [
                  { $ne: ["$startedAt", null] },
                  { $ne: ["$completedAt", null] },
                ],
              },
              { $subtract: ["$completedAt", "$startedAt"] },
              null,
            ],
          },
        },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $lookup: {
        from: "employees",
        localField: "_id",
        foreignField: "userId",
        as: "employee",
      },
    },
    { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        employeeId: "$_id",
        name: { $concat: ["$user.firstName", " ", "$user.lastName"] },
        employeeCode: "$employee.employeeCode",
        totalJobs: 1,
        completedJobs: 1,
        approvedJobs: 1,
        rejectedJobs: 1,
        completionRate: {
          $cond: [
            { $gt: ["$totalJobs", 0] },
            {
              $round: [
                {
                  $multiply: [
                    { $divide: ["$completedJobs", "$totalJobs"] },
                    100,
                  ],
                },
                0,
              ],
            },
            0,
          ],
        },
        avgCompletionTimeHours: {
          $cond: [
            { $gt: ["$avgCompletionTime", 0] },
            {
              $round: [{ $divide: ["$avgCompletionTime", 1000 * 60 * 60] }, 1],
            },
            0,
          ],
        },
      },
    },
    { $sort: { completedJobs: -1 } },
  ]);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { performance, period },
        "Employee performance fetched successfully",
      ),
    );
});

// ============================================
// 4. DISTRICT SUMMARY
// ============================================
export const getDistrictSummary = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const summary = await District.aggregate([
    {
      $lookup: {
        from: "atms",
        let: { districtId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$districtId", "$$districtId"] },
              isDeleted: false,
            },
          },
        ],
        as: "atms",
      },
    },
    {
      $lookup: {
        from: "regions",
        let: { districtId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$districtId", "$$districtId"] },
            },
          },
        ],
        as: "regions",
      },
    },
    {
      $project: {
        districtName: 1,
        pinCode: 1,
        state: 1,
        isActive: 1,
        atmCount: { $size: "$atms" },
        regionCount: { $size: "$regions" },
        activeATMs: {
          $size: {
            $filter: {
              input: "$atms",
              as: "atm",
              cond: { $eq: ["$$atm.status", "ACTIVE"] },
            },
          },
        },
        maintenanceATMs: {
          $size: {
            $filter: {
              input: "$atms",
              as: "atm",
              cond: { $eq: ["$$atm.status", "UNDER_MAINTENANCE"] },
            },
          },
        },
      },
    },
    { $sort: { atmCount: -1 } },
  ]);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { summary },
        "District summary fetched successfully",
      ),
    );
});

// ============================================
// 5. BANK SUMMARY
// ============================================
export const getBankSummary = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  // If you don't have a Bank model yet, this aggregates from ATM collection
  const summary = await ATM.aggregate([
    { $match: { isDeleted: false } },
    {
      $lookup: {
        from: "banks",
        localField: "bankId",
        foreignField: "_id",
        as: "bank",
      },
    },
    { $unwind: { path: "$bank", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$bankId",
        bankName: { $first: { $ifNull: ["$bank.bankName", "Unknown Bank"] } },
        totalATMs: { $sum: 1 },
        activeATMs: {
          $sum: { $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0] },
        },
        inactiveATMs: {
          $sum: { $cond: [{ $eq: ["$status", "INACTIVE"] }, 1, 0] },
        },
        maintenanceATMs: {
          $sum: { $cond: [{ $eq: ["$status", "UNDER_MAINTENANCE"] }, 1, 0] },
        },
        onsiteATMs: {
          $sum: { $cond: [{ $eq: ["$installationType", "ONSITE"] }, 1, 0] },
        },
        offsiteATMs: {
          $sum: { $cond: [{ $eq: ["$installationType", "OFFSITE"] }, 1, 0] },
        },
      },
    },
    { $sort: { totalATMs: -1 } },
  ]);

  return res
    .status(200)
    .json(
      new ApiResponse(200, { summary }, "Bank summary fetched successfully"),
    );
});

// ============================================
// 6. JOB TRENDS (For Charts)
// ============================================
export const getJobTrends = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const { period = "week" } = req.query; // "week", "month", "year"

  let groupFormat, limit, dateFilter;
  const now = new Date();

  if (period === "week") {
    // Last 7 days, group by day
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 6);
    weekAgo.setHours(0, 0, 0, 0);
    dateFilter = { createdAt: { $gte: weekAgo } };
    groupFormat = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
    limit = 7;
  } else if (period === "month") {
    // Last 30 days, group by day
    const monthAgo = new Date(now);
    monthAgo.setDate(now.getDate() - 29);
    monthAgo.setHours(0, 0, 0, 0);
    dateFilter = { createdAt: { $gte: monthAgo } };
    groupFormat = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
    limit = 30;
  } else {
    // Last 12 months, group by month
    const yearAgo = new Date(now);
    yearAgo.setMonth(now.getMonth() - 11);
    yearAgo.setDate(1);
    yearAgo.setHours(0, 0, 0, 0);
    dateFilter = { createdAt: { $gte: yearAgo } };
    groupFormat = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
    limit = 12;
  }

  const [createdTrend, completedTrend] = await Promise.all([
    Job.aggregate([
      { $match: { isDeleted: false, ...dateFilter } },
      { $group: { _id: groupFormat, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $limit: limit },
    ]),
    Job.aggregate([
      {
        $match: {
          isDeleted: false,
          status: { $in: ["COMPLETED", "VERIFIED", "APPROVED", "CLOSED"] },
          ...dateFilter,
        },
      },
      { $group: { _id: groupFormat, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $limit: limit },
    ]),
  ]);

  // Fill missing dates with zeros
  const fillMissingDates = (data, periodType) => {
    const result = [];
    const today = new Date();

    if (periodType === "week" || periodType === "month") {
      const days = periodType === "week" ? 7 : 30;
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const found = data.find((item) => item._id === dateStr);
        result.push({
          date: dateStr,
          label: d.toLocaleDateString("en-IN", {
            weekday: "short",
            day: "numeric",
          }),
          count: found ? found.count : 0,
        });
      }
    } else {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const found = data.find((item) => item._id === monthStr);
        result.push({
          date: monthStr,
          label: d.toLocaleDateString("en-IN", {
            month: "short",
            year: "numeric",
          }),
          count: found ? found.count : 0,
        });
      }
    }
    return result;
  };

  const createdFilled = fillMissingDates(createdTrend, period);
  const completedFilled = fillMissingDates(completedTrend, period);

  // Merge created and completed
  const trends = createdFilled.map((item, index) => ({
    date: item.date,
    label: item.label,
    created: item.count,
    completed: completedFilled[index]?.count || 0,
  }));

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { trends, period },
        "Job trends fetched successfully",
      ),
    );
});
