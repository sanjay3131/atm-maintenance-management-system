import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import {
  createPublicHoliday,
  deletePublicHoliday,
  listPublicHolidays,
  updatePublicHoliday,
} from "./publicHoliday.service.js";

export const getPublicHolidays = asyncHandler(async (req, res) => {
  const result = await listPublicHolidays(req.user, req.validatedQuery);
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Public holidays fetched"));
});

export const postPublicHoliday = asyncHandler(async (req, res) => {
  const holiday = await createPublicHoliday(req.user, req.body);
  return res
    .status(201)
    .json(new ApiResponse(201, holiday, "Public holiday created"));
});

export const patchPublicHoliday = asyncHandler(async (req, res) => {
  const holiday = await updatePublicHoliday(
    req.user,
    req.validatedParams.holidayId,
    req.body,
  );
  return res
    .status(200)
    .json(new ApiResponse(200, holiday, "Public holiday updated"));
});

export const removePublicHoliday = asyncHandler(async (req, res) => {
  const result = await deletePublicHoliday(
    req.user,
    req.validatedParams.holidayId,
  );
  return res
    .status(200)
    .json(new ApiResponse(200, result, "Public holiday deleted"));
});
