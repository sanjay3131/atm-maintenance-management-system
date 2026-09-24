import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import User from "./user.model.js";
import { sanitizeUser } from "../../utils/sanitizeUser.js";
import { hashPassword } from "../auth/auth.utils.js";
import ApiError from "../../utils/ApiError.js";
import Employee from "../employees/employee.model.js";
import Customer from "../customers/customer.model.js";
import { generateEmployeeCode } from "../employees/employee.utils.js";

export const getAllUsers = asyncHandler(async (req, res) => {
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

  const users = await User.find()
    .select("-password")
    .sort({
      firstName: 1,
    })
    .select("-password -refreshToken");

  return res
    .status(200)
    .json(new ApiResponse(200, { users }, "Users listed successfully"));
});

// get user by id

export const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await User.findById(id).select("-password");

  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, "User not found", "User not found"));
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { user: sanitizeUser(user) },
        "User retrieved successfully",
      ),
    );
});

// update user by id (user and admins)

export const updateUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const isAdmin =
    req.user.userType === "admin" || req.user.userType === "superAdmin";
  const isSelf = req.user._id.toString() === id;

  if (!isAdmin && !isSelf) {
    return res
      .status(403)
      .json(
        new ApiResponse(
          403,
          "You do not have permission to access this resource",
        ),
      );
  }
  const { firstName, lastName, email, phoneNumber } = req.body;

  const user = await User.findById(id);

  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, "User not found", "User not found"));
  }

  user.firstName = firstName || user.firstName;
  user.lastName = lastName || user.lastName;
  user.email = email || user.email;
  user.phoneNumber = phoneNumber || user.phoneNumber;

  await user.save();

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { user: sanitizeUser(user) },
        "User updated successfully",
      ),
    );
});

// role assign by admin and superAdmin
export const assignRoleToUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

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

  const user = await User.findById(id);

  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, "User not found", "User not found"));
  }

  user.userType = role || user.userType;

  await user.save();

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { user: sanitizeUser(user) },
        "User role updated successfully",
      ),
    );
});

// status change by admin and superAdmin

export const changeUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

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

  const user = await User.findById(id);

  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, "User not found", "User not found"));
  }

  user.status = status || user.status;

  await user.save();

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { user: sanitizeUser(user) },
        "User status updated successfully",
      ),
    );
});

export const createEmployeeUser = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, phoneNumber } = req.body;

  const normalizedEmail = email.toLowerCase().trim();

  // Check duplicate email
  const existingEmail = await User.findOne({
    email: normalizedEmail,
  });

  if (existingEmail) {
    throw new ApiError(409, "Email already exists");
  }

  // Check duplicate phone
  const existingPhone = await User.findOne({
    phoneNumber,
  });

  if (existingPhone) {
    throw new ApiError(409, "Phone number already exists");
  }

  const hashedPassword = await hashPassword(password);

  const user = await User.create({
    firstName: firstName.trim(),
    lastName: lastName?.trim() || "",
    email: normalizedEmail,
    password: hashedPassword,
    phoneNumber: phoneNumber.trim(),
    userType: "employee",
  });

  const sanitizedUser = sanitizeUser(user);

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { user: sanitizedUser },
        "Employee user created successfully",
      ),
    );
});

export const createUserWizard = asyncHandler(async (req, res) => {
  const { user: userData, role, employee, customer } = req.body;

  const existingUser = await User.findOne({
    $or: [
      { email: userData.email.toLowerCase() },
      { phoneNumber: userData.phoneNumber },
    ],
  });

  if (existingUser) {
    throw new ApiError(
      409,
      "User already exists with this email or phone number",
    );
  }

  const hashedPassword = await hashPassword(userData.password);

  const user = await User.create({
    firstName: userData.firstName,
    lastName: userData.lastName,
    email: userData.email.toLowerCase(),
    password: hashedPassword,
    phoneNumber: userData.phoneNumber,
    userType: role,
  });

  try {
    if (role === "employee") {
      const employeeCode = await generateEmployeeCode();

      await Employee.create({
        userId: user._id,
        employeeCode,
        designation: employee.designation,
        department: employee.department,
        joiningDate: employee.joiningDate,
        employmentType: employee.employmentType,
        districtIds: employee.districtIds,
        assignedAtmIds: employee.assignedAtmIds,
        regionIds: employee.regionIds,
        salary: employee.salary,
        createdBy: req.user._id,
      });
    }

    if (role === "customer") {
      await Customer.create({
        userId: user._id,
        customerName: customer.customerName,
        customerEmail: customer.customerEmail,
        customerPhone: customer.customerPhone,
        bankName: customer.bankName,
        atmIds: customer.atmIds,
        districtIds: customer.districtIds,
        createdBy: req.user._id,
      });
    }
  } catch (error) {
    await User.findByIdAndDelete(user._id);

    throw error;
  }

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        user: sanitizeUser(user),
        role,
      },
      "User created successfully",
    ),
  );
});
