import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import { getCleaningMonitoringRecords } from "./cleaningMonitoring.service.js";

export const getCleaningMonitoring = asyncHandler(async (_req, res) => {
  const records = await getCleaningMonitoringRecords();
  return res
    .status(200)
    .json(new ApiResponse(200, records, "Cleaning monitoring fetched"));
});
