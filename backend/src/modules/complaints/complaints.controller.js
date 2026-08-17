import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import Complaint from "./complaints.model.js";
import ATM from "../atms/atm.model.js";
import User from "../users/user.model.js";
import Job from "../jobs/jobs.model.js";

// ============================================
// HELPERS
// ============================================

const generateComplaintId = async () => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const startOfDay = new Date(date.setHours(0, 0, 0, 0));
  const endOfDay = new Date(date.setHours(23, 59, 59, 999));

  const count = await Complaint.countDocuments({
    createdAt: { $gte: startOfDay, $lt: endOfDay },
  });

  return `COMP-${dateStr}-${String(count + 1).padStart(3, "0")}`;
};

const populateComplaint = (query) => {
  return query
    .populate(
      "atmId",
      "atmId locationName bank address districtId regionId location installationType",
    )
    .populate("customerId", "firstName lastName email phoneNumber")
    .populate("jobId", "jobId status title assignedEmployeeId")
    .populate("createdBy", "firstName lastName email")
    .populate("updatedBy", "firstName lastName email")
    .populate("resolvedBy", "firstName lastName email")
    .populate("closedBy", "firstName lastName email");
};

// Status transition rules
const VALID_STATUS_TRANSITIONS = {
  OPEN: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

// ============================================
// 1. CREATE COMPLAINT
// ============================================
export const createComplaint = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Only admins can create complaints");
  }

  const {
    title,
    description,
    atmId,
    customerId,
    reportedBy,
    reportedVia = "phone",
    priority = "MEDIUM",
  } = req.body;

  const atm = await ATM.findById(atmId);
  if (!atm || atm.isDeleted) {
    throw new ApiError(404, "ATM not found or has been removed");
  }

  if (customerId) {
    const customer = await User.findOne({
      _id: customerId,
      userType: "customer",
      status: "active",
    });
    if (!customer) {
      throw new ApiError(404, "Customer not found or inactive");
    }
  }

  const complaintNumber = await generateComplaintId();

  const complaint = await Complaint.create({
    complaintNumber,
    title,
    description,
    atmId,
    customerId: customerId || null,
    reportedBy: reportedBy?.trim() || "Unknown",
    reportedVia,
    priority,
    status: "OPEN",
    createdBy: req.user._id,
  });

  const populatedComplaint = await populateComplaint(
    Complaint.findById(complaint._id),
  );

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        populatedComplaint,
        `Complaint ${complaintNumber} created successfully`,
      ),
    );
});

// ============================================
// 2. GET ALL COMPLAINTS
// ============================================
export const getAllComplaints = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const {
    status,
    priority,
    atmId,
    customerId,
    fromDate,
    toDate,
    page = 1,
    limit = 10,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  const query = { isDeleted: false };

  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (atmId) query.atmId = atmId;
  if (customerId) query.customerId = customerId;

  if (fromDate || toDate) {
    query.createdAt = {};
    if (fromDate) query.createdAt.$gte = new Date(fromDate);
    if (toDate) query.createdAt.$lte = new Date(toDate);
  }

  if (search?.trim()) {
    const searchRegex = { $regex: search.trim(), $options: "i" };
    query.$or = [
      { complaintNumber: searchRegex },
      { title: searchRegex },
      { reportedBy: searchRegex },
    ];
  }

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const sortDirection = sortOrder === "asc" ? 1 : -1;
  const sortOptions = { [sortBy]: sortDirection };

  const [complaints, total, statusCounts, priorityCounts] = await Promise.all([
    populateComplaint(
      Complaint.find(query).sort(sortOptions).skip(skip).limit(limitNum),
    ),
    Complaint.countDocuments(query),
    Complaint.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Complaint.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount = await Complaint.countDocuments({
    createdAt: { $gte: today },
    isDeleted: false,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        complaints,
        stats: {
          statusCounts: statusCounts.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
          }, {}),
          priorityCounts: priorityCounts.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
          }, {}),
          today: todayCount,
          total,
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
          hasNext: pageNum * limitNum < total,
          hasPrev: pageNum > 1,
        },
      },
      "Complaints fetched successfully",
    ),
  );
});

