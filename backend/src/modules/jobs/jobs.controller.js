import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import {
  CUSTOMER_VISIBLE_JOB_STATUSES,
  getActiveCustomerForUser,
  isCustomerVisibleJob,
  sameCustomerId,
  toCustomerSafeHistory,
  toCustomerSafeJob,
} from "../customers/customerAccess.js";
import Employee from "../employees/employee.model.js";
import Job from "./jobs.model.js";
import { LEGACY_JOB_WORK_TYPES } from "./jobWorkTypes.js";
import JobHistory from "./jobHistory.model.js";
import JobPhoto from "../jobPhotos/jobPhotos.model.js";
import ATM from "../atms/atm.model.js";
import User from "../users/user.model.js";
import Bank from "../banks/bank.model.js";
import { validateGpsProximity } from "../../utils/haversine.js";
import { JOB_STATUS, VALID_STATUS_TRANSITIONS } from "../../utils/jobStatus.js";
import { deleteJobPhotos } from "../../config/cloudinaryCleanup.js";
import { escapeRegex } from "../../utils/geographicQuery.js";
import { findActiveEmployeeByUserId } from "../employees/employeeAssignment.service.js";
import {
  closeJobAndComplaint,
  cancelJobAndPreserveComplaintHistory,
  createJobWithComplaint,
  softDeleteJobAndUnlinkComplaint,
} from "../complaints/complaintJobIntegrity.service.js";
import { myJobPerformanceQuerySchema } from "./jobs.validation.js";
import { getJobPerformanceForUser } from "./jobPerformance.service.js";
import {
  publishDomainEventSafely,
} from "../../realtime/domain-events.js";
import { resolveJobRecipients } from "../../realtime/recipient-resolver.js";

// ============================================
// HELPERS
// ============================================
const REQUIRED_PHOTOS_PER_TYPE = 3;

const publishJobUpdated = ({ job, action, previousEmployeeId } = {}) =>
  publishDomainEventSafely({
    event: "domain:job:updated",
    entityType: "job",
    entityId: job._id,
    action,
    resolveRecipients: () =>
      resolveJobRecipients(job, { previousEmployeeId }),
  });

const assertCleaningEvidence = async (job) => {
  const [beforeCount, afterCount] = await Promise.all([
    JobPhoto.countDocuments({
      _id: { $in: job.beforePhotos || [] },
      jobId: job._id,
      photoType: "before",
      isExpired: false,
      url: { $type: "string", $ne: "" },
    }),
    JobPhoto.countDocuments({
      _id: { $in: job.afterPhotos || [] },
      jobId: job._id,
      photoType: "after",
      isExpired: false,
      url: { $type: "string", $ne: "" },
    }),
  ]);

  const missingEvidence = [];
  if (beforeCount < REQUIRED_PHOTOS_PER_TYPE) {
    missingEvidence.push(
      `At least ${REQUIRED_PHOTOS_PER_TYPE} before photos are required`,
    );
  }
  if (afterCount < REQUIRED_PHOTOS_PER_TYPE) {
    missingEvidence.push(
      `At least ${REQUIRED_PHOTOS_PER_TYPE} after photos are required`,
    );
  }
  if (missingEvidence.length > 0) {
    throw new ApiError(400, missingEvidence.join(". "));
  }
};

const getPreviousAttemptDetails = (job) => ({
  completedAt: job.completedAt,
  verifiedAt: job.verifiedAt,
  approvedAt: job.approvedAt,
  employeeGpsAtCompletion: job.employeeGpsAtCompletion,
  gpsDistance: job.gpsDistance,
  gpsValidated: job.gpsValidated,
  employeeRemarks: job.employeeRemarks,
  adminRemarks: job.adminRemarks,
  beforePhotoIds: (job.beforePhotos || []).map(String),
  afterPhotoIds: (job.afterPhotos || []).map(String),
});

const clearCurrentAttempt = (job) => {
  job.acceptedAt = undefined;
  job.startedAt = undefined;
  job.completedAt = undefined;
  job.verifiedAt = undefined;
  job.approvedAt = undefined;
  job.employeeGpsAtCompletion = undefined;
  job.gpsDistance = undefined;
  job.gpsValidated = false;
  job.employeeRemarks = "";
  job.adminRemarks = "";
  job.beforePhotos = [];
  job.afterPhotos = [];
};

