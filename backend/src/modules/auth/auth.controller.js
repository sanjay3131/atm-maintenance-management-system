import User from "../users/user.model.js";
import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import { sanitizeUser } from "../../utils/sanitizeUser.js";

import {
  hashPassword,
  comparePassword,
  hashRefreshToken,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  compareRefreshToken,
} from "./auth.utils.js";
import { hash } from "bcryptjs";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Register
 */
const registerUser = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, phoneNumber } = req.body;

  const existingUser = await User.findOne({
    $or: [{ email: email.toLowerCase() }, { phoneNumber }],
  });

  if (existingUser) {
    throw new ApiError(
      409,
      "User already exists with this email or phone number",
    );
  }

  const hashedPassword = await hashPassword(password);

  const user = await User.create({
    firstName,
    lastName,
    email: email.toLowerCase(),
    password: hashedPassword,
    phoneNumber,
    userType: "user",
  });

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        user: sanitizeUser(user),
      },
      "User registered successfully",
    ),
  );
});

/**
 * Login
 */
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({
    email: email.toLowerCase(),
  });

  if (!user) {
    throw new ApiError(401, "Invalid email or password");
  }

  if (user.status === "blocked") {
    throw new ApiError(403, "Your account has been blocked");
  }

  const isPasswordCorrect = await comparePassword(password, user.password);

  if (!isPasswordCorrect) {
    throw new ApiError(401, "Invalid email or password");
  }

  const accessToken = generateAccessToken(user);

  const refreshToken = generateRefreshToken(user);

  user.refreshToken = await hashRefreshToken(refreshToken);
  user.lastLogin = new Date();

  await user.save();

  res.cookie("refreshToken", refreshToken, cookieOptions);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        user: sanitizeUser(user),
        accessToken,
      },
      "Login successful",
    ),
  );
});

/**
 * Refresh Access Token
 */
const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken = req.cookies?.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Refresh token is required");
  }

  let decoded;

  try {
    decoded = verifyRefreshToken(incomingRefreshToken);
  } catch (error) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const user = await User.findById(decoded.id);

  if (!user) {
    throw new ApiError(401, "Unauthorized");
  }

  const isValid = await compareRefreshToken(
    incomingRefreshToken,
    user.refreshToken,
  );

  if (!isValid) {
    throw new ApiError(401, "Invalid refresh token");
  }

  // Rotate refresh token
  const newAccessToken = generateAccessToken(user);

  const newRefreshToken = generateRefreshToken(user);

  user.refreshToken = await hashRefreshToken(newRefreshToken);

  await user.save();

  res.cookie("refreshToken", newRefreshToken, cookieOptions);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        accessToken: newAccessToken,
      },
      "Access token refreshed successfully",
    ),
  );
});

/**
 * Logout
 */
const logoutUser = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (refreshToken) {
    await User.findOneAndUpdate(
      { refreshToken },
      {
        $set: {
          refreshToken: null,
        },
      },
    );
  }

  res.clearCookie("refreshToken", cookieOptions);

  return res.status(200).json(new ApiResponse(200, {}, "Logout successful"));
});

/**
 * Current User
 */
const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { user: sanitizeUser(req.user) },
        "Current user fetched successfully",
      ),
    );
});

export {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  getCurrentUser,
};