// ============================================
// 3. GET COMPLAINT BY ID
// ============================================
export const getComplaintById = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const { id } = req.params;

  const complaint = await populateComplaint(Complaint.findById(id));

  if (!complaint || complaint.isDeleted) {
    throw new ApiError(404, "Complaint not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, complaint, "Complaint fetched successfully"));
});

// ============================================
// 4. UPDATE COMPLAINT
// ============================================
export const updateComplaint = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const { id } = req.params;
  const {
    title,
    description,
    status,
    reportedBy,
    reportedVia,
    priority,
    resolutionNotes,
    closureReason,
  } = req.body;

  const complaint = await Complaint.findById(id);
  if (!complaint || complaint.isDeleted) {
    throw new ApiError(404, "Complaint not found");
  }

  if (["CLOSED", "CANCELLED"].includes(complaint.status)) {
    throw new ApiError(
      400,
      `Cannot update a ${complaint.status.toLowerCase()} complaint`,
    );
  }

  if (title !== undefined) complaint.title = title;
  if (description !== undefined) complaint.description = description;
  if (reportedBy !== undefined) complaint.reportedBy = reportedBy;
  if (reportedVia !== undefined) complaint.reportedVia = reportedVia;
  if (priority !== undefined) complaint.priority = priority;

  if (status && status !== complaint.status) {
    const allowedNext = VALID_STATUS_TRANSITIONS[complaint.status] || [];
    if (!allowedNext.includes(status)) {
      throw new ApiError(
        400,
        `Cannot transition from ${complaint.status} to ${status}. Allowed: ${allowedNext.join(", ") || "none"}`,
      );
    }

    complaint.status = status;

    if (status === "RESOLVED") {
      complaint.resolvedAt = new Date();
      complaint.resolvedBy = req.user._id;
      if (resolutionNotes) complaint.resolutionNotes = resolutionNotes;
    }

    if (status === "CLOSED") {
      complaint.closedAt = new Date();
      complaint.closedBy = req.user._id;
      if (closureReason) complaint.closureReason = closureReason;
    }
  }

  complaint.updatedBy = req.user._id;
  await complaint.save();

  const populatedComplaint = await populateComplaint(
    Complaint.findById(complaint._id),
  );

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        populatedComplaint,
        "Complaint updated successfully",
      ),
    );
});

// ============================================
// 5. DELETE COMPLAINT (Soft Delete)
// ============================================
export const deleteComplaint = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const { id } = req.params;

  const complaint = await Complaint.findById(id);
  if (!complaint || complaint.isDeleted) {
    throw new ApiError(404, "Complaint not found");
  }

  complaint.isDeleted = true;
  complaint.deletedAt = new Date();
  complaint.deletedBy = req.user._id;
  await complaint.save();

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { complaintNumber: complaint.complaintNumber },
        "Complaint deleted successfully",
      ),
    );
});

// ============================================
// 6. LINK COMPLAINT TO JOB
// ============================================
export const linkComplaintToJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const { id } = req.params;
  const { jobId } = req.body;

  const complaint = await Complaint.findById(id);
  if (!complaint || complaint.isDeleted) {
    throw new ApiError(404, "Complaint not found");
  }

  if (["CLOSED", "CANCELLED"].includes(complaint.status)) {
    throw new ApiError(400, "Cannot link a closed or cancelled complaint");
  }

  const job = await Job.findById(jobId);
  if (!job || job.isDeleted) {
    throw new ApiError(404, "Job not found");
  }

  if (job.atmId.toString() !== complaint.atmId.toString()) {
    throw new ApiError(400, "Job must be for the same ATM as the complaint");
  }

  complaint.jobId = jobId;
  complaint.status = "ASSIGNED";
  complaint.updatedBy = req.user._id;
  await complaint.save();

  job.complaintId = id;
  await job.save();

  const populatedComplaint = await populateComplaint(
    Complaint.findById(complaint._id),
  );

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        populatedComplaint,
        "Complaint linked to job successfully",
      ),
    );
});

