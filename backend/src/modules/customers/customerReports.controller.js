import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import Job from "../jobs/jobs.model.js";
import AMC from "../amc/amc.model.js";
import { getActiveCustomerForUser } from "./customerAccess.js";
import {
  buildCustomerAMCReportQuery,
  buildCustomerJobReportQuery,
  createCustomerAMCWorkbook,
  createCustomerJobWorkbook,
  customerReportFilename,
  CUSTOMER_REPORT_JOB_STATUSES,
  parseCustomerReportFilters,
  sendCustomerWorkbook,
} from "./customerReports.service.js";

const jobExportFields =
  "jobId jobNumber title workType priority status createdAt completedAt closedAt";
const amcExportFields =
  "amcId month year status visitDate completedAt checklistCompleted createdAt";

const validatedFilters = (req, includeAMCStatus = false) => {
  const filters = parseCustomerReportFilters(req.query);
  if (
    includeAMCStatus &&
    req.query.amcStatus !== undefined &&
    req.query.amcStatus !== "COMPLETED"
  ) {
    throw new ApiError(400, "Only completed AMC records are available");
  }
  return filters;
};

export const getCustomerReportSummary = asyncHandler(async (req, res) => {
  const customer = await getActiveCustomerForUser(req.user);
  const filters = validatedFilters(req, true);
  const jobQuery = buildCustomerJobReportQuery(customer._id, filters);
  const amcQuery = buildCustomerAMCReportQuery(customer._id, filters);
  const [jobStatusGroups, completedAMCs] = await Promise.all([
    Job.aggregate([
      { $match: jobQuery },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    AMC.countDocuments(amcQuery),
  ]);

  const jobsByStatus = Object.fromEntries(
    CUSTOMER_REPORT_JOB_STATUSES.map((status) => [status, 0]),
  );
  for (const group of jobStatusGroups) {
    if (Object.hasOwn(jobsByStatus, group._id)) {
      jobsByStatus[group._id] = group.count;
    }
  }
  const totalJobs = Object.values(jobsByStatus).reduce(
    (total, count) => total + count,
    0,
  );

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        dateRange: filters.fromDate
          ? { fromDate: filters.fromDate, toDate: filters.toDate }
          : null,
        jobStatus: filters.jobStatus ?? null,
        totalJobs,
        jobsByStatus,
        closedJobs: jobsByStatus.CLOSED,
        completionRate:
          totalJobs === 0
            ? 0
            : Number(((jobsByStatus.CLOSED / totalJobs) * 100).toFixed(1)),
        completedAMCs,
      },
      "Customer report summary fetched",
    ),
  );
});

export const exportCustomerJobReport = asyncHandler(async (req, res) => {
  const customer = await getActiveCustomerForUser(req.user);
  const filters = validatedFilters(req);
  const jobs = await Job.find(buildCustomerJobReportQuery(customer._id, filters))
    .select(jobExportFields)
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const workbook = await createCustomerJobWorkbook(jobs, filters);
  await sendCustomerWorkbook(
    res,
    customerReportFilename("customer-job-history", filters),
    workbook,
  );
});

export const exportCustomerAMCReport = asyncHandler(async (req, res) => {
  const customer = await getActiveCustomerForUser(req.user);
  const filters = validatedFilters(req, true);
  const amcs = await AMC.find(buildCustomerAMCReportQuery(customer._id, filters))
    .select(amcExportFields)
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const workbook = await createCustomerAMCWorkbook(amcs, filters);
  await sendCustomerWorkbook(
    res,
    customerReportFilename("customer-completed-amc", filters),
    workbook,
  );
});
