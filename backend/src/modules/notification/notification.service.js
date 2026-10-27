import Notification from "./notification.model.js";
import {
  NOTIFICATION_EVENT,
  emitToUser,
  toNotificationPayload,
} from "../../realtime/socket.js";

const isDuplicateKeyError = (error) => error?.code === 11000;

/**
 * Persist one notification for one recipient.
 *
 * Idempotent when `dedupeKey` is provided (unique per recipient). A duplicate,
 * including one that collides with a legacy unique index, resolves to
 * `{ created: false }` instead of throwing. Any other error is rethrown.
 *
 * This is the single persistence entry point; a real-time
 * `notification:new` event is emitted only after a newly created record.
 */
export const createNotification = async ({
  userId,
  type,
  title,
  message,
  data = {},
  dedupeKey,
}) => {
  try {
    const notification = await Notification.create({
      userId,
      type,
      title,
      message,
      data,
      ...(dedupeKey ? { dedupeKey } : {}),
    });
    // Emit only after a successful persist; emit failures never affect the result.
    try {
      emitToUser(
        notification.userId,
        NOTIFICATION_EVENT,
        toNotificationPayload(notification),
      );
    } catch (emitError) {
      console.error("Notification emit failed:", emitError.message);
    }
    return { created: true, duplicate: false, notification };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { created: false, duplicate: true, notification: null };
    }
    throw error;
  }
};

export const countUnreadNotifications = (userId) =>
  Notification.countDocuments({ userId, isRead: false });