// ============================================
// 7. UNLINK COMPLAINT FROM JOB
// ============================================
export const unlinkComplaintFromJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const { id } = req.params;

  const complaint = await Complaint.findById(id);
  if (!complaint || complaint.isDeleted) {
    throw new ApiError(404, "Complaint not found");
  }

  if (complaint.jobId) {
    await Job.findByIdAndUpdate(complaint.jobId, {
      $unset: { complaintId: 1 },
    });

    complaint.jobId = undefined;
    complaint.status = "OPEN";
    complaint.updatedBy = req.user._id;
    await complaint.save();
  }

  const populatedComplaint = await populateComplaint(
    Complaint.findById(complaint._id),
  );

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        populatedComplaint,
        "Complaint unlinked from job successfully",
      ),
    );
});

// ============================================
// 8. GET COMPLAINTS BY ATM
// ============================================
export const getComplaintsByAtm = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const { atmId } = req.params;
  const { status, page = 1, limit = 10 } = req.query;

  const query = { atmId, isDeleted: false };
  if (status) query.status = status;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [complaints, total] = await Promise.all([
    populateComplaint(
      Complaint.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
    ),
    Complaint.countDocuments(query),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        complaints,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      "ATM complaints fetched successfully",
    ),
  );
});

// ============================================
// 9. GET COMPLAINT STATS
// ============================================
export const getComplaintStats = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thisWeekStart = new Date(today);
  thisWeekStart.setDate(today.getDate() - today.getDay());

  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    total,
    openCount,
    assignedCount,
    inProgressCount,
    resolvedCount,
    closedCount,
    cancelledCount,
    todayCount,
    thisWeekCount,
    thisMonthCount,
    criticalCount,
    highCount,
    avgResolutionTime,
  ] = await Promise.all([
    Complaint.countDocuments({ isDeleted: false }),
    Complaint.countDocuments({ status: "OPEN", isDeleted: false }),
    Complaint.countDocuments({ status: "ASSIGNED", isDeleted: false }),
    Complaint.countDocuments({ status: "IN_PROGRESS", isDeleted: false }),
    Complaint.countDocuments({ status: "RESOLVED", isDeleted: false }),
    Complaint.countDocuments({ status: "CLOSED", isDeleted: false }),
    Complaint.countDocuments({ status: "CANCELLED", isDeleted: false }),
    Complaint.countDocuments({ createdAt: { $gte: today }, isDeleted: false }),
    Complaint.countDocuments({
      createdAt: { $gte: thisWeekStart },
      isDeleted: false,
    }),
    Complaint.countDocuments({
      createdAt: { $gte: thisMonthStart },
      isDeleted: false,
    }),
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
      {
        $match: {
          status: { $in: ["RESOLVED", "CLOSED"] },
          resolvedAt: { $exists: true },
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: null,
          avgHours: {
            $avg: {
              $divide: [
                { $subtract: ["$resolvedAt", "$createdAt"] },
                1000 * 60 * 60,
              ],
            },
          },
        },
      },
    ]),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        overview: {
          total,
          open: openCount,
          assigned: assignedCount,
          inProgress: inProgressCount,
          resolved: resolvedCount,
          closed: closedCount,
          cancelled: cancelledCount,
        },
        timeBased: {
          today: todayCount,
          thisWeek: thisWeekCount,
          thisMonth: thisMonthCount,
        },
        priority: {
          criticalOpen: criticalCount,
          highOpen: highCount,
        },
        performance: {
          avgResolutionHours: avgResolutionTime[0]?.avgHours
            ? Math.round(avgResolutionTime[0].avgHours * 100) / 100
            : 0,
          resolutionRate:
            total > 0
              ? Math.round(((resolvedCount + closedCount) / total) * 100)
              : 0,
        },
      },
      "Complaint statistics fetched successfully",
    ),
  );
});

// ============================================
// 10. GET COMPLAINTS BY CUSTOMER
// ============================================
export const getComplaintsByCustomer = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) {
    throw new ApiError(403, "Access denied");
  }

  const { customerId } = req.params;
  const { status, page = 1, limit = 10 } = req.query;

  const query = { customerId, isDeleted: false };
  if (status) query.status = status;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [complaints, total] = await Promise.all([
    populateComplaint(
      Complaint.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
    ),
    Complaint.countDocuments(query),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        complaints,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      "Customer complaints fetched successfully",
    ),
  );
});
