import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import AMC from "./amc.model.js";
import ATM from "../atms/atm.model.js";
import ATMLocationRequest from "../atms/atmLocationRequest.model.js";
import Employee from "../employees/employee.model.js";
import {
  generateMonthlyAMC,
  markOverdueAMCs,
  validateAmcStart,
  validateAmcCompletion,
  getAmcDashboardStats,
} from "./amc.service.js";
import {
  AMC_STATUS,
  AMC_CONFIG,
  VALID_AMC_TRANSITIONS,
} from "./amc.config.js";
import { validateChecklist } from "./amcChecklist.js";
import Notification from "../notification/notification.model.js";
import User from "../users/user.model.js";
import mongoose from "mongoose";
import {
  getActiveCustomerForUser,
  sameCustomerId,
  toCustomerSafeAMC,
} from "../customers/customerAccess.js";
import { getBusinessDateParts } from "../jobs/recurringMaintenance.utils.js";

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
const toSupervisorAMCResponse = (amc, detailed = false) => {
  const record = typeof amc.toObject === "function" ? amc.toObject() : amc;
  const response = {
    _id: record._id,
    amcId: record.amcId,
    atmId:
      record.atmId && typeof record.atmId === "object"
        ? {
            _id: record.atmId._id,
            atmId: record.atmId.atmId,
            locationName: record.atmId.locationName,
            address: record.atmId.address,
          }
        : record.atmId,
    employeeId:
      record.employeeId && typeof record.employeeId === "object"
        ? {
            _id: record.employeeId._id,
            firstName: record.employeeId.firstName,
            lastName: record.employeeId.lastName,
          }
        : record.employeeId,
    month: record.month,
    year: record.year,
    status: record.status,
    deadlineDate: record.deadlineDate,
    visitDate: record.visitDate,
    completedAt: record.completedAt,
  };

  if (detailed) {
    Object.assign(response, {
      generatedAt: record.generatedAt,
      createdAt: record.createdAt,
      checklist: record.checklist,
      checklistCompleted: record.checklistCompleted,
      employeeRemarks: record.employeeRemarks,
      photoCount: record.photoCount,
    });
  }

  return response;
};

const toAdminAMCResponse = (amc) => {
  const record = typeof amc.toObject === "function" ? amc.toObject() : amc;
  const populated = (value, fields) => {
    if (!value || typeof value !== "object") return value;
    const selectedFields = fields.filter((field) => value[field] !== undefined);
    if (selectedFields.length === 0) {
      return typeof value.toHexString === "function" ? value.toString() : value;
    }
    return Object.fromEntries(
      selectedFields.map((field) => [field, value[field]]),
    );
  };

  return {
    _id: record._id,
    amcId: record.amcId,
    atmId: populated(record.atmId, [
      "_id",
      "atmId",
      "locationName",
      "address",
    ]),
    bankId: populated(record.bankId, ["_id", "bankName"]),
    customerId: populated(record.customerId, ["_id", "customerName"]),
    districtId: populated(record.districtId, ["_id", "districtName"]),
    employeeId: populated(record.employeeId, [
      "_id",
      "firstName",
      "lastName",
      "email",
      "phoneNumber",
    ]),
    month: record.month,
    year: record.year,
    status: record.status,
    deadlineDate: record.deadlineDate,
    visitDate: record.visitDate,
    completedAt: record.completedAt,
    generatedAt: record.generatedAt,
    createdAt: record.createdAt,
    checklist: record.checklist,
    checklistCompleted: record.checklistCompleted,
    employeeRemarks: record.employeeRemarks,
    photoCount: record.photoCount,
    gpsValidated: record.gpsValidated,
    gpsDistance: record.gpsDistance,
  };
};

