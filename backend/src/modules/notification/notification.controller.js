import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import Notification from "./notification.model.js";
import { countUnreadNotifications } from "./notification.service.js";

// Every query below is scoped to req.user._id (set by verifyAccessToken).
// A notification owned by someone else is indistinguishable from a missing one.

export const getMyNotifications = asyncHandler(async (req, res) => {
  const { page, limit, unreadOnly } = req.validatedQuery;

  const query = { userId: req.user._id };
  if (unreadOnly) query.isRead = false;

  const skip = (page - 1) * limit;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(query),
    countUnreadNotifications(req.user._id),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        notifications,
        total,
        unreadCount,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      "Notifications fetched",
    ),
  );
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const unreadCount = await countUnreadNotifications(req.user._id);

  return res
    .status(200)
    .json(new ApiResponse(200, { unreadCount }, "Unread count fetched"));
});

export const markAsRead = asyncHandler(async (req, res) => {
  const { id } = req.validatedParams;

  // Atomic transition; an already-read notification keeps its original readAt.
  let notification = await Notification.findOneAndUpdate(
    { _id: id, userId: req.user._id, isRead: false },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true },
  );

  if (!notification) {
    notification = await Notification.findOne({
      _id: id,
      userId: req.user._id,
    });
  }
  if (!notification) throw new ApiError(404, "Notification not found");

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
  const { id } = req.validatedParams;

  const notification = await Notification.findOneAndDelete({
    _id: id,
    userId: req.user._id,
  });
  if (!notification) throw new ApiError(404, "Notification not found");

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Notification deleted"));
});
