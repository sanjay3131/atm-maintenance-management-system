import AMC from "./amc.model.js";
import Employee from "../employees/employee.model.js";
import ATM from "../atms/atm.model.js";
import User from "../users/user.model.js";
import { AMC_CONFIG, AMC_STATUS } from "./amc.config.js";
import { validateChecklist } from "./amcChecklist.js";
import { validateGpsProximity } from "../../utils/haversine.js";
import ApiError from "../../utils/ApiError.js";
import Notification from "../notification/notification.model.js";
/**
 * Generate AMC ID: AMC-YYYY-MM-NNN
 */
const generateAmcId = async (month, year) => {
  const prefix = `AMC-${year}-${String(month).padStart(2, "0")}`;
  const count = await AMC.countDocuments({
    amcId: { $regex: `^${prefix}` },
  });
  return `${prefix}-${String(count + 1).padStart(3, "0")}`;
};

/**
 * Generate AMC records for a given month/year.
 * Idempotent: skips if {atmId, month, year} already exists (enforced by unique index).
 */
export const generateMonthlyAMC = async (month, year, createdBy) => {
  // Find all active employees with assigned ATMs
  const employees = await Employee.find({
    status: "active",
    assignedAtmIds: { $exists: true, $ne: [] },
  }).populate("userId", "firstName lastName");

  const results = { created: 0, skipped: 0, errors: [] };

  for (const employee of employees) {
    const atms = await ATM.find({
      _id: { $in: employee.assignedAtmIds },
      isDeleted: false,
      status: { $in: ["ACTIVE", "UNDER_MAINTENANCE"] },
    })
      .populate("customer", "firstName lastName")
      .populate("bankId", "bankName")
      .populate("districtId", "districtName");

    for (const atm of atms) {
      try {
        const amcId = await generateAmcId(month, year);

        // Calculate deadline: 20th of the month
        const deadlineDate = new Date(
          year,
          month - 1,
          AMC_CONFIG.DEADLINE_DAY,
          23,
          59,
          59,
        );

        await AMC.create({
          amcId,
          atmId: atm._id,
          employeeId: employee.userId._id,
          supervisorId: employee.supervisorId || null,
          customerId: atm.customer || null,
          bankId: atm.bankId || null,
          districtId: atm.districtId || null,
          month,
          year,
          status: AMC_STATUS.PENDING,
          deadlineDate,
          createdBy,
        });

        results.created++;
      } catch (err) {
        // Unique index violation = already exists, skip silently
        if (err.code === 11000) {
          results.skipped++;
        } else {
          results.errors.push({
            atmId: atm.atmId,
            employee: employee.employeeCode,
            error: err.message,
          });
        }
      }
    }
  }

  return results;
};

/**
 * Mark overdue AMCs and notify admins.
 * Idempotent: only creates notification if not already sent for this AMC.
 */
export const markOverdueAMCs = async () => {
  const now = new Date();

  const overdueAmcs = await AMC.find({
    status: { $in: [AMC_STATUS.PENDING, AMC_STATUS.IN_PROGRESS] },
    deadlineDate: { $lt: now },
    isDeleted: false,
  })
    .populate("employeeId", "firstName lastName")
    .populate("atmId", "atmId locationName");

  const admins = await User.find({
    userType: { $in: ["admin", "superAdmin"] },
    status: "active",
  });

  const results = { marked: 0, notified: 0 };

  for (const amc of overdueAmcs) {
    amc.status = AMC_STATUS.OVERDUE;
    await amc.save();
    results.marked++;

    const existingNotification = await Notification.findOne({
      "data.amcId": amc._id,
      type: "amc_overdue",
    });

    if (!existingNotification) {
      await Notification.create({
        userId: amc.employeeId._id,
        type: "amc_overdue",
        title: "AMC Overdue",
        message: `AMC for ${amc.atmId.locationName} (${amc.atmId.atmId}) is overdue. Deadline was ${amc.deadlineDate.toDateString()}.`,
        data: { amcId: amc._id, month: amc.month, year: amc.year },
      });

      for (const admin of admins) {
        await Notification.create({
          userId: admin._id,
          type: "amc_overdue",
          title: "AMC Overdue Alert",
          message: `Employee ${amc.employeeId.firstName} ${amc.employeeId.lastName} has overdue AMC for ${amc.atmId.atmId}.`,
          data: {
            amcId: amc._id,
            employeeId: amc.employeeId._id,
            month: amc.month,
            year: amc.year,
          },
        });
      }

      results.notified++;
    }
  }

  return results;
};

