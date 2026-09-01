import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import AMC from "./amc.model.js";
import ATM from "../atms/atm.model.js";
import Employee from "../employees/employee.model.js";
import {
  generateMonthlyAMC,
  markOverdueAMCs,
  validateAmcStart,
  validateAmcCompletion,
  getAmcDashboardStats,
} from "./amc.service.js";
import { AMC_STATUS, AMC_CONFIG } from "./amc.config.js";
import { validateChecklist } from "./amcChecklist.js";

// ============================================
// 1. MANUAL GENERATE AMC
// ============================================
export const generateAMC = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Only admins can generate AMC");

  const { month, year } = req.body;
  const now = new Date();
  const targetMonth = month || now.getMonth() + 1;
  const targetYear = year || now.getFullYear();

  const results = await generateMonthlyAMC(
    targetMonth,
    targetYear,
    req.user._id,
  );

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        results,
        `AMC generation complete for ${targetMonth}/${targetYear}`,
      ),
    );
});

// ============================================
// 2. GET MY AMC (Employee)
// ============================================
export const getMyAMC = asyncHandler(async (req, res) => {
  if (req.user.userType !== "employee") {
    throw new ApiError(403, "Only employees");
  }

  const { month, year, status, page = 1, limit = 20 } = req.query;
  const now = new Date();
  const queryMonth = parseInt(month) || now.getMonth() + 1;
  const queryYear = parseInt(year) || now.getFullYear();

  const query = {
    employeeId: req.user._id,
    month: queryMonth,
    year: queryYear,
    isDeleted: false,
  };
  if (status) query.status = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [amcs, total, statusCounts] = await Promise.all([
    AMC.find(query)
      .populate("atmId", "atmId locationName bankId address locationConfigured")
      .populate("bankId", "bankName")
      .sort({ status: 1, deadlineDate: 1 })
      .skip(skip)
      .limit(parseInt(limit)),
    AMC.countDocuments(query),
    AMC.aggregate([
      {
        $match: {
          employeeId: req.user._id,
          month: queryMonth,
          year: queryYear,
          isDeleted: false,
        },
      },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        amcs,
        month: queryMonth,
        year: queryYear,
        statusCounts: statusCounts.reduce((acc, c) => {
          acc[c._id] = c.count;
          return acc;
        }, {}),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
      "My AMC fetched",
    ),
  );
});

// ============================================
// 3. GET AMC BY ID
// ============================================
export const getAMCById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const amc = await AMC.findById(id)
    .populate(
      "atmId",
      "atmId locationName bank address location locationConfigured locationCapturedBy locationCapturedAt",
    )
    .populate("employeeId", "firstName lastName employeeCode phoneNumber")
    .populate("supervisorId", "firstName lastName")
    .populate("customerId", "firstName lastName")
    .populate("bankId", "bankName bankCode")
    .populate("districtId", "districtName")
    .populate("photos", "url thumbnailUrl uploadedAt gpsData");

  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  // Authorization
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isSupervisor = req.user.userType === "supervisor";
  const isEmployee = req.user.userType === "employee";
  const isCustomer = req.user.userType === "customer";

  if (
    isEmployee &&
    amc.employeeId?._id?.toString() !== req.user._id.toString()
  ) {
    throw new ApiError(403, "Access denied");
  }

  if (isSupervisor) {
    // Supervisor can only see AMCs of their supervised employees
    const supervisedEmployees = await Employee.find({
      supervisorId: req.user._id,
    }).select("userId");
    const supervisedIds = supervisedEmployees.map((e) => e.userId.toString());
    if (!supervisedIds.includes(amc.employeeId?._id?.toString())) {
      throw new ApiError(403, "Access denied");
    }
  }

  if (isCustomer) {
    if (amc.customerId?._id?.toString() !== req.user._id.toString()) {
      throw new ApiError(403, "Access denied");
    }
    // Customer only sees completed AMCs
    if (amc.status !== AMC_STATUS.COMPLETED) {
      throw new ApiError(403, "AMC not yet completed");
    }
  }

  return res.status(200).json(new ApiResponse(200, amc, "AMC fetched"));
});

