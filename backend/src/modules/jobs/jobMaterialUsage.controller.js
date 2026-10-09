import mongoose from "mongoose";
import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import Item from "../items/item.model.js";
import Job from "./jobs.model.js";
import JobMaterialUsage from "./jobMaterialUsage.model.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";

// Store calculated currency totals rounded to the nearest cent.
const COST_DECIMAL_PLACES = 2;
const COST_SCALE = 10 ** COST_DECIMAL_PLACES;

const roundCost = (amount) =>
  Math.round((amount + Number.EPSILON) * COST_SCALE) / COST_SCALE;

const withSession = (query, session) =>
  session && typeof query.session === "function"
    ? query.session(session)
    : query;

const getJobStateError = (job, userId) => {
  if (!job || job.isDeleted) return new ApiError(404, "Job not found");
  if (job.assignedEmployeeId?.toString() !== userId.toString()) {
    return new ApiError(403, "This job is not assigned to you");
  }
  if (job.status !== JOB_STATUS.IN_PROGRESS) {
    return new ApiError(
      400,
      `Cannot add material usage while Job status is ${job.status}`,
    );
  }
  return null;
};

const findJob = async (jobId, session) => {
  if (!mongoose.isValidObjectId(jobId)) {
    throw new ApiError(400, "Invalid Job ID");
  }

  const job = await withSession(Job.findById(jobId), session);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  return job;
};

export const createJobMaterialUsage = asyncHandler(async (req, res) => {
  const { id: jobId } = req.params;
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin && req.user.userType !== "employee") {
    throw new ApiError(403, "Access denied");
  }
  if (!mongoose.isValidObjectId(jobId)) {
    throw new ApiError(400, "Invalid Job ID");
  }
  if (!mongoose.isValidObjectId(req.body.itemId)) {
    throw new ApiError(400, "Invalid Item ID");
  }
  if (!isAdmin && req.body.correctionReason !== undefined) {
    throw new ApiError(403, "Only admins can record a material correction reason");
  }

  const correctionReason =
    typeof req.body.correctionReason === "string"
      ? req.body.correctionReason.trim()
      : "";

  const session = await mongoose.startSession();
  let usage;
  try {
    await session.withTransaction(async () => {
      let jobFilter;
      let statusAtRequest;
      if (isAdmin) {
        const job = await findJob(jobId, session);
        statusAtRequest = job.status;
        if (
          [JOB_STATUS.CLOSED, JOB_STATUS.CANCELLED].includes(statusAtRequest) &&
          !correctionReason
        ) {
          throw new ApiError(
            400,
            "A correction reason is required for a closed or cancelled Job",
          );
        }
        jobFilter = {
          _id: jobId,
          status: statusAtRequest,
          isDeleted: false,
        };
      } else {
        jobFilter = {
          _id: jobId,
          assignedEmployeeId: req.user._id,
          status: JOB_STATUS.IN_PROGRESS,
          isDeleted: false,
        };
      }

      const jobUpdate = await Job.updateOne(
        jobFilter,
        { $inc: { materialUsageRevision: 1 } },
        { session },
      );

      if (jobUpdate.matchedCount !== 1) {
        const currentJob = await findJob(jobId, session);
        if (!isAdmin) {
          const stateError = getJobStateError(currentJob, req.user._id);
          if (stateError) throw stateError;
        }
        throw new ApiError(
          409,
          "Job changed while recording material usage; please retry",
        );
      }

      const item = await withSession(Item.findById(req.body.itemId), session);
      if (!item || !item.isActive) {
        throw new ApiError(404, "Active Item not found");
      }

      const unitCostSnapshot = item.currentUnitCost;
      const lineCostSnapshot = roundCost(
        req.body.quantity * unitCostSnapshot,
      );
      if (
        !Number.isFinite(unitCostSnapshot) ||
        unitCostSnapshot < 0 ||
        !Number.isFinite(lineCostSnapshot)
      ) {
        throw new ApiError(400, "Item cost or calculated line cost is invalid");
      }

      const [createdUsage] = await JobMaterialUsage.create(
        [
          {
            jobId: jobId,
            itemId: item._id,
            itemNameSnapshot: item.itemName,
            quantity: req.body.quantity,
            unitSnapshot: item.unit,
            unitCostSnapshot,
            lineCostSnapshot,
            recordedBy: req.user._id,
            ...(isAdmin && correctionReason ? { correctionReason } : {}),
          },
        ],
        { session },
      );
      usage = createdUsage;
    });
  } finally {
    await session.endSession();
  }

  const response = usage.toObject();
  delete response.unitCostSnapshot;
  delete response.lineCostSnapshot;

  return res
    .status(201)
    .json(new ApiResponse(201, response, "Material usage recorded"));
});

export const getJobMaterialUsage = asyncHandler(async (req, res) => {
  const job = await findJob(req.params.id);
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (
    !isAdmin &&
    (req.user.userType !== "employee" ||
      job.assignedEmployeeId?.toString() !== req.user._id.toString())
  ) {
    throw new ApiError(403, "Access denied");
  }

  const usageEntries = await JobMaterialUsage.find({ jobId: job._id })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const response = isAdmin
    ? usageEntries
    : usageEntries.map((entry) => {
        const safeEntry = { ...entry };
        delete safeEntry.unitCostSnapshot;
        delete safeEntry.lineCostSnapshot;
        delete safeEntry.correctionReason;
        return safeEntry;
      });

  return res
    .status(200)
    .json(new ApiResponse(200, response, "Material usage fetched"));
});

export const deleteJobMaterialUsage = asyncHandler(async (req, res) => {
  const { id: jobId, usageId } = req.params;
  if (
    !mongoose.isValidObjectId(jobId) ||
    !mongoose.isValidObjectId(usageId)
  ) {
    throw new ApiError(400, "Invalid Job or material usage ID");
  }

  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin && req.user.userType !== "employee") {
    throw new ApiError(403, "Access denied");
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const jobFilter = isAdmin
        ? { _id: jobId, isDeleted: false }
        : {
            _id: jobId,
            assignedEmployeeId: req.user._id,
            status: JOB_STATUS.IN_PROGRESS,
            isDeleted: false,
          };
      const jobUpdate = await Job.updateOne(
        jobFilter,
        { $inc: { materialUsageRevision: 1 } },
        { session },
      );

      if (jobUpdate.matchedCount !== 1) {
        const currentJob = await findJob(jobId, session);
        if (!isAdmin) {
          if (
            currentJob.assignedEmployeeId?.toString() !==
            req.user._id.toString()
          ) {
            throw new ApiError(403, "This job is not assigned to you");
          }
          if (currentJob.status !== JOB_STATUS.IN_PROGRESS) {
            throw new ApiError(
              400,
              `Cannot remove material usage while Job status is ${currentJob.status}`,
            );
          }
        }
        throw new ApiError(409, "Job changed while removing material usage; please retry");
      }

      const usageQuery = JobMaterialUsage.findOneAndDelete({
        _id: usageId,
        jobId,
      });
      const deletedUsage = await withSession(usageQuery, session);
      if (!deletedUsage) {
        throw new ApiError(404, "Material usage entry not found");
      }
    });
  } finally {
    await session.endSession();
  }

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Material usage removed"));
});