const findEmployeeEligibleForJob = async (job, employeeUserId) => {
  const employee = await findActiveEmployeeByUserId(employeeUserId);
  const atm = await ATM.findById(job.atmId);
  if (!atm || atm.isDeleted) throw new ApiError(404, "ATM not found");

  const employeeId = employee._id.toString().toLowerCase();
  const isAssignedToATM = (atm.assignedEmployeeId ?? []).some((assignment) => {
    const assignedEmployeeId = assignment?._id ?? assignment;
    return (
      assignedEmployeeId != null &&
      assignedEmployeeId.toString().toLowerCase() === employeeId
    );
  });
  if (!isAssignedToATM) {
    throw new ApiError(
      400,
      "Employee must be assigned to the Job's ATM",
    );
  }

  return employee;
};

const assertEmployeeWorkEligible = (employeeUserId) =>
  findActiveEmployeeByUserId(employeeUserId);

const rejectSubmissionForRework = async ({ job, req, remarks }) => {
  const rejectedFromStatus = job.status;
  const rejectionReason = remarks || "Rejected by admin";
  const rejectedAt = new Date();
  const previousAttempt = getPreviousAttemptDetails(job);

  let assignedEmployeeEligible = false;
  if (job.assignedEmployeeId) {
    try {
      await findActiveEmployeeByUserId(job.assignedEmployeeId);
      assignedEmployeeEligible = true;
    } catch (error) {
      if (![400, 404].includes(error.statusCode)) throw error;
    }
  }

  job.status = JOB_STATUS.REJECTED;
  job.rejectedAt = rejectedAt;
  job.rejectionReason = rejectionReason;
  clearCurrentAttempt(job);

  await logJobHistory({
    jobId: job._id,
    action: "rejected",
    fromStatus: rejectedFromStatus,
    toStatus: JOB_STATUS.REJECTED,
    performedBy: req.user._id,
    details: { rejectionReason, previousAttempt },
    req,
  });

  if (assignedEmployeeEligible) {
    job.status = JOB_STATUS.ASSIGNED;
    const assignedAt = new Date();
    job.assignedAt = assignedAt;
    job.assignedBy = req.user._id;
    await logJobHistory({
      jobId: job._id,
      action: "status_changed",
      fromStatus: JOB_STATUS.REJECTED,
      toStatus: JOB_STATUS.ASSIGNED,
      performedBy: req.user._id,
      details: {
        reason: "Returned to the assigned employee for rework",
        rejectionReason,
        assignedTo: job.assignedEmployeeId,
        assignedAt,
      },
      req,
    });
  }

  job.updatedBy = req.user._id;
  await job.save();
  return assignedEmployeeEligible;
};

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