// ============================================
// 4. START AMC
// ============================================
export const startAMC = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const amc = await AMC.findById(id);
  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  const { atm } = await validateAmcStart(amc, req.user._id);

  if (amc.status !== AMC_STATUS.PENDING) {
    throw new ApiError(400, `Cannot start AMC with status: ${amc.status}`);
  }

  amc.status = AMC_STATUS.IN_PROGRESS;
  amc.visitDate = new Date();
  amc.updatedBy = req.user._id;
  await amc.save();

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        amc,
        "AMC started. Visit the ATM and complete the checklist.",
      ),
    );
});

// ============================================
// 5. SAVE CHECKLIST
// ============================================
export const saveChecklist = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { checklist } = req.body;

  const amc = await AMC.findById(id);
  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  if (amc.employeeId.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "This AMC is not assigned to you");
  }

  if (amc.status === AMC_STATUS.COMPLETED) {
    throw new ApiError(400, "AMC already completed");
  }

  const validation = validateChecklist(checklist);
  if (!validation.valid) {
    throw new ApiError(
      400,
      `Invalid checklist: ${validation.errors.join(", ")}`,
    );
  }

  amc.checklist = checklist;
  amc.checklistCompleted = true;
  amc.updatedBy = req.user._id;
  await amc.save();

  return res.status(200).json(new ApiResponse(200, amc, "Checklist saved"));
});

// ============================================
// 6. COMPLETE AMC
// ============================================
export const completeAMC = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { gps, remarks } = req.body;

  const amc = await AMC.findById(id);
  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  if (amc.employeeId.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "This AMC is not assigned to you");
  }

  if (amc.status === AMC_STATUS.COMPLETED) {
    throw new ApiError(400, "AMC already completed");
  }

  if (!amc.checklistCompleted) {
    throw new ApiError(400, "Checklist not completed");
  }

  const { distance, accuracy } = await validateAmcCompletion(
    amc,
    gps,
    amc.checklist,
  );

  amc.status = AMC_STATUS.COMPLETED;
  amc.completedAt = new Date();
  amc.visitGps = {
    latitude: gps.latitude,
    longitude: gps.longitude,
    accuracy: accuracy || gps.accuracy,
  };
  amc.gpsDistance = distance;
  amc.gpsValidated = true;
  amc.employeeRemarks = remarks || "";
  amc.updatedBy = req.user._id;
  await amc.save();

  // Notify admin
  const Notification = (await import("../notifications/notification.model.js"))
    .default;
  const admins = await User.find({
    userType: { $in: ["admin", "superAdmin"] },
    status: "active",
  });
  for (const admin of admins) {
    await Notification.create({
      userId: admin._id,
      type: "amc_completed",
      title: "AMC Completed",
      message: `Employee ${req.user.firstName} ${req.user.lastName} completed AMC for ATM ${amc.amcId}.`,
      data: { amcId: amc._id, atmId: amc.atmId },
    });
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        amc,
        `AMC completed. GPS validated: ${distance}m from ATM.`,
      ),
    );
});

// ============================================
// 7. GET ALL AMC (Admin/Supervisor)
// ============================================
export const getAllAMC = asyncHandler(async (req, res) => {
  const {
    month,
    year,
    status,
    employeeId,
    atmId,
    customerId,
    bankId,
    districtId,
    page = 1,
    limit = 20,
    search,
  } = req.query;

  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isSupervisor = req.user.userType === "supervisor";

  const query = { isDeleted: false };

  // Supervisor scope: only their employees' AMCs
  if (isSupervisor) {
    const supervisedEmployees = await Employee.find({
      supervisorId: req.user._id,
    }).select("userId");
    const supervisedIds = supervisedEmployees.map((e) => e.userId.toString());
    query.employeeId = { $in: supervisedIds };
  }

  if (month) query.month = parseInt(month);
  if (year) query.year = parseInt(year);
  if (status) query.status = status;
  if (employeeId && isAdmin) query.employeeId = employeeId;
  if (atmId) query.atmId = atmId;
  if (customerId && isAdmin) query.customerId = customerId;
  if (bankId) query.bankId = bankId;
  if (districtId) query.districtId = districtId;

  if (search?.trim()) {
    // Search by AMC ID
    query.amcId = { $regex: search.trim(), $options: "i" };
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [amcs, total] = await Promise.all([
    AMC.find(query)
      .populate("atmId", "atmId locationName bank address")
      .populate("employeeId", "firstName lastName employeeCode")
      .populate("bankId", "bankName")
      .populate("districtId", "districtName")
      .sort({ year: -1, month: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    AMC.countDocuments(query),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        amcs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
      "AMC list fetched",
    ),
  );
});

// ============================================
// 8. AMC DASHBOARD
// ============================================
export const getAMCDashboard = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isSupervisor = req.user.userType === "supervisor";

  const { month, year } = req.query;
  const now = new Date();
  const queryMonth = parseInt(month) || now.getMonth() + 1;
  const queryYear = parseInt(year) || now.getFullYear();

  let filters = {};

  if (isSupervisor) {
    const supervisedEmployees = await Employee.find({
      supervisorId: req.user._id,
    }).select("userId");
    const supervisedIds = supervisedEmployees.map((e) => e.userId.toString());
    filters.employeeId = {
      $in: supervisedIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }

  const stats = await getAmcDashboardStats(queryMonth, queryYear, filters);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { ...stats, month: queryMonth, year: queryYear },
        "AMC dashboard fetched",
      ),
    );
});

