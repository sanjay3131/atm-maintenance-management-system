import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import Job from "./jobs.model.js";
import JobHistory from "./jobHistory.model.js";
import ATM from "../atms/atm.model.js";
import User from "../users/user.model.js";
import { validateGpsProximity } from "../../utils/haversine.js";
import { JOB_STATUS, VALID_STATUS_TRANSITIONS } from "../../utils/jobStatus.js";
import { deleteJobPhotos } from "../../config/cloudinaryCleanup.js";

// ============================================
// HELPERS
// ============================================
const generateJobId = async () => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const count = await Job.countDocuments({
    createdAt: {
      $gte: new Date(date.setHours(0, 0, 0, 0)),
      $lt: new Date(date.setHours(23, 59, 59, 999)),
    },
  });
  return `JOB-${dateStr}-${String(count + 1).padStart(3, "0")}`;
};

const logJobHistory = async ({
  jobId,
  action,
  fromStatus,
  toStatus,
  performedBy,
  details = {},
  req,
}) => {
  await JobHistory.create({
    jobId,
    action,
    fromStatus,
    toStatus,
    performedBy,
    performedAt: new Date(),
    details,
    ipAddress: req?.ip || req?.headers["x-forwarded-for"] || null,
  });
};

// ============================================
// 1. CREATE JOB
// ============================================
export const createJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Only admins can create jobs");

  const {
    title,
    description,
    atmId,
    complaintId,
    customerId,
    workType,
    priority,
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

  const jobId = await generateJobId();

  const job = await Job.create({
    jobId,
    jobNumber: jobId,
    title,
    description,
    atmId,
    complaintId,
    customerId,
    workType: workType || "repair",
    priority: priority || "medium",
    status: JOB_STATUS.PENDING,
    createdBy: req.user._id,
  });

  await logJobHistory({
    jobId: job._id,
    action: "created",
    toStatus: JOB_STATUS.PENDING,
    performedBy: req.user._id,
    details: { title, atmId },
    req,
  });

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address districtId regionId")
    // .populate("complaintId", "complaintNumber title")
    .populate("createdBy", "firstName lastName");

  return res
    .status(201)
    .json(new ApiResponse(201, populatedJob, "Job created successfully"));
});

// ============================================
// 2. ASSIGN JOB
// ============================================
export const assignJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Only admins can assign jobs");

  const { id } = req.params;
  const { employeeId } = req.body;

  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  if (job.status !== JOB_STATUS.PENDING)
    throw new ApiError(400, `Cannot assign job with status: ${job.status}`);

  const employee = await User.findOne({
    _id: employeeId,
    userType: "employee",
    status: "active",
  });
  if (!employee) throw new ApiError(404, "Employee not found or inactive");

  const oldStatus = job.status;
  job.assignedEmployeeId = employeeId;
  job.assignedBy = req.user._id;
  job.status = JOB_STATUS.ASSIGNED;
  job.assignedAt = new Date();
  job.updatedBy = req.user._id;
  await job.save();

  await logJobHistory({
    jobId: job._id,
    action: "assigned",
    fromStatus: oldStatus,
    toStatus: JOB_STATUS.ASSIGNED,
    performedBy: req.user._id,
    details: { assignedTo: employeeId },
    req,
  });

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("assignedEmployeeId", "firstName lastName employeeCode")
    .populate("complaintId", "complaintNumber title");

  return res
    .status(200)
    .json(new ApiResponse(200, populatedJob, "Job assigned successfully"));
});

// ============================================
// 3. ACCEPT JOB
// ============================================
export const acceptJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  if (job.assignedEmployeeId?.toString() !== req.user._id.toString())
    throw new ApiError(403, "This job is not assigned to you");
  if (job.status !== JOB_STATUS.ASSIGNED)
    throw new ApiError(400, `Cannot accept job with status: ${job.status}`);

  const oldStatus = job.status;
  job.status = JOB_STATUS.ACCEPTED;
  job.acceptedAt = new Date();
  job.updatedBy = req.user._id;
  await job.save();

  await logJobHistory({
    jobId: job._id,
    action: "status_changed",
    fromStatus: oldStatus,
    toStatus: JOB_STATUS.ACCEPTED,
    performedBy: req.user._id,
    req,
  });

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("complaintId", "complaintNumber title");
  return res
    .status(200)
    .json(new ApiResponse(200, populatedJob, "Job accepted successfully"));
});

