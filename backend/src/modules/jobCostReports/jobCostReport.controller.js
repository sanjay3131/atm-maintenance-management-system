import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import {
  getJobCostReport,
  initializeJobCostReport,
  refreshJobCostReportMaterials,
  updateJobCostReport,
} from "./jobCostReport.service.js";
import {
  createJobCostReportWorkbook,
  XLSX_CONTENT_TYPE_HEADER,
} from "./jobCostReport.export.service.js";
import ApiError from "../../utils/ApiError.js";

const safeFilenamePart = (value) =>
  String(value || "job")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "job";

export const initializeCostReport = asyncHandler(async (req, res) => {
  const result = await initializeJobCostReport({
    jobId: req.validatedParams.jobId,
    actor: req.user,
  });

  const statusCode = result.created ? 201 : 200;
  return res
    .status(statusCode)
    .json(
      new ApiResponse(
        statusCode,
        result.report,
        result.created
          ? "Job cost report draft created"
          : "Job cost report draft already exists",
      ),
    );
});

export const retrieveCostReport = asyncHandler(async (req, res) => {
  const report = await getJobCostReport({
    jobId: req.validatedParams.jobId,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, report, "Job cost report draft fetched"));
});

export const exportCostReport = asyncHandler(async (req, res) => {
  if (req.method !== "GET") {
    throw new ApiError(405, "Only GET is supported for job cost report export");
  }

  const report = await getJobCostReport({
    jobId: req.validatedParams.jobId,
  });

  let workbook;
  try {
    workbook = await createJobCostReportWorkbook(report);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("Job cost report export generation failed", error);
    throw new ApiError(500, "Job cost report export could not be generated");
  }

  const identity = report.jobSnapshot?.jobNumber || report.jobSnapshot?.jobId;
  res.setHeader("Content-Type", XLSX_CONTENT_TYPE_HEADER);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="job-cost-report-${safeFilenamePart(identity)}.xlsx"`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).send(Buffer.from(workbook));
});

export const patchCostReport = asyncHandler(async (req, res) => {
  const { expectedDraftRevision, ...patch } = req.body;
  const report = await updateJobCostReport({
    jobId: req.validatedParams.jobId,
    actor: req.user,
    expectedDraftRevision,
    patch,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, report, "Job cost report draft updated"));
});

export const refreshCostReportMaterials = asyncHandler(async (req, res) => {
  const report = await refreshJobCostReportMaterials({
    jobId: req.validatedParams.jobId,
    actor: req.user,
    expectedDraftRevision: req.body.expectedDraftRevision,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, report, "Job cost report materials refreshed"));
});
