import jwt from "jsonwebtoken";
import User from "../modules/users/user.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";

const verifyAccessToken = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;
  console.log("===>", authHeader);

  if (!token) {
    throw new ApiError(401, "Access token is required");
  }

  const decodedToken = jwt.verify(
    token,
    process.env.JWT_ACCESS_SECRET || "dev-access-secret",
  );

  const user = await User.findById(decodedToken.id).select("-password");

  if (!user) {
    throw new ApiError(401, "Unauthorized user");
  }

  req.user = user;
  next();
});

export { verifyAccessToken };