export const getAMCById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, "Invalid AMC ID");
  }

  const isSupervisor = req.user.userType === "supervisor";
  let amcQuery = AMC.findById(id);
  if (isSupervisor) {
    amcQuery = amcQuery.select(
      "amcId atmId employeeId month year status deadlineDate visitDate completedAt generatedAt createdAt checklist checklistCompleted employeeRemarks photoCount isDeleted",
    );
  }
  const amc = isSupervisor
    ? await amcQuery
        .populate("atmId", "atmId locationName address")
        .populate("employeeId", "firstName lastName")
    : await amcQuery
        .populate(
          "atmId",
          "atmId locationName bankId address location locationConfigured locationCapturedBy locationCapturedAt locationRequestReopenedAt locationRequestWindowOpen locationRequestApproved",
        )
        .populate("employeeId", "firstName lastName email phoneNumber")
        .populate("supervisorId", "firstName lastName")
        .populate(
          "customerId",
          "customerName customerEmail customerPhone bankName",
        )
        .populate("bankId", "bankName bankCode")
        .populate("districtId", "districtName")
        .populate("photos", "url thumbnailUrl uploadedAt gpsData");

  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  // Authorization
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isEmployee = req.user.userType === "employee";
  const isCustomer = req.user.userType === "customer";

  if (!isAdmin && !isSupervisor && !isEmployee && !isCustomer) {
    throw new ApiError(403, "Access denied");
  }

  if (
    isEmployee &&
    amc.employeeId?._id?.toString() !== req.user._id.toString()
  ) {
    throw new ApiError(403, "Access denied");
  }

  if (isEmployee && amc.atmId?._id) {
    const hasApprovedLocationRequest = await ATMLocationRequest.exists({
      atmId: amc.atmId._id,
      status: "APPROVED",
    });
    amc.atmId.locationRequestApproved =
      Boolean(amc.atmId.locationRequestApproved) ||
      Boolean(hasApprovedLocationRequest);
  }

  if (isSupervisor) {
    const employeeUserId = amc.employeeId?._id ?? amc.employeeId;
    if (
      !employeeUserId ||
      !mongoose.isValidObjectId(employeeUserId) ||
      !(await Employee.findOne({
        supervisorId: req.user._id,
        userId: employeeUserId,
      }))
    ) {
      throw new ApiError(404, "AMC not found");
    }
  }

  if (isCustomer) {
    const customer = await getActiveCustomerForUser(req.user);
    if (
      !sameCustomerId(amc.customerId, customer._id) ||
      amc.status !== AMC_STATUS.COMPLETED
    ) {
      throw new ApiError(404, "AMC not found");
    }
    return res
      .status(200)
      .json(
        new ApiResponse(200, toCustomerSafeAMC(amc), "AMC fetched"),
      );
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      isSupervisor
        ? toSupervisorAMCResponse(amc, true)
        : isAdmin
          ? toAdminAMCResponse(amc)
          : amc,
      "AMC fetched",
    ),
  );
});

// ============================================
// 4. START AMC
// ============================================
export const startAMC = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const amc = await AMC.findById(id);
  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  await validateAmcStart(amc, req.user._id);

  const startableStatuses = Object.entries(VALID_AMC_TRANSITIONS)
    .filter(([, transitions]) =>
      transitions.includes(AMC_STATUS.IN_PROGRESS),
    )
    .map(([status]) => status);
  const visitDate = new Date();
  const startedAmc = await AMC.findOneAndUpdate(
    {
      _id: amc._id,
      employeeId: req.user._id,
      isDeleted: false,
      status: { $in: startableStatuses },
      visitDate: null,
    },
    {
      $set: {
        status: AMC_STATUS.IN_PROGRESS,
        visitDate,
        updatedBy: req.user._id,
      },
    },
    { new: true, runValidators: true },
  );

  if (!startedAmc) {
    throw new ApiError(
      409,
      "AMC visit was already started or is no longer eligible",
    );
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        startedAmc,
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

  if (
    !amc.visitDate ||
    ![AMC_STATUS.IN_PROGRESS, AMC_STATUS.OVERDUE].includes(amc.status)
  ) {
    throw new ApiError(400, "AMC visit has not been started");
  }

  const validation = validateChecklist(checklist);
  if (!validation.valid) {
    throw new ApiError(
      400,
      `Invalid checklist: ${validation.errors.join(", ")}`,
    );
  }

  const updatedAMC = await AMC.findOneAndUpdate(
    {
      _id: amc._id,
      employeeId: req.user._id,
      isDeleted: false,
      status: amc.status,
      visitDate: amc.visitDate,
    },
    {
      $set: {
        checklist,
        checklistCompleted: true,
        updatedBy: req.user._id,
      },
    },
    { new: true, runValidators: true },
  );
  if (!updatedAMC) {
    throw new ApiError(
      409,
      "AMC status changed before the checklist could be saved",
    );
  }

  return res
    .status(200)
    .json(new ApiResponse(200, updatedAMC, "Checklist saved"));
});