/**
 * Validate AMC can be started
 */
export const validateAmcStart = async (amc, userId) => {
  if (amc.employeeId.toString() !== userId.toString()) {
    throw new ApiError(403, "This AMC is not assigned to you");
  }

  if (amc.status === AMC_STATUS.COMPLETED) {
    throw new ApiError(400, "AMC already completed");
  }

  const atm = await ATM.findById(amc.atmId);
  if (!atm || atm.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  if (!atm.locationConfigured || !atm.location?.coordinates) {
    throw new ApiError(
      400,
      "ATM location not configured. Please set the location first.",
    );
  }

  return { atm };
};

/**
 * Validate AMC can be completed
 */
export const validateAmcCompletion = async (amc, gps, checklist) => {
  const atm = await ATM.findById(amc.atmId);
  if (!atm || atm.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  if (!atm.locationConfigured || !atm.location?.coordinates) {
    throw new ApiError(400, "ATM location not configured");
  }

  // GPS validation (backend authoritative)
  const { latitude, longitude, accuracy } = gps;
  const { isValid, distance } = validateGpsProximity(
    latitude,
    longitude,
    atm.location.coordinates[1], // lat
    atm.location.coordinates[0], // lng
    AMC_CONFIG.GPS_RADIUS_METERS,
  );

  if (!isValid) {
    throw new ApiError(
      403,
      `You are ${distance} meters from the ATM. Must be within ${AMC_CONFIG.GPS_RADIUS_METERS} meters.`,
    );
  }

  // Checklist validation
  const checklistValidation = validateChecklist(checklist);
  if (!checklistValidation.valid) {
    throw new ApiError(
      400,
      `Checklist incomplete: ${checklistValidation.errors.join(", ")}`,
    );
  }

  // Photo count validation
  if (amc.photoCount < AMC_CONFIG.REQUIRED_PHOTOS) {
    throw new ApiError(
      400,
      `Required ${AMC_CONFIG.REQUIRED_PHOTOS} photos. Currently uploaded: ${amc.photoCount}.`,
    );
  }

  return { atm, distance, accuracy };
};

/**
 * Get AMC dashboard stats
 */
export const getAmcDashboardStats = async (month, year, filters = {}) => {
  const query = { month, year, isDeleted: false, ...filters };

  const [
    total,
    pending,
    inProgress,
    completed,
    overdue,
    byEmployee,
    byBank,
    byDistrict,
  ] = await Promise.all([
    AMC.countDocuments(query),
    AMC.countDocuments({ ...query, status: AMC_STATUS.PENDING }),
    AMC.countDocuments({ ...query, status: AMC_STATUS.IN_PROGRESS }),
    AMC.countDocuments({ ...query, status: AMC_STATUS.COMPLETED }),
    AMC.countDocuments({ ...query, status: AMC_STATUS.OVERDUE }),
    AMC.aggregate([
      { $match: query },
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
          as: "employee",
        },
      },
      { $unwind: "$employee" },
      {
        $project: {
          employeeId: "$_id",
          name: { $concat: ["$employee.firstName", " ", "$employee.lastName"] },
          total: 1,
          completed: 1,
          pending: 1,
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
    ]),
    AMC.aggregate([
      { $match: { ...query, bankId: { $ne: null } } },
      {
        $group: {
          _id: "$bankId",
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", AMC_STATUS.COMPLETED] }, 1, 0] },
          },
        },
      },
      {
        $lookup: {
          from: "banks",
          localField: "_id",
          foreignField: "_id",
          as: "bank",
        },
      },
      { $unwind: "$bank" },
      {
        $project: {
          bankId: "$_id",
          bankName: "$bank.bankName",
          total: 1,
          completed: 1,
        },
      },
    ]),
    AMC.aggregate([
      { $match: { ...query, districtId: { $ne: null } } },
      {
        $group: {
          _id: "$districtId",
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", AMC_STATUS.COMPLETED] }, 1, 0] },
          },
        },
      },
      {
        $lookup: {
          from: "districts",
          localField: "_id",
          foreignField: "_id",
          as: "district",
        },
      },
      { $unwind: "$district" },
      {
        $project: {
          districtId: "$_id",
          districtName: "$district.districtName",
          total: 1,
          completed: 1,
        },
      },
    ]),
  ]);

  const completionRate =
    total > 0 ? Math.round((completed / total) * 100 * 10) / 10 : 0;

  return {
    total,
    pending,
    inProgress,
    completed,
    overdue,
    completionRate,
    byEmployee,
    byBank,
    byDistrict,
  };
};
