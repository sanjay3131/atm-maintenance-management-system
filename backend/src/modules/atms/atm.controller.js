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

// view all atm
export const getAllATMs = asyncHandler(async (req, res) => {
  const atms = await ATM.find({ isDeleted: false })
    // .populate("bankId", "name")
    // .populate("districtId", "name")
    // .populate("regionId", "name")
    .populate("assignedEmployeeId", "employeeCode firstName lastName");

  return res
    .status(200)
    .json(new ApiResponse(200, atms, "ATMs fetched successfully"));
});

// view single atm

export const getATMById = asyncHandler(async (req, res) => {
  const atm = await ATM.findById(req.params.id)
    // .populate("bankId", "name")
    // .populate("districtId", "name")
    // .populate("regionId", "name")
    .populate("assignedEmployeeId", "employeeCode firstName lastName");

  if (!atm || atm.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, atm, "ATM fetched successfully"));
});

// update atm
export const updateATM = asyncHandler(async (req, res) => {
  const updatedATM = await ATM.findByIdAndUpdate(
    req.params.id,
    {
      ...req.body,
      updatedBy: req.user._id,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!updatedATM || updatedATM.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, updatedATM, "ATM updated successfully"));
});

// delete atm (soft delete)
export const deleteATM = asyncHandler(async (req, res) => {
  const atm = await ATM.findById(req.params.id);

  if (!atm || atm.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  atm.isDeleted = true;
  atm.updatedBy = req.user._id;

  await atm.save();

  return res
    .status(200)
    .json(new ApiResponse(200, atm, "ATM deleted successfully"));
});

// assign employee to atm
export const assignEmployeeToATM = asyncHandler(async (req, res) => {
  const { employeeId } = req.body;
  const atmId = req.params.id;

  const atm = await ATM.findById(atmId);
  if (!atm || atm.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  // Check if the employee is already assigned to the ATM
  if (atm.assignedEmployeeId.includes(employeeId)) {
    throw new ApiError(400, "Employee is already assigned to this ATM");
  }

  atm.assignedEmployeeId.push(employeeId);
  atm.updatedBy = req.user._id;
  await atm.save();

  return res
    .status(200)
    .json(new ApiResponse(200, atm, "atm assiged to employee"));
});