// ============================================
// 6. COMPLETE AMC
// ============================================
export const completeAMC = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { gps, remarks } = req.body;

  if (!gps || typeof gps !== "object") {
    throw new ApiError(400, "GPS coordinates are required");
  }

  const amc = await AMC.findById(id);
  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  if (amc.employeeId.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "This AMC is not assigned to you");
  }

  if (amc.status === AMC_STATUS.COMPLETED) {
    throw new ApiError(409, "AMC is already completed");
  }

  if (
    !VALID_AMC_TRANSITIONS[amc.status]?.includes(AMC_STATUS.COMPLETED)
  ) {
    throw new ApiError(400, `Cannot complete AMC with status: ${amc.status}`);
  }

  if (!amc.visitDate) {
    throw new ApiError(400, "AMC visit has not been started");
  }

  if (!amc.checklistCompleted) {
    throw new ApiError(400, "Checklist not completed");
  }

  const { distance, accuracy } = await validateAmcCompletion(
    amc,
    gps,
    amc.checklist,
  );

  const completedAt = new Date();
  const completedAMC = await AMC.findOneAndUpdate(
    {
      _id: amc._id,
      employeeId: req.user._id,
      isDeleted: false,
      status: amc.status,
      visitDate: amc.visitDate,
      checklistCompleted: true,
      photoCount: { $gte: AMC_CONFIG.REQUIRED_PHOTOS },
    },
    {
      $set: {
        status: AMC_STATUS.COMPLETED,
        completedAt,
        visitGps: {
          latitude: gps.latitude,
          longitude: gps.longitude,
          accuracy: accuracy || gps.accuracy,
        },
        gpsDistance: distance,
        gpsValidated: true,
        employeeRemarks: remarks || "",
        updatedBy: req.user._id,
      },
    },
    { new: true, runValidators: true },
  );
  if (!completedAMC) {
    throw new ApiError(409, "AMC visit was completed or changed by another request");
  }

  // Notify admin

  const admins = await User.find({
    userType: { $in: ["admin", "superAdmin"] },
    status: "active",
  });
  for (const admin of admins) {
    await Notification.create({
      userId: admin._id,
      type: "amc_completed",
      title: "AMC Completed",
      message: `Employee ${req.user.firstName} ${req.user.lastName} completed AMC for ATM ${completedAMC.atmId}.`,
      data: { amcId: completedAMC._id, atmId: completedAMC.atmId },
    });
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        completedAMC,
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
    const supervisedIds = supervisedEmployees
      .map((employee) => employee.userId)
      .filter((id) => id && mongoose.isValidObjectId(id))
      .map((id) => id.toString());
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
    (isSupervisor
      ? AMC.find(query)
          .select(
            "amcId atmId employeeId month year status deadlineDate visitDate completedAt",
          )
          .populate("atmId", "atmId locationName address")
          .populate("employeeId", "firstName lastName")
      : AMC.find(query)
          .populate("atmId", "atmId locationName bankId address")
          .populate("employeeId", "firstName lastName email phoneNumber")
          .populate("bankId", "bankName")
          .populate("customerId", "customerName")
          .populate("districtId", "districtName"))
      .sort({ year: -1, month: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    AMC.countDocuments(query),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        amcs: isSupervisor
          ? amcs.map((amc) => toSupervisorAMCResponse(amc))
          : amcs,
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
  const currentMonth = isSupervisor
    ? getBusinessDateParts(now)
    : { month: now.getMonth() + 1, year: now.getFullYear() };
  const queryMonth = parseInt(month) || currentMonth.month;
  const queryYear = parseInt(year) || currentMonth.year;

  let filters = {};

  if (isSupervisor) {
    const supervisedEmployees = await Employee.find({
      supervisorId: req.user._id,
    }).select("userId");
    const supervisedIds = supervisedEmployees
      .map((employee) => employee.userId)
      .filter((id) => id && mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    filters.employeeId = {
      $in: supervisedIds,
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
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, "Invalid AMC ID");
  }
  const amc = await AMC.findById(id);
  if (!amc || amc.isDeleted) throw new ApiError(404, "AMC not found");

  // Authorization
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isSupervisor = req.user.userType === "supervisor";
  const isCustomer = req.user.userType === "customer";
  const isEmployee = req.user.userType === "employee";

  if (isEmployee && amc.employeeId.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "Access denied");
  }

  if (isCustomer) {
    const customer = await getActiveCustomerForUser(req.user);
    if (
      !sameCustomerId(amc.customerId, customer._id) ||
      amc.status !== AMC_STATUS.COMPLETED
    ) {
      throw new ApiError(404, "AMC not found");
    }
  }

  if (!isAdmin && !isSupervisor && !isEmployee && !isCustomer) {
    throw new ApiError(403, "Access denied");
  }

  if (isSupervisor) {
    if (
      !amc.employeeId ||
      !mongoose.isValidObjectId(amc.employeeId) ||
      !(await Employee.findOne({
        supervisorId: req.user._id,
        userId: amc.employeeId,
      }))
    ) {
      throw new ApiError(404, "AMC not found");
    }
  }

  const { generateAMCPDF } = await import("../reports/amcReport.service.js");
  const { buffer, filename } = await generateAMCPDF(id, {
    customerSafe: isCustomer,
    supervisorSafe: isSupervisor,
    embedPhotos: isAdmin,
  });

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
