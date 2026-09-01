import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import Notification from "./notification.model.js";

export const getMyNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, unreadOnly } = req.query;

  const query = { userId: req.user._id };
  if (unreadOnly === "true") query.isRead = false;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Notification.countDocuments(query),
    Notification.countDocuments({ userId: req.user._id, isRead: false }),
  ]);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        {
          notifications,
          total,
          unreadCount,
          pagination: { page: parseInt(page), limit: parseInt(limit), total },
        },
        "Notifications fetched",
      ),
    );
});

export const markAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const notification = await Notification.findOne({
    _id: id,
    userId: req.user._id,
  });
  if (!notification) throw new ApiError(404, "Notification not found");

  notification.isRead = true;
  notification.readAt = new Date();
  await notification.save();

  return res
    .status(200)
    .json(new ApiResponse(200, notification, "Notification marked as read"));
});

export const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { userId: req.user._id, isRead: false },
    { isRead: true, readAt: new Date() },
  );

  return res
    .status(200)
    .json(new ApiResponse(200, null, "All notifications marked as read"));
});

export const deleteNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const notification = await Notification.findOneAndDelete({
    _id: id,
    userId: req.user._id,
  });
  if (!notification) throw new ApiError(404, "Notification not found");

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Notification deleted"));
});
