import ApiError from "../utils/ApiError.js";

const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication required");
    }

    const userRole = String(
      req.user.userType || req.user.role || "user",
    ).toLowerCase();

    if (!allowedRoles.includes(userRole)) {
      throw new ApiError(
        403,
        "You do not have permission to access this resource",
      );
    }

    next();
  };
};

export { authorizeRoles };