// ============================================
// 4. START JOB
// ============================================
export const startJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  if (job.assignedEmployeeId?.toString() !== req.user._id.toString())
    throw new ApiError(403, "This job is not assigned to you");

  const validStatuses = [JOB_STATUS.ACCEPTED, JOB_STATUS.ON_HOLD];
  if (!validStatuses.includes(job.status))
    throw new ApiError(400, `Cannot start job with status: ${job.status}`);

  const oldStatus = job.status;
  job.status = JOB_STATUS.IN_PROGRESS;
  job.startedAt = new Date();
  job.updatedBy = req.user._id;
  await job.save();

  await logJobHistory({
    jobId: job._id,
    action: "status_changed",
    fromStatus: oldStatus,
    toStatus: JOB_STATUS.IN_PROGRESS,
    performedBy: req.user._id,
    req,
  });

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("complaintId", "complaintNumber title");
  return res
    .status(200)
    .json(new ApiResponse(200, populatedJob, "Job started successfully"));
});

// ============================================
// 5. COMPLETE JOB (with GPS)
// ============================================
export const completeJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { gps, remarks } = req.body;

  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  if (job.assignedEmployeeId?.toString() !== req.user._id.toString())
    throw new ApiError(403, "This job is not assigned to you");
  if (job.status !== JOB_STATUS.IN_PROGRESS)
    throw new ApiError(400, `Cannot complete job with status: ${job.status}`);

  const atm = await ATM.findById(job.atmId);
  if (!atm) throw new ApiError(404, "ATM not found");

  const { latitude, longitude, accuracy } = gps;
  const { isValid, distance } = validateGpsProximity(
    latitude,
    longitude,
    atm.location.coordinates[1],
    atm.location.coordinates[0],
    20,
  );

  if (!isValid) {
    throw new ApiError(
      403,
      `You are ${distance} meters away from the ATM. Must be within 20 meters.`,
    );
  }

  const oldStatus = job.status;
  job.status = JOB_STATUS.COMPLETED;
  job.completedAt = new Date();
  job.employeeGpsAtCompletion = {
    latitude,
    longitude,
    accuracy: accuracy || null,
    timestamp: new Date(),
  };
  job.gpsDistance = distance;
  job.gpsValidated = true;
  job.employeeRemarks = remarks || "";
  job.updatedBy = req.user._id;
  await job.save();

  await logJobHistory({
    jobId: job._id,
    action: "gps_validated",
    fromStatus: oldStatus,
    toStatus: JOB_STATUS.COMPLETED,
    performedBy: req.user._id,
    details: {
      gpsDistance: distance,
      gpsAccuracy: accuracy,
      employeeLocation: { latitude, longitude },
      atmLocation: {
        latitude: atm.location.coordinates[1],
        longitude: atm.location.coordinates[0],
      },
    },
    req,
  });

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("assignedEmployeeId", "firstName lastName")
    .populate("complaintId", "complaintNumber title");

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        populatedJob,
        `Job completed. GPS validated: ${distance}m from ATM.`,
      ),
    );
});

