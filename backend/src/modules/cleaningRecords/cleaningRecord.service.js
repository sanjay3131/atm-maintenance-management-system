import ApiError from "../../utils/ApiError.js";
import CleaningRecord from "./cleaningRecord.model.js";
import { getBusinessDateParts } from "../jobs/recurringMaintenance.utils.js";

const CLEANING_MAINTENANCE_TYPES = new Set([
  "DAILY_CLEANING",
  "WEEKLY_MOPPING",
]);

const sameId = (left, right) =>
  left != null && right != null && String(left) === String(right);

export const isRecurringCleaningJob = (job) =>
  job.recurringMaintenance?.source === "RECURRING" &&
  CLEANING_MAINTENANCE_TYPES.has(job.recurringMaintenance.maintenanceType);

export const createOrUpdateEmployeeCleaningRecord = async ({
  job,
  responsibleEmployeeId,
  submittedBy,
  actualCleanerType,
  outsourcedCleanerName,
  completedAt,
  remarks,
  evidencePhotoIds,
  session,
}) => {
  if (!isRecurringCleaningJob(job)) return null;
  if (!session) {
    throw new Error(
      "Cleaning records must be written in the completion transaction",
    );
  }
  if (!["INTERNAL", "OUTSOURCED"].includes(actualCleanerType)) {
    throw new ApiError(
      400,
      "A cleaner type is required for recurring cleaning Jobs",
    );
  }
  if (
    actualCleanerType === "OUTSOURCED" &&
    !outsourcedCleanerName?.trim()
  ) {
    throw new ApiError(400, "An outsourced cleaner name is required");
  }
  if (
    actualCleanerType === "INTERNAL" &&
    outsourcedCleanerName?.trim()
  ) {
    throw new ApiError(
      400,
      "Outsourced cleaner name is only valid for outsourced cleaning",
    );
  }

  const { planId, occurrenceKey } = job.recurringMaintenance;
  if (!planId || !occurrenceKey) {
    throw new ApiError(
      409,
      "Recurring cleaning Job is missing its plan or occurrence identity",
    );
  }

  const submission = {
    actualCleanerType,
    actualCleanerEmployeeId:
      actualCleanerType === "INTERNAL" ? responsibleEmployeeId : null,
    outsourcedCleanerName:
      actualCleanerType === "OUTSOURCED" ? outsourcedCleanerName : undefined,
    cleaningDate: getBusinessDateParts(completedAt).dateKey,
    submittedBy,
    reportingMethod: "EMPLOYEE",
    submittedAt: completedAt,
    remarks: remarks || "",
    evidencePhotoIds,
  };
  const recordFields = {
    responsibleEmployeeId,
    ...submission,
  };

  const existingRecord = await CleaningRecord.findOne({
    recurringJobId: job._id,
  }).session(session);

  if (existingRecord) {
    if (
      !sameId(existingRecord.recurringPlanId, planId) ||
      !sameId(existingRecord.occurrenceKey, occurrenceKey) ||
      !sameId(existingRecord.atmId, job.atmId)
    ) {
      throw new ApiError(
        409,
        "Cleaning record identity does not match the recurring Job",
      );
    }

    Object.assign(existingRecord, recordFields, {
      validityStatus: "VALID",
      revision: (existingRecord.revision || 0) + 1,
    });
    existingRecord.submissionHistory.push(submission);
    await existingRecord.save({ session });
    return existingRecord;
  }

  try {
    const [record] = await CleaningRecord.create(
      [
        {
          recurringJobId: job._id,
          recurringPlanId: planId,
          occurrenceKey,
          atmId: job.atmId,
          ...recordFields,
          validityStatus: "VALID",
          revision: 0,
          submissionHistory: [submission],
        },
      ],
      { session },
    );
    return record;
  } catch (error) {
    if (error.code === 11000) {
      throw new ApiError(
        409,
        "A CleaningRecord already exists for this recurring Job occurrence",
      );
    }
    throw error;
  }
};
