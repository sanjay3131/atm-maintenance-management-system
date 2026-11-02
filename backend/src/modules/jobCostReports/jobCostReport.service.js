import mongoose from "mongoose";
import Employee from "../employees/employee.model.js";
import Job from "../jobs/jobs.model.js";
import JobMaterialUsage from "../jobs/jobMaterialUsage.model.js";
import ApiError from "../../utils/ApiError.js";
import JobCostReport from "./jobCostReport.model.js";
import { mapJobToCostReportSource } from "./jobCostReport.mapper.js";

const isDuplicateKeyError = (error) => error?.code === 11000;

const withQueryMethods = (query) => query;

const withSession = (query, session) =>
  session && typeof query.session === "function"
    ? query.session(session)
    : query;

export const getKnownMaterialUsageRevision = (job) => {
  if (!job || !Object.hasOwn(job, "materialUsageRevision")) {
    return { value: null, isKnown: false };
  }

  const value = job.materialUsageRevision;
  if (!Number.isInteger(value) || value < 0) {
    return { value: null, isKnown: false };
  }

  return { value, isKnown: true };
};

const loadActiveJob = async (jobId, session) => {
  if (!mongoose.isValidObjectId(jobId)) {
    throw new ApiError(400, "Invalid Job ID");
  }

  const query = Job.findOne({ _id: jobId, isDeleted: { $ne: true } })
    .select("+materialUsageRevision")
    .populate("atmId", "atmId locationName address bankId")
    .populate("atmId.bankId", "bankName")
    .populate(
      "complaintId",
      "complaintNumber title description reportedAt updatedAt",
    )
    .populate("customerId", "bankName")
    .populate("assignedEmployeeId", "firstName lastName");
  const job = await withQueryMethods(withSession(query, session)).lean();

  if (!job) {
    throw new ApiError(404, "Job not found");
  }

  return job;
};

const loadMappedSource = async (job) => {
  const jobData =
    typeof job.toObject === "function" ? job.toObject() : { ...job };

  if (jobData.assignedEmployeeId?._id) {
    const employee = await Employee.findOne({
      userId: jobData.assignedEmployeeId._id,
    })
      .select("employeeCode")
      .lean();

    jobData.assignedEmployeeId = {
      ...jobData.assignedEmployeeId,
      employeeCode: employee?.employeeCode ?? null,
    };
  }

  return mapJobToCostReportSource(jobData);
};

const toMoneyString = (value) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new ApiError(409, "Material usage contains an invalid historical cost");
  }
  return value.toFixed(2);
};

const toCapturedAt = (usage) => {
  const value = usage.createdAt ?? usage.updatedAt;
  const capturedAt = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(capturedAt.getTime())) {
    throw new ApiError(
      409,
      "Material usage contains no valid historical capture timestamp",
    );
  }
  return capturedAt;
};

export const mapMaterialUsageToSnapshot = (usageEntries) =>
  usageEntries.map((usage) => ({
    usageId: usage._id,
    itemId: usage.itemId ?? null,
    itemNameSnapshot: usage.itemNameSnapshot,
    quantity: usage.quantity,
    unitSnapshot: usage.unitSnapshot,
    unitCostSnapshot: toMoneyString(usage.unitCostSnapshot),
    lineCostSnapshot: toMoneyString(usage.lineCostSnapshot),
    capturedAt: toCapturedAt(usage),
  }));

export const isMaterialSnapshotFresh = ({ report, job }) => {
  if (report?.materialSnapshotStatus !== "REFRESHED") return false;

  const currentRevision = getKnownMaterialUsageRevision(job);
  const capturedRevision = report.materialSnapshotRevision;

  return (
    currentRevision.isKnown &&
    capturedRevision?.isKnown === true &&
    Number.isInteger(capturedRevision.value) &&
    capturedRevision.value >= 0 &&
    capturedRevision.value === currentRevision.value
  );
};