// ============================================
// 6. VERIFY JOB
// ============================================
export const verifyJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Only admins can verify jobs");

  const { id } = req.params;
  const { action, remarks } = req.body;

  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  if (job.status !== JOB_STATUS.COMPLETED)
    throw new ApiError(400, `Cannot verify job with status: ${job.status}`);

  const oldStatus = job.status;

  if (action === "verify") {
    job.status = JOB_STATUS.VERIFIED;
    job.verifiedAt = new Date();
    job.adminRemarks = remarks || "";
    await logJobHistory({
      jobId: job._id,
      action: "verified",
      fromStatus: oldStatus,
      toStatus: JOB_STATUS.VERIFIED,
      performedBy: req.user._id,
      details: { adminRemarks: remarks },
      req,
    });
  } else {
    job.status = JOB_STATUS.REJECTED;
    job.rejectedAt = new Date();
    job.rejectionReason = remarks || "Rejected by admin";
    await logJobHistory({
      jobId: job._id,
      action: "rejected",
      fromStatus: oldStatus,
      toStatus: JOB_STATUS.REJECTED,
      performedBy: req.user._id,
      details: { rejectionReason: remarks },
      req,
    });
  }

  job.updatedBy = req.user._id;
  await job.save();

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("assignedEmployeeId", "firstName lastName")
    .populate("complaintId", "complaintNumber title");
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        populatedJob,
        action === "verify" ? "Job verified" : "Job rejected",
      ),
    );
});

// ============================================
// 7. APPROVE JOB
// ============================================
export const approveJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Only admins can approve jobs");

  const { id } = req.params;
  const { action, remarks } = req.body;

  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  if (job.status !== JOB_STATUS.VERIFIED)
    throw new ApiError(400, `Cannot approve job with status: ${job.status}`);

  const oldStatus = job.status;

  if (action === "approve") {
    job.status = JOB_STATUS.APPROVED;
    job.approvedAt = new Date();
    job.adminRemarks = remarks || job.adminRemarks;
    await logJobHistory({
      jobId: job._id,
      action: "approved",
      fromStatus: oldStatus,
      toStatus: JOB_STATUS.APPROVED,
      performedBy: req.user._id,
      details: { adminRemarks: remarks },
      req,
    });
  } else {
    job.status = JOB_STATUS.REJECTED;
    job.rejectedAt = new Date();
    job.rejectionReason = remarks || "Rejected by admin";
    await logJobHistory({
      jobId: job._id,
      action: "rejected",
      fromStatus: oldStatus,
      toStatus: JOB_STATUS.REJECTED,
      performedBy: req.user._id,
      details: { rejectionReason: remarks },
      req,
    });
  }

  job.updatedBy = req.user._id;
  await job.save();

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("assignedEmployeeId", "firstName lastName")
    .populate("complaintId", "complaintNumber title");
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        populatedJob,
        action === "approve" ? "Job approved" : "Job rejected",
      ),
    );
});

// ============================================
// 8. CLOSE JOB
// ============================================
export const closeJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Only admins can close jobs");

  const { id } = req.params;
  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");

  const closableStatuses = [
    JOB_STATUS.APPROVED,
    JOB_STATUS.REJECTED,
    JOB_STATUS.PENDING,
  ];
  if (!closableStatuses.includes(job.status))
    throw new ApiError(400, `Cannot close job with status: ${job.status}`);

  const oldStatus = job.status;
  job.status = JOB_STATUS.CLOSED;
  job.closedAt = new Date();
  job.updatedBy = req.user._id;
  await job.save();

  await logJobHistory({
    jobId: job._id,
    action: "closed",
    fromStatus: oldStatus,
    toStatus: JOB_STATUS.CLOSED,
    performedBy: req.user._id,
    req,
  });
  return res
    .status(200)
    .json(new ApiResponse(200, job, "Job closed successfully"));
});

