import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import Employee from "../employees/employee.model.js";
import ATM from "./atm.model.js";
import { generateATMId } from "./atm.utils.js";

export const createATM = asyncHandler(async (req, res) => {
  const {
    bankId,
    districtId,
    regionId,
    locationName,
    address,
    installationType,
    location,
  } = req.body;

  const atmId = await generateATMId();

  const atm = await ATM.create({
    atmId,
    bankId,
    districtId,
    regionId,
    locationName,
    address,
    installationType,
    location,
    createdBy: req.user._id,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, atm, "ATM created successfully"));
});
