import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import Complaint from "./complaints.model.js";
import ATM from "../atms/atm.model.js";
import User from "../users/user.model.js";
import Job from "../jobs/jobs.model.js";

const generateComplaintId = async () => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const count = await Complaint.countDocuments({
    createdAt: {
      $gte: new Date(date.setHours(0, 0, 0, 0)),
      $lt: new Date(date.setHours(23, 59, 59, 999)),
    },
  });
  return `COMP-${dateStr}-${String(count + 1).padStart(3, "0")}`;
};

export const createComplaint = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Only admins can create complaints");

  const {
    title,
    description,
    atmId,
    customerId,
    reportedBy,
    reportedVia = "phone",
  } = req.body;

  const atm = await ATM.findById(atmId);
  if (!atm || atm.isDeleted) throw new ApiError(404, "ATM not found");

  if (customerId) {
    const customer = await User.findOne({
      _id: customerId,
      userType: "customer",
    });
    if (!customer) throw new ApiError(404, "Customer not found");
  }

  const complaintId = await generateComplaintId();

  const complaint = await Complaint.create({
    complaintId,
    title,
    description,
    atmId,
    customerId,
    reportedBy: reportedBy || "Unknown",
    reportedVia,
    status: "open",
    createdBy: req.user._id,
  });

  const populatedComplaint = await Complaint.findById(complaint._id)
    .populate("atmId", "atmId locationName bank address districtId regionId")
    .populate("customerId", "firstName lastName")
    .populate("createdBy", "firstName lastName");

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        populatedComplaint,
        "Complaint created successfully",
      ),
    );
});

export const getAllComplaints = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Access denied");

  const {
    status,
    atmId,
    customerId,
    fromDate,
    toDate,
    page = 1,
    limit = 10,
    search,
  } = req.query;
  const query = { isDeleted: false };

  if (status) query.status = status;
  if (atmId) query.atmId = atmId;
  if (customerId) query.customerId = customerId;
  if (fromDate || toDate) {
    query.createdAt = {};
    if (fromDate) query.createdAt.$gte = new Date(fromDate);
    if (toDate) query.createdAt.$lte = new Date(toDate);
  }
  if (search) {
    query.$or = [
      { complaintId: { $regex: search, $options: "i" } },
      { title: { $regex: search, $options: "i" } },
      { reportedBy: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const complaints = await Complaint.find(query)
    .populate("atmId", "atmId locationName bank address districtId regionId")
    .populate("customerId", "firstName lastName")
    .populate("jobId", "jobId status assignedEmployeeId")
    .populate("createdBy", "firstName lastName")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Complaint.countDocuments(query);
  const statusCounts = await Complaint.aggregate([
    { $match: { isDeleted: false } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        complaints,
        statusCounts: statusCounts.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
      "Complaints fetched successfully",
    ),
  );
});

export const getComplaintById = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Access denied");

  const { id } = req.params;
  const complaint = await Complaint.findById(id)
    .populate("atmId", "atmId locationName bank address districtId regionId")
    .populate("customerId", "firstName lastName")
    .populate("jobId", "jobId status assignedEmployeeId title")
    .populate("createdBy", "firstName lastName")
    .populate("resolvedBy", "firstName lastName")
    .populate("closedBy", "firstName lastName");

  if (!complaint || complaint.isDeleted)
    throw new ApiError(404, "Complaint not found");
  return res
    .status(200)
    .json(new ApiResponse(200, complaint, "Complaint fetched successfully"));
});

export const updateComplaint = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Access denied");

  const { id } = req.params;
  const { title, description, status, reportedBy, reportedVia } = req.body;

  const complaint = await Complaint.findById(id);
  if (!complaint || complaint.isDeleted)
    throw new ApiError(404, "Complaint not found");

  if (title) complaint.title = title;
  if (description !== undefined) complaint.description = description;
  if (reportedBy) complaint.reportedBy = reportedBy;
  if (reportedVia) complaint.reportedVia = reportedVia;

  if (
    status &&
    ["open", "in_progress", "resolved", "closed"].includes(status)
  ) {
    complaint.status = status;
    if (status === "resolved") {
      complaint.resolvedAt = new Date();
      complaint.resolvedBy = req.user._id;
    }
    if (status === "closed") {
      complaint.closedAt = new Date();
      complaint.closedBy = req.user._id;
    }
  }

  complaint.updatedBy = req.user._id;
  await complaint.save();

  const populatedComplaint = await Complaint.findById(complaint._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("jobId", "jobId status");

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

export const deleteComplaint = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Access denied");

  const { id } = req.params;
  const complaint = await Complaint.findById(id);
  if (!complaint || complaint.isDeleted)
    throw new ApiError(404, "Complaint not found");

  complaint.isDeleted = true;
  complaint.deletedAt = new Date();
  complaint.deletedBy = req.user._id;
  await complaint.save();

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Complaint deleted successfully"));
});

export const linkComplaintToJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Access denied");

  const { id } = req.params;
  const { jobId } = req.body;

  const complaint = await Complaint.findById(id);
  if (!complaint || complaint.isDeleted)
    throw new ApiError(404, "Complaint not found");

  const job = await Job.findById(jobId);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");

  complaint.jobId = jobId;
  complaint.status = "in_progress";
  complaint.updatedBy = req.user._id;
  await complaint.save();

  job.complaintId = id;
  await job.save();

  const populatedComplaint = await Complaint.findById(complaint._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("jobId", "jobId status title assignedEmployeeId");

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

export const getComplaintsByAtm = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Access denied");

  const { atmId } = req.params;
  const complaints = await Complaint.find({ atmId, isDeleted: false })
    .populate("jobId", "jobId status assignedEmployeeId")
    .populate("createdBy", "firstName lastName")
    .sort({ createdAt: -1 });

  return res
    .status(200)
    .json(
      new ApiResponse(200, complaints, "ATM complaints fetched successfully"),
    );
});

export const getComplaintStats = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Access denied");

  const total = await Complaint.countDocuments({ isDeleted: false });
  const openCount = await Complaint.countDocuments({
    status: "open",
    isDeleted: false,
  });
  const inProgressCount = await Complaint.countDocuments({
    status: "in_progress",
    isDeleted: false,
  });
  const resolvedCount = await Complaint.countDocuments({
    status: "resolved",
    isDeleted: false,
  });
  const closedCount = await Complaint.countDocuments({
    status: "closed",
    isDeleted: false,
  });

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
        total,
        open: openCount,
        inProgress: inProgressCount,
        resolved: resolvedCount,
        closed: closedCount,
        today: todayCount,
      },
      "Complaint stats fetched successfully",
    ),
  );
});