// ============================================
// 9. REASSIGN JOB
// ============================================
export const reassignJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Only admins can reassign jobs");

  const { id } = req.params;
  const { employeeId, reason } = req.body;

  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  if (job.status === JOB_STATUS.CLOSED)
    throw new ApiError(400, "Cannot reassign a closed job");

  const newEmployee = await User.findOne({
    _id: employeeId,
    userType: "employee",
    status: "active",
  });
  if (!newEmployee)
    throw new ApiError(404, "New employee not found or inactive");
  if (job.assignedEmployeeId?.toString() === employeeId)
    throw new ApiError(400, "Job already assigned to this employee");

  const oldEmployeeId = job.assignedEmployeeId;
  const oldStatus = job.status;

  job.reassignmentHistory.push({
    fromEmployee: oldEmployeeId,
    toEmployee: employeeId,
    reason,
    reassignedAt: new Date(),
    reassignedBy: req.user._id,
  });

  job.isReassigned = true;
  job.assignedEmployeeId = employeeId;
  job.assignedBy = req.user._id;
  job.reassignmentReason = reason;
  job.status = JOB_STATUS.ASSIGNED;
  job.assignedAt = new Date();
  job.updatedBy = req.user._id;
  await job.save();

  await logJobHistory({
    jobId: job._id,
    action: "reassigned",
    fromStatus: oldStatus,
    toStatus: JOB_STATUS.ASSIGNED,
    performedBy: req.user._id,
    details: { fromEmployee: oldEmployeeId, toEmployee: employeeId, reason },
    req,
  });

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("assignedEmployeeId", "firstName lastName employeeCode")
    .populate("complaintId", "complaintNumber title");

  return res
    .status(200)
    .json(new ApiResponse(200, populatedJob, "Job reassigned successfully"));
});

// ============================================
// 10. GET ALL JOBS (filtered, paginated)
// ============================================
export const getAllJobs = asyncHandler(async (req, res) => {
  const {
    status,
    priority,
    workType,
    employeeId,
    atmId,
    customerId,
    bank,
    fromDate,
    toDate,
    page = 1,
    limit = 10,
    search,
  } = req.query;
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);

  const query = { isDeleted: false };

  if (!isAdmin) {
    if (req.user.userType === "employee")
      query.assignedEmployeeId = req.user._id;
    else if (req.user.userType === "customer") {
      query.customerId = req.user._id;
      query.status = {
        $in: [JOB_STATUS.VERIFIED, JOB_STATUS.APPROVED, JOB_STATUS.CLOSED],
      };
    }
  }

  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (workType) query.workType = workType;
  if (employeeId && isAdmin) query.assignedEmployeeId = employeeId;
  if (atmId) query.atmId = atmId;
  if (customerId && isAdmin) query.customerId = customerId;

  if (fromDate || toDate) {
    query.createdAt = {};
    if (fromDate) query.createdAt.$gte = new Date(fromDate);
    if (toDate) query.createdAt.$lte = new Date(toDate);
  }

  if (search) {
    query.$or = [
      { jobId: { $regex: search, $options: "i" } },
      { title: { $regex: search, $options: "i" } },
    ];
  }

  if (bank && isAdmin) {
    const atms = await ATM.find({
      bank: { $regex: bank, $options: "i" },
    }).select("_id");
    const atmIds = atms.map((a) => a._id.toString());
    query.atmId = { $in: atmIds };
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const jobs = await Job.find(query)
    .populate("atmId", "atmId locationName bank address districtId regionId")
    .populate("assignedEmployeeId", "firstName lastName employeeCode")
    // .populate("complaintId", "complaintNumber title")
    .populate("customerId", "firstName lastName")
    .populate("createdBy", "firstName lastName")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Job.countDocuments(query);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        jobs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
      "Jobs fetched successfully",
    ),
  );
});

// ============================================
// 11. GET JOB BY ID
// ============================================
export const getJobById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const job = await Job.findById(id)
    .populate(
      "atmId",
      "atmId locationName bank address districtId regionId location",
    )
    .populate(
      "assignedEmployeeId",
      "firstName lastName employeeCode phoneNumber",
    )
    .populate("complaintId", "complaintNumber title description")
    .populate("customerId", "firstName lastName")
    .populate("createdBy", "firstName lastName")
    .populate("updatedBy", "firstName lastName")
    .populate("beforePhotos", "url thumbnailUrl photoType uploadedAt")
    .populate("afterPhotos", "url thumbnailUrl photoType uploadedAt");

  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");

  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isAssigned =
    job.assignedEmployeeId?._id?.toString() === req.user._id.toString();
  const isCustomer = req.user.userType === "customer";

  if (isCustomer) {
    if (job.customerId?._id?.toString() !== req.user._id.toString())
      throw new ApiError(403, "Access denied");
    if (
      ![JOB_STATUS.VERIFIED, JOB_STATUS.APPROVED, JOB_STATUS.CLOSED].includes(
        job.status,
      )
    )
      throw new ApiError(403, "Job not yet approved");
  } else if (!isAdmin && !isAssigned) {
    throw new ApiError(403, "Access denied");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, job, "Job fetched successfully"));
});

