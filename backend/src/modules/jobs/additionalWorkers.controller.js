import mongoose from "mongoose";
import asyncHandler from "../../utils/asyncHandler.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";
import Job from "./jobs.model.js";
import JobHistory from "./jobHistory.model.js";

const MAX_ADDITIONAL_WORKERS = 20;
const ADMIN_ROLES = new Set(["admin", "superAdmin"]);

const withSession = (query, session) =>
  session && typeof query.session === "function"
    ? query.session(session)
    : query;

const loadJob = async (jobId, session) => {
  if (!mongoose.isValidObjectId(jobId)) {
    throw new ApiError(400, "Invalid Job ID");
  }

  const job = await withSession(Job.findById(jobId), session);
  if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
  return job;
};

const assertCanModify = (job, user) => {
  if (ADMIN_ROLES.has(user.userType)) return;
  if (user.userType !== "employee") {
    throw new ApiError(403, "Access denied");
  }
  if (job.assignedEmployeeId?.toString() !== user._id.toString()) {
    throw new ApiError(403, "This job is not assigned to you");
  }
  if (job.status !== JOB_STATUS.IN_PROGRESS) {
    throw new ApiError(
      400,
      `Cannot modify additional workers while Job status is ${job.status}`,
    );
  }
};

const currentVersion = (job) => job.__v ?? 0;

const versionFilter = (expectedVersion) =>
  expectedVersion === 0
    ? { $or: [{ __v: 0 }, { __v: { $exists: false } }] }
    : { __v: expectedVersion };

const assertExpectedVersion = (job, expectedVersion) => {
  if (currentVersion(job) !== expectedVersion) {
    throw new ApiError(
      409,
      "Job changed while updating additional workers; refresh and retry",
    );
  }
};

const buildJobFilter = (job, user, expectedVersion) => ({
  _id: job._id,
  ...versionFilter(expectedVersion),
  isDeleted: { $ne: true },
  ...(ADMIN_ROLES.has(user.userType)
    ? {}
    : {
        assignedEmployeeId: user._id,
        status: JOB_STATUS.IN_PROGRESS,
      }),
});

const writeHistory = async ({
  session,
  job,
  user,
  req,
  action,
  workerId,
  before,
  after,
}) => {
  const details = {
    actorRole: user.userType,
    workerEntryId: workerId,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
  await JobHistory.create(
    [
      {
        jobId: job._id,
        action,
        performedBy: user._id,
        performedAt: new Date(),
        details,
        ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
      },
    ],
    { session },
  );
};

const runWorkerMutation = async (operation) => {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => operation(session));
  } finally {
    await session.endSession();
  }
};

const loadUpdatedWorkers = async (jobId, session) => {
  const job = await withSession(Job.findById(jobId), session);
  if (!job) throw new ApiError(404, "Job not found");
  return {
    additionalWorkers: job.additionalWorkers ?? [],
    version: currentVersion(job),
  };
};