const addEmployeeCodes = async (job) => {
  const jobData = job.toObject();
  const history = Array.isArray(jobData.reassignmentHistory)
    ? jobData.reassignmentHistory
    : [];
  jobData.reassignmentHistory = history;
  jobData.beforePhotos = Array.isArray(jobData.beforePhotos)
    ? jobData.beforePhotos
    : [];
  jobData.afterPhotos = Array.isArray(jobData.afterPhotos)
    ? jobData.afterPhotos
    : [];
  const employeeUsers = [
    jobData.assignedEmployeeId,
    ...history.flatMap((item) => [item.fromEmployee, item.toEmployee]),
  ].filter(
    (user) =>
      user &&
      typeof user === "object" &&
      user._id &&
      (user.firstName || user.lastName),
  );
  const userIds = [
    ...new Set(employeeUsers.map((user) => user._id.toString())),
  ];

  if (userIds.length === 0) return jobData;

  const employeeRecords = await Employee.find({
    userId: { $in: userIds },
  })
    .select("userId employeeCode")
    .lean();
  const employeeCodes = new Map(
    employeeRecords.map((employee) => [
      employee.userId.toString(),
      employee.employeeCode,
    ]),
  );
  const attachCode = (user) => {
    if (!user || typeof user !== "object" || !user._id) return user;

    return {
      ...user,
      employeeCode: employeeCodes.get(user._id.toString()) ?? null,
    };
  };

  jobData.assignedEmployeeId = attachCode(jobData.assignedEmployeeId);
  jobData.reassignmentHistory = history.map((item) => ({
    ...item,
    fromEmployee: attachCode(item.fromEmployee),
    toEmployee: attachCode(item.toEmployee),
  }));

  return jobData;
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
    acSubType,
    priority,
  } = req.body;

  const atm = await ATM.findById(atmId);
  if (!atm || atm.isDeleted) throw new ApiError(404, "ATM not found");
  const atmCustomerId = atm.customer?._id ?? atm.customer;
  if (customerId) {
    if (!sameCustomerId(customerId, atmCustomerId)) {
      throw new ApiError(400, "Customer must match the ATM's assigned customer");
    }
  }

  const jobId = await generateJobId();

  const jobData = {
    jobId,
    jobNumber: jobId,
    title,
    description,
    atmId,
    complaintId,
    customerId: atmCustomerId,
    workType: workType || "repair",
    ...(acSubType ? { acSubType } : {}),
    priority: priority || "medium",
    status: JOB_STATUS.PENDING,
    createdBy: req.user._id,
  };
  const job = complaintId
    ? await createJobWithComplaint({
        jobData,
        updatedBy: req.user._id,
      })
    : await Job.create(jobData);

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

  await publishJobUpdated({ job: populatedJob, action: "created" });

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

  await findEmployeeEligibleForJob(job, employeeId);

  const oldStatus = job.status;
  const assignedAt = new Date();
  job.assignedEmployeeId = employeeId;
  job.assignedBy = req.user._id;
  job.status = JOB_STATUS.ASSIGNED;
  job.assignedAt = assignedAt;
  job.updatedBy = req.user._id;
  await job.save();

  await logJobHistory({
    jobId: job._id,
    action: "assigned",
    fromStatus: oldStatus,
    toStatus: JOB_STATUS.ASSIGNED,
    performedBy: req.user._id,
    details: { assignedTo: employeeId, assignedAt },
    req,
  });

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("assignedEmployeeId", "firstName lastName employeeCode")
    .populate("complaintId", "complaintNumber title");

  await publishJobUpdated({ job: populatedJob, action: "assigned" });

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

  await assertEmployeeWorkEligible(req.user._id);

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
  await publishJobUpdated({ job: populatedJob, action: "accepted" });
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

  await assertEmployeeWorkEligible(req.user._id);

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
  await publishJobUpdated({ job: populatedJob, action: "started" });
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

  await assertEmployeeWorkEligible(req.user._id);

  await assertCleaningEvidence(job);

  const atm = await ATM.findById(job.atmId);
  if (!atm) throw new ApiError(404, "ATM not found");

  if (!atm.locationConfigured || !atm.location?.coordinates) {
    throw new ApiError(
      400,
      "ATM location is not configured. Please configure the ATM location before completing this job.",
    );
  }
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
  const completedAt = new Date();
  job.completedAt = completedAt;
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
      completedAt,
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

  await publishJobUpdated({ job: populatedJob, action: "completed" });

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
  let returnedForRework = false;

  if (action === "verify") {
    await assertCleaningEvidence(job);
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
    returnedForRework = await rejectSubmissionForRework({
      job,
      req,
      remarks,
    });
  }

  if (action === "verify") {
    job.updatedBy = req.user._id;
    await job.save();
  }

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("assignedEmployeeId", "firstName lastName")
    .populate("complaintId", "complaintNumber title");
  await publishJobUpdated({
    job: populatedJob,
    action: action === "verify" ? "verified" : "rejected",
  });
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        populatedJob,
        action === "verify"
          ? "Job verified"
          : returnedForRework
            ? "Job rejected and returned to the assigned employee for rework"
            : "Job rejected; Admin reassignment is required",
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
  let returnedForRework = false;

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
    returnedForRework = await rejectSubmissionForRework({
      job,
      req,
      remarks,
    });
  }

  if (action === "approve") {
    job.updatedBy = req.user._id;
    await job.save();
  }

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("assignedEmployeeId", "firstName lastName")
    .populate("complaintId", "complaintNumber title");
  await publishJobUpdated({
    job: populatedJob,
    action: action === "approve" ? "approved" : "rejected",
  });
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        populatedJob,
        action === "approve"
          ? "Job approved"
          : returnedForRework
            ? "Job rejected and returned to the assigned employee for rework"
            : "Job rejected; Admin reassignment is required",
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
  const job = await closeJobAndComplaint({
    jobId: id,
    closedBy: req.user._id,
  });

  await logJobHistory({
    jobId: job._id,
    action: "closed",
    fromStatus: JOB_STATUS.APPROVED,
    toStatus: JOB_STATUS.CLOSED,
    performedBy: req.user._id,
    req,
  });
  await publishJobUpdated({ job, action: "closed" });
  return res
    .status(200)
    .json(new ApiResponse(200, job, "Job closed successfully"));
});

