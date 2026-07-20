import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import User from "./user.model.js";
import { sanitizeUser } from "../../utils/sanitizeUser.js";

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