export const createAdditionalWorker = asyncHandler(async (req, res) => {
  const result = await runWorkerMutation(async (session) => {
    const job = await loadJob(req.params.id, session);
    assertCanModify(job, req.user);
    assertExpectedVersion(job, req.body.expectedVersion);

    if ((job.additionalWorkers?.length ?? 0) >= MAX_ADDITIONAL_WORKERS) {
      throw new ApiError(400, "A Job can have no more than 20 additional worker entries");
    }

    const now = new Date();
    const worker = {
      _id: new mongoose.Types.ObjectId(),
      workerType: req.body.workerType,
      quantity: req.body.quantity,
      ...(req.body.notes !== undefined ? { notes: req.body.notes } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const filter = {
      ...buildJobFilter(job, req.user, req.body.expectedVersion),
      $expr: {
        $lt: [
          { $size: { $ifNull: ["$additionalWorkers", []] } },
          MAX_ADDITIONAL_WORKERS,
        ],
      },
    };
    const update = await Job.updateOne(
      filter,
      {
        $push: { additionalWorkers: worker },
        $inc: { __v: 1 },
        $set: { updatedBy: req.user._id },
      },
      { session, runValidators: true },
    );

    if (update.matchedCount !== 1) {
      throw new ApiError(
        409,
        "Job changed while adding an additional worker; refresh and retry",
      );
    }

    await writeHistory({
      session,
      job,
      user: req.user,
      req,
      action: "additional_worker_added",
      workerId: worker._id,
      after: worker,
    });
    return loadUpdatedWorkers(job._id, session);
  });

  return res
    .status(201)
    .json(new ApiResponse(201, result, "Additional worker added"));
});

export const updateAdditionalWorker = asyncHandler(async (req, res) => {
  const result = await runWorkerMutation(async (session) => {
    const job = await loadJob(req.params.id, session);
    assertCanModify(job, req.user);
    assertExpectedVersion(job, req.body.expectedVersion);

    const existing = (job.additionalWorkers ?? []).find(
      (entry) => entry._id.toString() === req.params.workerId,
    );
    if (!existing) throw new ApiError(404, "Additional worker not found");

    const before = existing.toObject
      ? existing.toObject()
      : { ...existing };
    const changes = Object.fromEntries(
      ["workerType", "quantity", "notes"]
        .filter((key) => req.body[key] !== undefined)
        .map((key) => [`additionalWorkers.$.${key}`, req.body[key]]),
    );
    const updatedAt = new Date();
    changes["additionalWorkers.$.updatedAt"] = updatedAt;
    const update = await Job.updateOne(
      {
        ...buildJobFilter(job, req.user, req.body.expectedVersion),
        "additionalWorkers._id": req.params.workerId,
      },
      {
        $set: { ...changes, updatedBy: req.user._id },
        $inc: { __v: 1 },
      },
      { session, runValidators: true },
    );

    if (update.matchedCount !== 1) {
      throw new ApiError(
        409,
        "Job changed while updating an additional worker; refresh and retry",
      );
    }

    const after = {
      ...before,
      ...Object.fromEntries(
        ["workerType", "quantity", "notes"]
          .filter((key) => req.body[key] !== undefined)
          .map((key) => [key, req.body[key]]),
      ),
      updatedAt,
    };
    await writeHistory({
      session,
      job,
      user: req.user,
      req,
      action: "additional_worker_updated",
      workerId: existing._id,
      before,
      after,
    });
    return loadUpdatedWorkers(job._id, session);
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result, "Additional worker updated"));
});

export const deleteAdditionalWorker = asyncHandler(async (req, res) => {
  const result = await runWorkerMutation(async (session) => {
    const job = await loadJob(req.params.id, session);
    assertCanModify(job, req.user);
    assertExpectedVersion(job, req.body.expectedVersion);

    const existing = (job.additionalWorkers ?? []).find(
      (entry) => entry._id.toString() === req.params.workerId,
    );
    if (!existing) throw new ApiError(404, "Additional worker not found");

    const before = existing.toObject
      ? existing.toObject()
      : { ...existing };
    const update = await Job.updateOne(
      {
        ...buildJobFilter(job, req.user, req.body.expectedVersion),
        "additionalWorkers._id": req.params.workerId,
      },
      {
        $pull: { additionalWorkers: { _id: req.params.workerId } },
        $set: { updatedBy: req.user._id },
        $inc: { __v: 1 },
      },
      { session },
    );

    if (update.matchedCount !== 1) {
      throw new ApiError(
        409,
        "Job changed while removing an additional worker; refresh and retry",
      );
    }

    await writeHistory({
      session,
      job,
      user: req.user,
      req,
      action: "additional_worker_removed",
      workerId: existing._id,
      before,
    });
    return loadUpdatedWorkers(job._id, session);
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result, "Additional worker removed"));
});