export const cancelJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Only admins can cancel jobs");

  const job = await cancelJobAndPreserveComplaintHistory({
    jobId: req.params.id,
    cancelledBy: req.user._id,
    reason: req.body.reason,
    req,
  });

  await publishJobUpdated({ job, action: "cancelled" });

  return res
    .status(200)
    .json(new ApiResponse(200, job, "Job cancelled successfully"));
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
  const reassignableStatuses = [
    JOB_STATUS.PENDING,
    JOB_STATUS.ASSIGNED,
    JOB_STATUS.ACCEPTED,
    JOB_STATUS.IN_PROGRESS,
    JOB_STATUS.ON_HOLD,
    JOB_STATUS.REJECTED,
  ];
  if (!reassignableStatuses.includes(job.status)) {
    throw new ApiError(400, `Cannot reassign job with status: ${job.status}`);
  }

  await findEmployeeEligibleForJob(job, employeeId);
  if (
    job.status !== JOB_STATUS.REJECTED &&
    job.assignedEmployeeId?.toString() === employeeId
  )
    throw new ApiError(400, "Job already assigned to this employee");

  const oldEmployeeId = job.assignedEmployeeId;
  const oldStatus = job.status;
  const assignedAt = new Date();
  const previousAttempt =
    oldStatus === JOB_STATUS.REJECTED
      ? getPreviousAttemptDetails(job)
      : undefined;
  if (oldStatus === JOB_STATUS.REJECTED) clearCurrentAttempt(job);

  job.reassignmentHistory.push({
    fromEmployee: oldEmployeeId,
    toEmployee: employeeId,
    reason,
    reassignedAt: assignedAt,
    reassignedBy: req.user._id,
  });

  job.isReassigned = true;
  job.assignedEmployeeId = employeeId;
  job.assignedBy = req.user._id;
  job.reassignmentReason = reason;
  job.status = JOB_STATUS.ASSIGNED;
  job.assignedAt = assignedAt;
  job.updatedBy = req.user._id;
  await job.save();

  await logJobHistory({
    jobId: job._id,
    action: "reassigned",
    fromStatus: oldStatus,
    toStatus: JOB_STATUS.ASSIGNED,
    performedBy: req.user._id,
    details: {
      fromEmployee: oldEmployeeId,
      toEmployee: employeeId,
      reason,
      assignedAt,
      ...(previousAttempt ? { previousAttempt } : {}),
    },
    req,
  });

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("assignedEmployeeId", "firstName lastName employeeCode")
    .populate("complaintId", "complaintNumber title");

  await publishJobUpdated({
    job: populatedJob,
    action: "reassigned",
    previousEmployeeId: oldEmployeeId,
  });

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
    bankId,
    districtId,
    regionId,
    fromDate,
    toDate,
    page = 1,
    limit = 10,
    search,
  } = req.query;
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isCustomer = req.user.userType === "customer";
  const customer = isCustomer
    ? await getActiveCustomerForUser(req.user)
    : null;
  if (
    isCustomer &&
    status !== undefined &&
    !CUSTOMER_VISIBLE_JOB_STATUSES.includes(status)
  ) {
    throw new ApiError(400, "Invalid customer-visible job status");
  }

  if (bankId && !isAdmin) {
    throw new ApiError(403, "Only admins can filter jobs by bank");
  }
  for (const [field, value] of Object.entries({
    bankId,
    districtId,
    regionId,
  })) {
    if (
      value !== undefined &&
      value !== "" &&
      (typeof value !== "string" || !/^[0-9a-fA-F]{24}$/.test(value))
    ) {
      throw new ApiError(400, `Invalid ${field}`);
    }
  }

  const query = { isDeleted: false };

  if (!isAdmin) {
    if (req.user.userType === "employee")
      query.assignedEmployeeId = req.user._id;
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

  const atmConditions = [];
  if (bankId) atmConditions.push({ bankId });
  if (districtId) atmConditions.push({ districtId });
  if (regionId) atmConditions.push({ regionId });

  if (bank && isAdmin) {
    const matchingBanks = await Bank.find({
      $or: [
        { bankName: { $regex: escapeRegex(bank), $options: "i" } },
        { bankCode: { $regex: escapeRegex(bank), $options: "i" } },
      ],
    }).select("_id");

    atmConditions.push({
      bankId: { $in: matchingBanks.map((matchingBank) => matchingBank._id) },
    });
  }

  let matchingATMIds;
  if (atmConditions.length > 0) {
    matchingATMIds = await ATM.distinct("_id", {
      $and: [{ isDeleted: false }, ...atmConditions],
    });
    query.atmId = atmId
      ? matchingATMIds.some((id) => id.toString() === atmId)
        ? atmId
        : { $in: [] }
      : { $in: matchingATMIds };
  } else if (atmId) {
    query.atmId = atmId;
  }

  if (search) {
    query.$or = [
      { jobId: { $regex: search, $options: "i" } },
      { title: { $regex: search, $options: "i" } },
    ];
  }

  if (isCustomer) {
    query.customerId = customer._id;
    query.status = status || { $in: CUSTOMER_VISIBLE_JOB_STATUSES };
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const jobs = await Job.find(query)
    .populate("atmId", "atmId locationName bank address districtId regionId")
    .populate("assignedEmployeeId", "firstName lastName employeeCode")
    // .populate("complaintId", "complaintNumber title")
    .populate("createdBy", "firstName lastName")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Job.countDocuments(query);

  let statusCounts;
  if ((bankId || districtId || regionId) && !isCustomer) {
    const groupedCounts = await Job.aggregate([
      { $match: { isDeleted: false, atmId: { $in: matchingATMIds ?? [] } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);
    statusCounts = Object.fromEntries(
      Object.values(JOB_STATUS).map((jobStatus) => [
        jobStatus,
        groupedCounts.find((count) => count._id === jobStatus)?.count ?? 0,
      ]),
    );
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        jobs: isCustomer ? jobs.map(toCustomerSafeJob) : jobs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
        ...(statusCounts ? { statusCounts } : {}),
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
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new ApiError(404, "Job not found");
  }

  const isCustomer = req.user.userType === "customer";
  const customer = isCustomer
    ? await getActiveCustomerForUser(req.user)
    : null;
  const jobQuery = isCustomer
    ? Job.findOne({
        _id: id,
        customerId: customer._id,
        status: {
          $in: CUSTOMER_VISIBLE_JOB_STATUSES,
        },
        isDeleted: false,
      })
    : Job.findById(id);

  const job = await jobQuery
    .populate(
      "atmId",
      "atmId locationName bank address districtId regionId location locationConfigured locationRequestWindowOpen",
    )
    .populate("assignedEmployeeId", "firstName lastName phoneNumber")
    .populate("reassignmentHistory.fromEmployee", "firstName lastName")
    .populate("reassignmentHistory.toEmployee", "firstName lastName")
    .populate("reassignmentHistory.reassignedBy", "firstName lastName")
    .populate(
      "complaintId",
      "complaintNumber title description reportedBy reportedVia priority status reportedAt",
    )
    .populate("customerId", "customerName customerEmail customerPhone bankName")
    .populate("createdBy", "firstName lastName")
    .populate("assignedBy", "firstName lastName")
    .populate("updatedBy", "firstName lastName")
    .populate("cancelledBy", "firstName lastName")
    .populate("beforePhotos", "url thumbnailUrl photoType uploadedAt")
    .populate("afterPhotos", "url thumbnailUrl photoType uploadedAt");

  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");

  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isAssigned =
    job.assignedEmployeeId?._id?.toString() === req.user._id.toString();
  if (!isCustomer && !isAdmin && !isAssigned) {
    throw new ApiError(403, "Access denied");
  }

  if (isCustomer) {
    return res
      .status(200)
      .json(
        new ApiResponse(200, toCustomerSafeJob(job), "Job fetched successfully"),
      );
  }

  const responseJob = await addEmployeeCodes(job);

  return res
    .status(200)
    .json(new ApiResponse(200, responseJob, "Job fetched successfully"));
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

// Completion counts are gps_validated submission events, including repeated rework submissions.
// The response contains currentAssignedJobs, completion, and current-attempt duration fields.
export const getMyJobPerformance = asyncHandler(async (req, res) => {
  if (req.user.userType !== "employee") {
    throw new ApiError(403, "Only employees can access their job performance");
  }

  const parsedQuery = myJobPerformanceQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    throw new ApiError(
      400,
      "Invalid job performance query",
      parsedQuery.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const query = {
    period: "month",
    ...parsedQuery.data,
  };
  const performance = await getJobPerformanceForUser(req.user._id, query);

  return res.status(200).json(
    new ApiResponse(
      200,
      performance,
      "My job performance fetched successfully",
    ),
  );
});

// ============================================
// 13. GET JOB HISTORY
// ============================================
export const getJobHistory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isCustomer = req.user.userType === "customer";
  const job = await Job.findById(id);
  if (!job || job.isDeleted) {
    throw new ApiError(
      404,
      isCustomer ? "Job history not found" : "Job not found",
    );
  }

  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  const isAssigned =
    job.assignedEmployeeId?.toString() === req.user._id.toString();

  if (isCustomer) {
    const customer = await getActiveCustomerForUser(req.user);
    if (
      !sameCustomerId(job.customerId, customer._id) ||
      !isCustomerVisibleJob(job)
    ) {
      throw new ApiError(404, "Job history not found");
    }
  } else if (!isAdmin && !isAssigned) {
    throw new ApiError(403, "Access denied");
  }

  let historyQuery = JobHistory.find({ jobId: id });
  if (isCustomer) {
    historyQuery = historyQuery.select(
      "_id action fromStatus toStatus performedAt",
    );
  } else {
    historyQuery = historyQuery.populate(
      "performedBy",
      "firstName lastName userType",
    );
  }
  const history = await historyQuery.sort({ performedAt: -1 });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        isCustomer ? history.map(toCustomerSafeHistory) : history,
        "Job history fetched",
      ),
    );
});

// ============================================
// 14. UPDATE JOB
// ============================================
export const updateJob = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Only admins");

  const { id } = req.params;
  const { title, description, priority, workType, acSubType } = req.body;

  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  if (job.status === JOB_STATUS.CLOSED)
    throw new ApiError(400, "Cannot update closed job");

  if (title) job.title = title;
  if (description !== undefined) job.description = description;
  if (priority) job.priority = priority;
  if (workType !== undefined) {
    if (
      LEGACY_JOB_WORK_TYPES.includes(workType) &&
      workType !== job.workType
    ) {
      throw new ApiError(400, "Legacy work types cannot be assigned to jobs");
    }
    job.workType = workType;
    job.acSubType = workType === "ac" ? acSubType : undefined;
  } else if (acSubType !== undefined) {
    if (job.workType !== "ac") {
      throw new ApiError(400, "AC sub-type is only valid for AC work");
    }
    job.acSubType = acSubType;
  }
  job.updatedBy = req.user._id;
  await job.save();

  const populatedJob = await Job.findById(job._id)
    .populate("atmId", "atmId locationName bank address")
    .populate("assignedEmployeeId", "firstName lastName")
    .populate("complaintId", "complaintNumber title");

  await publishJobUpdated({ job: populatedJob, action: "updated" });

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
  const job = await softDeleteJobAndUnlinkComplaint({
    jobId: id,
    deletedBy: req.user._id,
  });

  await deleteJobPhotos(id);

  await logJobHistory({
    jobId: job._id,
    action: "closed",
    fromStatus: job.status,
    toStatus: "DELETED",
    performedBy: req.user._id,
    details: { deleted: true },
    req,
  });
  await publishJobUpdated({ job, action: "deleted" });
  return res.status(200).json(new ApiResponse(200, null, "Job deleted"));
});

// ============================================
// 16. HOLD JOB
// ============================================
export const holdJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);

  const job = await Job.findById(id);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  if (
    !isAdmin &&
    job.assignedEmployeeId?.toString() !== req.user._id.toString()
  )
    throw new ApiError(403, "Not your job");

  if (job.status !== JOB_STATUS.IN_PROGRESS)
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
  await publishJobUpdated({ job, action: "held" });
  return res.status(200).json(new ApiResponse(200, job, "Job put on hold"));
});