// ============================================
// 12. GET MY JOBS (Employee)
// ============================================
export const getMyJobs = asyncHandler(async (req, res) => {
  if (req.user.userType !== "employee")
    throw new ApiError(403, "Only employees");

  const { status, page = 1, limit = 10 } = req.query;
  const query = { assignedEmployeeId: req.user._id, isDeleted: false };
  if (status) query.status = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const jobs = await Job.find(query)
    .populate("atmId", "atmId locationName bank address districtId regionId")
    .populate("complaintId", "complaintNumber title")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Job.countDocuments(query);

  const statusCounts = await Job.aggregate([
    { $match: { assignedEmployeeId: req.user._id, isDeleted: false } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        jobs,
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
      "My jobs fetched successfully",
    ),
  );
});

// ============================================
// 13. GET JOB HISTORY
// ============================================
export const getJobHistory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");

  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isAssigned =
    job.assignedEmployeeId?.toString() === req.user._id.toString();
  const isCustomer = req.user.userType === "customer";

  if (isCustomer && job.customerId?.toString() !== req.user._id.toString())
    throw new ApiError(403, "Access denied");
  else if (!isAdmin && !isAssigned && !isCustomer)
    throw new ApiError(403, "Access denied");

  const history = await JobHistory.find({ jobId: id })
    .populate("performedBy", "firstName lastName userType")
    .sort({ performedAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, history, "Job history fetched"));
});

// ============================================
// 14. UPDATE JOB
// ============================================
export const updateJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Only admins");

  const { id } = req.params;
  const { title, description, priority, workType } = req.body;

  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  if (job.status === JOB_STATUS.CLOSED)
    throw new ApiError(400, "Cannot update closed job");

  if (title) job.title = title;
  if (description !== undefined) job.description = description;
  if (priority) job.priority = priority;
  if (workType) job.workType = workType;
  job.updatedBy = req.user._id;
  await job.save();

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("assignedEmployeeId", "firstName lastName")
    .populate("complaintId", "complaintNumber title");

  return res
    .status(200)
    .json(new ApiResponse(200, populatedJob, "Job updated"));
});

// ============================================
// 15. DELETE JOB (soft)
// ============================================
export const deleteJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Only admins");

  const { id } = req.params;
  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");

  await deleteJobPhotos(id);

  job.isDeleted = true;
  job.deletedAt = new Date();
  job.deletedBy = req.user._id;
  await job.save();

  await logJobHistory({
    jobId: job._id,
    action: "closed",
    fromStatus: job.status,
    toStatus: "DELETED",
    performedBy: req.user._id,
    details: { deleted: true },
    req,
  });
  return res.status(200).json(new ApiResponse(200, null, "Job deleted"));
});

// ============================================
// 16. HOLD JOB
// ============================================
export const holdJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  if (job.assignedEmployeeId?.toString() !== req.user._id.toString())
    throw new ApiError(403, "Not your job");

  const validStatuses = [JOB_STATUS.ACCEPTED, JOB_STATUS.IN_PROGRESS];
  if (!validStatuses.includes(job.status))
    throw new ApiError(400, `Cannot hold job with status: ${job.status}`);

  const oldStatus = job.status;
  job.status = JOB_STATUS.ON_HOLD;
  job.employeeRemarks = reason || job.employeeRemarks;
  job.updatedBy = req.user._id;
  await job.save();

  await logJobHistory({
    jobId: job._id,
    action: "status_changed",
    fromStatus: oldStatus,
    toStatus: JOB_STATUS.ON_HOLD,
    performedBy: req.user._id,
    details: { holdReason: reason },
    req,
  });
  return res.status(200).json(new ApiResponse(200, job, "Job put on hold"));
});