// ============================================
// 9. EMPLOYEE AMC SUMMARY
// ============================================
export const getEmployeeAMCSummary = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Access denied");

  const { month, year } = req.query;
  const now = new Date();
  const queryMonth = parseInt(month) || now.getMonth() + 1;
  const queryYear = parseInt(year) || now.getFullYear();

  const summary = await AMC.aggregate([
    { $match: { month: queryMonth, year: queryYear, isDeleted: false } },
    {
      $group: {
        _id: "$employeeId",
        total: { $sum: 1 },
        completed: {
          $sum: { $cond: [{ $eq: ["$status", AMC_STATUS.COMPLETED] }, 1, 0] },
        },
        pending: {
          $sum: { $cond: [{ $eq: ["$status", AMC_STATUS.PENDING] }, 1, 0] },
        },
        inProgress: {
          $sum: { $cond: [{ $eq: ["$status", AMC_STATUS.IN_PROGRESS] }, 1, 0] },
        },
        overdue: {
          $sum: { $cond: [{ $eq: ["$status", AMC_STATUS.OVERDUE] }, 1, 0] },
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
        total: 1,
        completed: 1,
        pending: 1,
        inProgress: 1,
        overdue: 1,
        completionRate: {
          $cond: [
            { $gt: ["$total", 0] },
            {
              $round: [
                { $multiply: [{ $divide: ["$completed", "$total"] }, 100] },
                1,
              ],
            },
            0,
          ],
        },
      },
    },
    { $sort: { total: -1 } },
  ]);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { summary, month: queryMonth, year: queryYear },
        "Employee AMC summary",
      ),
    );
});

// ============================================
// 10. DOWNLOAD AMC PDF REPORT
// ============================================
export const downloadAMCReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const amc = await AMC.findById(id);
  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  // Authorization
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isSupervisor = req.user.userType === "supervisor";
  const isCustomer = req.user.userType === "customer";

  if (isCustomer && amc.customerId?.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "Access denied");
  }

  if (isSupervisor) {
    const Employee = (await import("../employees/employee.model.js")).default;
    const supervised = await Employee.findOne({
      supervisorId: req.user._id,
      userId: amc.employeeId,
    });
    if (!supervised) throw new ApiError(403, "Access denied");
  }

  const { generateAMCPDF } = await import("../reports/amcReport.service.js");
  const { buffer, filename } = await generateAMCPDF(id);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

// ============================================
// 11. DOWNLOAD AMC PHOTO ZIP
// ============================================
export const downloadAMCPhotoZip = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const amc = await AMC.findById(id);
  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Admin only");

  const { generateAMCPhotoZip } =
    await import("../reports/amcReport.service.js");
  const { buffer, filename } = await generateAMCPhotoZip(id);

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

// ============================================
// 12. BULK DOWNLOAD AMC ZIP
// ============================================
export const downloadBulkAMCZip = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Admin only");

  const { month, year } = req.query;
  if (!month || !year) throw new ApiError(400, "Month and year required");

  const { generateBulkAMCZip } =
    await import("../reports/amcReport.service.js");
  const { buffer, filename } = await generateBulkAMCZip(
    parseInt(month),
    parseInt(year),
  );

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});