export const initializeJobCostReport = async ({ jobId, actor }) => {
  const job = await loadActiveJob(jobId);
  const existing = await JobCostReport.findOne({ jobId: job._id });

  if (existing) {
    return { report: existing, created: false };
  }

  const source = await loadMappedSource(job);
  const insertFields = {
    jobId: job._id,
    draftRevision: 1,
    status: "DRAFT",
    jobSnapshot: source.jobSnapshot,
    sourceRevisions: source.sourceRevisions,
    serviceVisits: [],
    materialSnapshot: [],
    materialSnapshotStatus: "NOT_REFRESHED",
    materialSnapshotRevision: { value: null, isKnown: false },
    createdBy: actor._id,
    updatedBy: actor._id,
  };

  try {
    const report = await JobCostReport.findOneAndUpdate(
      { jobId: job._id },
      { $setOnInsert: insertFields },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );
    return { report, created: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const report = await JobCostReport.findOne({ jobId: job._id });
    if (!report) throw error;
    return { report, created: false };
  }
};

export const getJobCostReport = async ({ jobId }) => {
  const job = await loadActiveJob(jobId);
  const report = await JobCostReport.findOne({ jobId: job._id });

  if (!report) {
    throw new ApiError(404, "Job cost report draft not found");
  }

  const reportData =
    typeof report.toObject === "function" ? report.toObject() : { ...report };
  return {
    ...reportData,
    materialSnapshotFresh: isMaterialSnapshotFresh({
      report: reportData,
      job,
    }),
  };
};

export const refreshJobCostReportMaterials = async ({
  jobId,
  actor,
  expectedDraftRevision,
}) => {
  const session = await mongoose.startSession();
  let refreshedReport;
  let refreshedJob;

  try {
    await session.withTransaction(async () => {
      const job = await loadActiveJob(jobId, session);
      refreshedJob = job;
      const capturedRevision = getKnownMaterialUsageRevision(job);
      if (!capturedRevision.isKnown) {
        throw new ApiError(
          409,
          "Material usage revision is unknown; materials cannot be refreshed safely",
        );
      }

      const coordinationUpdate = await Job.updateOne(
        {
          _id: job._id,
          isDeleted: { $ne: true },
          materialUsageRevision: capturedRevision.value,
        },
        { $inc: { materialUsageRefreshEpoch: 1 } },
        { session, timestamps: false },
      );

      if (coordinationUpdate.matchedCount !== 1) {
        throw new ApiError(
          409,
          "Material usage changed while refreshing; please retry",
        );
      }

      const usageQuery = JobMaterialUsage.find({ jobId: job._id })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
      const usageEntries = await withSession(usageQuery, session);
      const materialSnapshot = mapMaterialUsageToSnapshot(usageEntries);

      const reportQuery = JobCostReport.findOneAndUpdate(
        {
          jobId: job._id,
          draftRevision: expectedDraftRevision,
        },
        {
          $set: {
            materialSnapshot,
            materialSnapshotStatus: "REFRESHED",
            materialSnapshotRevision: capturedRevision,
            updatedBy: actor._id,
          },
          $inc: { draftRevision: 1 },
        },
        {
          new: true,
          runValidators: true,
        },
      );
      const report = await withSession(reportQuery, session);

      if (!report) {
        const currentReport = await withSession(
          JobCostReport.findOne({ jobId: job._id }),
          session,
        );
        if (!currentReport) {
          throw new ApiError(404, "Job cost report draft not found");
        }
        throw new ApiError(
          409,
          "Job cost report draft changed; refresh and retry",
        );
      }

      refreshedReport = report;
    });
  } finally {
    await session.endSession();
  }

  const reportData =
    typeof refreshedReport.toObject === "function"
      ? refreshedReport.toObject()
      : { ...refreshedReport };
  return {
    ...reportData,
    materialSnapshotFresh: isMaterialSnapshotFresh({
      report: reportData,
      job: refreshedJob,
    }),
  };
};

export const updateJobCostReport = async ({
  jobId,
  actor,
  expectedDraftRevision,
  patch,
}) => {
  const job = await loadActiveJob(jobId);
  const update = {
    $set: {
      updatedBy: actor._id,
    },
    $inc: {
      draftRevision: 1,
    },
  };

  const reportFieldNames = [
    "serviceLaborCost",
    "gstRate",
    "bankPurchaseOrderNumber",
    "taxInvoiceNumber",
    "filingPeriod",
    "officeBillingStatus",
  ];

  for (const field of reportFieldNames) {
    if (patch[field] !== undefined) {
      update.$set[`reportFields.${field}`] = patch[field];
    }
  }

  if (patch.overrides) {
    for (const [field, value] of Object.entries(patch.overrides)) {
      update.$set[`reportFields.overrides.${field}`] = value;
    }
  }

  if (patch.serviceVisits !== undefined) {
    update.$set.serviceVisits = patch.serviceVisits;
  }

  const report = await JobCostReport.findOneAndUpdate(
    {
      jobId: job._id,
      draftRevision: expectedDraftRevision,
    },
    update,
    {
      new: true,
      runValidators: true,
    },
  );

  if (report) return report;

  const currentReport = await JobCostReport.findOne({ jobId: job._id });
  if (!currentReport) {
    throw new ApiError(404, "Job cost report draft not found");
  }

  throw new ApiError(
    409,
    "Job cost report draft changed; refresh and retry your update",
  );
};
