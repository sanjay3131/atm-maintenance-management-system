import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import Job from "../jobs/jobs.model.js";
import JobHistory from "../jobs/jobHistory.model.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";
import Complaint from "./complaints.model.js";

const withSession = (query, session) =>
  typeof query.session === "function" ? query.session(session) : query;

const sameId = (left, right) =>
  String(left?._id ?? left) === String(right?._id ?? right);

export const withComplaintJobTransaction = async (operation) => {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const findActiveComplaint = async (complaintId, session) => {
  const complaint = await withSession(
    Complaint.findById(complaintId),
    session,
  );
  if (!complaint || complaint.isDeleted) {
    throw new ApiError(404, "Complaint not found");
  }
  return complaint;
};

const findActiveJob = async (jobId, session) => {
  const job = await withSession(Job.findById(jobId), session);
  if (!job || job.isDeleted) {
    throw new ApiError(404, "Job not found");
  }
  return job;
};

const clearStaleJobComplaintReference = async (job, session) => {
  if (!job.complaintId) return;

  const linkedComplaint = await withSession(
    Complaint.findById(job.complaintId),
    session,
  );
  if (linkedComplaint && !linkedComplaint.isDeleted) {
    throw new ApiError(409, "Job is already linked to another complaint");
  }

  job.complaintId = null;
  await job.save({ session });
};

const clearStaleComplaintJobReference = async (complaint, session) => {
  if (!complaint.jobId) return;

  const linkedJob = await withSession(
    Job.findById(complaint.jobId),
    session,
  );
  if (linkedJob && !linkedJob.isDeleted) {
    throw new ApiError(409, "Complaint is already linked to another job");
  }

  if (linkedJob && sameId(linkedJob.complaintId, complaint._id)) {
    linkedJob.complaintId = null;
    await linkedJob.save({ session });
  }
  complaint.jobId = null;
  await complaint.save({ session });
};

const assertSameATM = (complaint, job) => {
  if (!sameId(complaint.atmId, job.atmId)) {
    throw new ApiError(400, "Job must be for the same ATM as the complaint");
  }
};

export const linkComplaintAndJob = async ({
  complaintId,
  jobId,
  updatedBy,
}) =>
  withComplaintJobTransaction(async (session) => {
    const complaint = await findActiveComplaint(complaintId, session);

    if (["CLOSED", "CANCELLED"].includes(complaint.status)) {
      throw new ApiError(400, "Cannot link a closed or cancelled complaint");
    }

    const job = await findActiveJob(jobId, session);
    assertSameATM(complaint, job);

    const alreadyLinked =
      sameId(complaint.jobId, job._id) &&
      sameId(job.complaintId, complaint._id);

    if (complaint.jobId && !sameId(complaint.jobId, job._id)) {
      await clearStaleComplaintJobReference(complaint, session);
    }
    if (job.complaintId && !sameId(job.complaintId, complaint._id)) {
      await clearStaleJobComplaintReference(job, session);
    }

    complaint.jobId = job._id;
    if (!alreadyLinked) complaint.status = "ASSIGNED";
    complaint.updatedBy = updatedBy;
    job.complaintId = complaint._id;
    await complaint.save({ session });
    await job.save({ session });
    return complaint;
  });

export const unlinkComplaintAndJob = async ({ complaintId, updatedBy }) =>
  withComplaintJobTransaction(async (session) => {
    const complaint = await findActiveComplaint(complaintId, session);

    if (complaint.jobId) {
      if (complaint.status === "CLOSED") {
        throw new ApiError(400, "Cannot unlink a closed complaint");
      }

      const job = await withSession(Job.findById(complaint.jobId), session);
      if (job && sameId(job.complaintId, complaint._id)) {
        job.complaintId = null;
        await job.save({ session });
      }

      complaint.jobId = null;
      complaint.status = "OPEN";
      complaint.updatedBy = updatedBy;
      await complaint.save({ session });
    }

    return complaint;
  });

export const createJobWithComplaint = async ({
  jobData,
  updatedBy,
}) =>
  withComplaintJobTransaction(async (session) => {
    const complaint = await findActiveComplaint(jobData.complaintId, session);
    if (["CLOSED", "CANCELLED"].includes(complaint.status)) {
      throw new ApiError(
        400,
        `Cannot link a ${complaint.status.toLowerCase()} complaint`,
      );
    }
    if (complaint.jobId) {
      await clearStaleComplaintJobReference(complaint, session);
    }
    if (!sameId(complaint.atmId, jobData.atmId)) {
      throw new ApiError(400, "Job must be for the same ATM as the complaint");
    }

    const [job] = await Job.create([jobData], { session });
    complaint.jobId = job._id;
    complaint.status = "ASSIGNED";
    complaint.updatedBy = updatedBy;
    await complaint.save({ session });
    return job;
  });

export const closeJobAndComplaint = async ({ jobId, closedBy }) =>
  withComplaintJobTransaction(async (session) => {
    const job = await findActiveJob(jobId, session);
    if (job.status !== JOB_STATUS.APPROVED) {
      throw new ApiError(400, `Cannot close job with status: ${job.status}`);
    }

    const closedAt = new Date();
    if (job.complaintId) {
      const complaint = await withSession(
        Complaint.findById(job.complaintId),
        session,
      );
      if (!complaint || complaint.isDeleted) {
        throw new ApiError(404, "Linked complaint not found");
      }
      if (!sameId(complaint.jobId, job._id)) {
        throw new ApiError(409, "Job and complaint relationship is inconsistent");
      }
      assertSameATM(complaint, job);

      if (complaint.status !== "CLOSED") {
        complaint.status = "CLOSED";
        complaint.closedAt = closedAt;
        complaint.closedBy = closedBy;
        complaint.updatedBy = closedBy;
      }
      await complaint.save({ session });
    } else {
      const complaint = await withSession(
        Complaint.findOne({ jobId: job._id, isDeleted: false }),
        session,
      );
      if (complaint) {
        throw new ApiError(409, "Complaint and job relationship is inconsistent");
      }
    }

    job.status = JOB_STATUS.CLOSED;
    job.closedAt = closedAt;
    job.updatedBy = closedBy;
    await job.save({ session });
    return job;
  });

export const cancelJobAndPreserveComplaintHistory = async ({
  jobId,
  cancelledBy,
  reason,
  req,
}) => {
  const cancellationReason = typeof reason === "string" ? reason.trim() : "";
  if (!cancellationReason || cancellationReason.length > 1000) {
    throw new ApiError(
      400,
      "Cancellation reason must be between 1 and 1000 characters",
    );
  }

  return withComplaintJobTransaction(async (session) => {
    const job = await findActiveJob(jobId, session);
    const cancellableStatuses = [
      JOB_STATUS.PENDING,
      JOB_STATUS.ASSIGNED,
      JOB_STATUS.ACCEPTED,
      JOB_STATUS.ON_HOLD,
      JOB_STATUS.REJECTED,
    ];
    if (!cancellableStatuses.includes(job.status)) {
      const message =
        job.status === JOB_STATUS.IN_PROGRESS
          ? "Put the job on hold before cancelling it"
          : `Cannot cancel job with status: ${job.status}`;
      throw new ApiError(400, message);
    }

    const cancelledAt = new Date();
    const oldStatus = job.status;
    let previousComplaintStatus;

    if (job.complaintId) {
      const complaint = await withSession(
        Complaint.findById(job.complaintId),
        session,
      );
      if (!complaint || complaint.isDeleted) {
        throw new ApiError(404, "Linked complaint not found");
      }
      if (!sameId(complaint.jobId, job._id)) {
        throw new ApiError(
          409,
          "Job and complaint relationship is inconsistent",
        );
      }
      assertSameATM(complaint, job);
      if (complaint.status === "CLOSED") {
        throw new ApiError(409, "Cannot cancel a job linked to a closed complaint");
      }

      previousComplaintStatus = complaint.status;
      complaint.jobLinkHistory ??= [];
      complaint.jobLinkHistory.push({
        jobId: job._id,
        endedAt: cancelledAt,
        endReason: cancellationReason,
      });
      complaint.jobId = null;
      if (complaint.status !== "CANCELLED") complaint.status = "OPEN";
      complaint.updatedBy = cancelledBy;
      await complaint.save({ session });
    } else {
      const linkedComplaint = await withSession(
        Complaint.findOne({ jobId: job._id, isDeleted: false }),
        session,
      );
      if (linkedComplaint) {
        throw new ApiError(
          409,
          "Complaint and job relationship is inconsistent",
        );
      }
    }

    job.status = JOB_STATUS.CANCELLED;
    job.cancelledAt = cancelledAt;
    job.cancelledBy = cancelledBy;
    job.cancellationReason = cancellationReason;
    job.updatedBy = cancelledBy;
    await job.save({ session });
    await JobHistory.create(
      [
        {
          jobId: job._id,
          action: "cancelled",
          fromStatus: oldStatus,
          toStatus: JOB_STATUS.CANCELLED,
          performedBy: cancelledBy,
          performedAt: cancelledAt,
          details: {
            cancellationReason,
            previousComplaintStatus,
          },
          ipAddress: req?.ip || req?.headers?.["x-forwarded-for"] || null,
        },
      ],
      { session },
    );
    return job;
  });
};

export const softDeleteJobAndUnlinkComplaint = async ({
  jobId,
  deletedBy,
}) =>
  withComplaintJobTransaction(async (session) => {
    const job = await findActiveJob(jobId, session);

    if (job.complaintId) {
      const complaint = await withSession(
        Complaint.findById(job.complaintId),
        session,
      );
      if (
        complaint &&
        !complaint.isDeleted &&
        sameId(complaint.jobId, job._id)
      ) {
        complaint.jobId = null;
        complaint.updatedBy = deletedBy;
        await complaint.save({ session });
      }
      job.complaintId = null;
    }

    job.isDeleted = true;
    job.deletedAt = new Date();
    job.deletedBy = deletedBy;
    await job.save({ session });
    return job;
  });

export const softDeleteComplaintAndUnlinkJob = async ({
  complaintId,
  deletedBy,
}) =>
  withComplaintJobTransaction(async (session) => {
    const complaint = await findActiveComplaint(complaintId, session);

    if (complaint.jobId) {
      const job = await withSession(
        Job.findById(complaint.jobId),
        session,
      );
      if (job && sameId(job.complaintId, complaint._id)) {
        job.complaintId = null;
        await job.save({ session });
      }
      complaint.jobId = null;
    }

    complaint.isDeleted = true;
    complaint.deletedAt = new Date();
    complaint.deletedBy = deletedBy;
    await complaint.save({ session });
    return complaint;
  });
