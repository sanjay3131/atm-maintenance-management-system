import ApiError from "../../utils/ApiError.js";
import User from "../users/user.model.js";

export const resolveSupervisorId = async (supervisorId) => {
  if (supervisorId == null) return null;

  const supervisor = await User.findOne({
    _id: supervisorId,
    userType: "supervisor",
    status: "active",
  }).select("_id");
  if (!supervisor) {
    throw new ApiError(400, "Supervisor must be an active supervisor user");
  }

  return supervisor._id;
};
