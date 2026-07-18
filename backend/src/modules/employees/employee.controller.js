// create eployee

import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import User from "../users/user.model.js";
import Employee from "./employee.model.js";
import { generateEmployeeCode } from "./employee.utils.js";
import ApiError from "../../utils/ApiError.js";

export const createEmployee = asyncHandler(async (req, res) => {
  const isAdmin =
    req.user.userType === "admin" || req.user.userType === "superAdmin";

  if (!isAdmin) {
    return res
      .status(403)
      .json(
        new ApiResponse(
          403,
          "You do not have permission to access this resource",
        ),
      );
  }

  const { userId } = req.params;

  const user = await User.findById(userId);

  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, "User not found", "User not found"));
  }

  const existingEmployee = await Employee.findOne({ userId: user._id });

  if (existingEmployee) {
    return res
      .status(400)
      .json(
        new ApiResponse(
          400,
          "Employee already exists for this user",
          "Employee already exists for this user",
        ),
      );
  }
  if (user.userType !== "employee") {
    return res
      .status(400)
      .json(
        new ApiResponse(
          400,
          "User is not an employee",
          "User is not an employee",
        ),
      );
  }
  const {
    designation,
    department,
    joiningDate,
    employmentType,
    districtIds,
    assignedAtmIds,
    salary,
  } = req.body;

  const employeeCode = await generateEmployeeCode();

  const newEmployee = await Employee.create({
    userId: user._id,
    employeeCode,
    designation,
    department,
    joiningDate,
    employmentType,
    districtIds,
    assignedAtmIds,
    salary,
    createdBy: req.user._id,
  });
  return res
    .status(201)
    .json(new ApiResponse(201, newEmployee, "Employee created successfully"));
});

// update employee by id (admin and superAdmin)

export const updateEmployee = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;

  const employee = await Employee.findByIdAndUpdate(employeeId, req.body, {
    new: true,
    runValidators: true,
  }).populate("userId", "name email userType");

  if (!employee) {
    return res
      .status(404)
      .json(new ApiResponse(404, "Employee not found", null));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, employee, "Employee updated successfully"));
});

// view employee by id (admin and superAdmin)

export const viewEmployeeById = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;

  const employee = await Employee.findById(employeeId).populate(
    "userId",
    "name email userType",
  );

  if (!employee) {
    return res
      .status(404)
      .json(new ApiResponse(404, "Employee not found", null));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, employee, "Employee retrieved successfully"));
});

// view all employees (admin and superAdmin)

export const viewAllEmployees = asyncHandler(async (req, res) => {
  const employees = await Employee.find().populate(
    "userId",
    "name email userType",
  );

  return res
    .status(200)
    .json(new ApiResponse(200, employees, "Employees retrieved successfully"));
});

// assign atm to employee (admin and superAdmin)

export const assignAtms = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;
  const { assignedAtmIds } = req.body;

  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  const existingAtmIds = (employee.assignedAtmIds || []).map((id) =>
    id.toString(),
  );
  const incomingAtmIds = (assignedAtmIds || []).map((id) => id.toString());
  const mergedAtmIds = Array.from(
    new Set([...existingAtmIds, ...incomingAtmIds]),
  );

  employee.assignedAtmIds = mergedAtmIds;

  await employee.save();

  return res
    .status(200)
    .json(new ApiResponse(200, employee, "ATMs assigned successfully"));
});

// assign district to employee (admin and superAdmin)

export const assignDistricts = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;
  const { districtIds } = req.body;

  const employee = await Employee.findById(employeeId);

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  const existingDistrictIds = (employee.districtIds || []).map((id) =>
    id.toString(),
  );
  const incomingDistrictIds = (districtIds || []).map((id) => id.toString());
  const mergedDistrictIds = Array.from(
    new Set([...existingDistrictIds, ...incomingDistrictIds]),
  );

  employee.districtIds = mergedDistrictIds;

  await employee.save();

  return res
    .status(200)
    .json(new ApiResponse(200, employee, "Districts assigned successfully"));
});
