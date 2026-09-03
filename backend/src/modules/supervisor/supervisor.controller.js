import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import Employee from "../employees/employee.model.js";
import User from "../users/user.model.js";
import ATM from "../atms/atm.model.js";
import Job from "../jobs/jobs.model.js";
import AMC from "../amc/amc.model.js";
import { AMC_STATUS } from "../amc/amc.config.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";
import mongoose from "mongoose";

// ============================================
// GET SUPERVISED EMPLOYEES
// ============================================
export const getSupervisedEmployees = asyncHandler(async (req, res) => {
  if (req.user.userType !== "supervisor") {
    throw new ApiError(403, "Access denied");
  }

  const employees = await Employee.find({ supervisorId: req.user._id })
    .populate("userId", "firstName lastName email phoneNumber status")
    .populate("districtIds", "districtName")
    .populate("assignedAtmIds", "atmId locationName status");

  return res
    .status(200)
    .json(new ApiResponse(200, employees, "Supervised employees fetched"));
});

// ============================================
// SUPERVISOR DASHBOARD
// ============================================
export const getSupervisorDashboard = asyncHandler(async (req, res) => {
  if (req.user.userType !== "supervisor") {
    throw new ApiError(403, "Access denied");
  }

  const supervisedEmployees = await Employee.find({
    supervisorId: req.user._id,
  });
  const employeeUserIds = supervisedEmployees.map((e) => e.userId.toString());

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const [
    totalEmployees,
    totalATMs,
    todayJobsCompleted,
    todayJobsPending,
    amcStats,
    recentJobs,
  ] = await Promise.all([
    supervisedEmployees.length,
    ATM.countDocuments({
      assignedEmployeeId: { $in: supervisedEmployees.map((e) => e._id) },
      isDeleted: false,
    }),
    Job.countDocuments({
      assignedEmployeeId: { $in: employeeUserIds },
      status: {
        $in: [
          JOB_STATUS.COMPLETED,
          JOB_STATUS.VERIFIED,
          JOB_STATUS.APPROVED,
          JOB_STATUS.CLOSED,
        ],
      },
      updatedAt: { $gte: new Date(now.setHours(0, 0, 0, 0)) },
      isDeleted: false,
    }),
    Job.countDocuments({
      assignedEmployeeId: { $in: employeeUserIds },
      status: {
        $in: [
          JOB_STATUS.PENDING,
          JOB_STATUS.ASSIGNED,
          JOB_STATUS.ACCEPTED,
          JOB_STATUS.IN_PROGRESS,
        ],
      },
      isDeleted: false,
    }),
    AMC.aggregate([
      {
        $match: {
          employeeId: {
            $in: employeeUserIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
          month,
          year,
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", AMC_STATUS.COMPLETED] }, 1, 0] },
          },
          pending: {
            $sum: { $cond: [{ $eq: ["$status", AMC_STATUS.PENDING] }, 1, 0] },
          },
          overdue: {
            $sum: { $cond: [{ $eq: ["$status", AMC_STATUS.OVERDUE] }, 1, 0] },
          },
        },
      },
    ]),
    Job.find({
      assignedEmployeeId: { $in: employeeUserIds },
      isDeleted: false,
    })
      .populate("atmId", "atmId locationName")
      .populate("assignedEmployeeId", "firstName lastName")
      .sort({ updatedAt: -1 })
      .limit(10),
  ]);

  const amc = amcStats[0] || { total: 0, completed: 0, pending: 0, overdue: 0 };

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        employees: { total: totalEmployees },
        atms: { total: totalATMs },
        jobs: { completed: todayJobsCompleted, pending: todayJobsPending },
        amc: {
          ...amc,
          completionRate:
            amc.total > 0 ? Math.round((amc.completed / amc.total) * 100) : 0,
        },
        recentJobs,
      },
      "Supervisor dashboard fetched",
    ),
  );
});

// ============================================
// GET EMPLOYEE AMC PROGRESS (Supervisor)
// ============================================
export const getEmployeeAMCProgress = asyncHandler(async (req, res) => {
  if (req.user.userType !== "supervisor") {
    throw new ApiError(403, "Access denied");
  }

  const { employeeId } = req.params;
  const { month, year } = req.query;

  const now = new Date();
  const queryMonth = parseInt(month) || now.getMonth() + 1;
  const queryYear = parseInt(year) || now.getFullYear();

  // Verify this employee is supervised by current user
  const employee = await Employee.findOne({
    userId: employeeId,
    supervisorId: req.user._id,
  });
  if (!employee) throw new ApiError(403, "Employee not under your supervision");

  const amcs = await AMC.find({
    employeeId,
    month: queryMonth,
    year: queryYear,
    isDeleted: false,
  })
    .populate("atmId", "atmId locationName bank address")
    .sort({ status: 1, deadlineDate: 1 });

  const statusCounts = {
    total: amcs.length,
    completed: amcs.filter((a) => a.status === AMC_STATUS.COMPLETED).length,
    pending: amcs.filter((a) => a.status === AMC_STATUS.PENDING).length,
    inProgress: amcs.filter((a) => a.status === AMC_STATUS.IN_PROGRESS).length,
    overdue: amcs.filter((a) => a.status === AMC_STATUS.OVERDUE).length,
  };

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { amcs, statusCounts, month: queryMonth, year: queryYear },
        "Employee AMC progress",
      ),
    );
});
